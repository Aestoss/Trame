// Embedding providers for the Retriever role (see the "Fogbound V2
// Architecture" doc's Migration plan, Milestone 2). Same shape convention
// as providers/textProviders.js: one function per provider,
// ({ text, apiKey }) -> Promise<number[]> of length EMBEDDING_DIMS.
const fetch = require('node-fetch');
const { EMBEDDING_DIMS } = require('../lib/embeddingConfig');

// Zero-config default, same role as 'mock' in textProviders.js/imageProviders.js:
// works immediately with no API key so the whole pipeline (including
// genuinely spot-checkable retrieval quality) can be built and tested
// before a real key is configured. This is a real technique -- feature
// hashing / "the hashing trick" (FNV-1a into a fixed-width bucket vector,
// L2-normalized) -- not a placeholder: cosine similarity between two texts'
// hashed bag-of-words vectors correlates with shared vocabulary, which is a
// genuine (if crude) topical-relevance signal. It will never match a real
// semantic embedding's quality (no sense of synonyms or paraphrase), but
// it's sufficient to hand-verify that retrieval actually prefers on-topic
// facts over just-newest ones -- see the Milestone 2 done-when criterion.
function hashEmbed(text) {
  const vec = new Float32Array(EMBEDDING_DIMS);
  const words = (text || '').toLowerCase().match(/[a-zà-öø-ÿ0-9]+/g) || [];
  for (const word of words) {
    if (word.length < 3) continue; // skip stopword-sized noise ("a", "un", "le"...)
    let hash = 2166136261;
    for (let i = 0; i < word.length; i++) {
      hash ^= word.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    vec[Math.abs(hash) % EMBEDDING_DIMS] += 1;
  }
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array(EMBEDDING_DIMS);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

async function embedMock({ text }) {
  return hashEmbed(text);
}

async function embedGemini({ text, apiKey }) {
  if (!apiKey) throw new Error('Gemini API key required for embeddings');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } })
    }
  );
  if (!res.ok) {
    const err = new Error(`Gemini embedding API error ${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const values = data.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS) {
    throw new Error(`Gemini embedding response had unexpected shape (expected ${EMBEDDING_DIMS} dims, got ${values ? values.length : 'none'})`);
  }
  return values;
}

const embedders = { mock: embedMock, gemini: embedGemini };

// Same retry policy as generateText in textProviders.js (429/5xx and a
// handful of network-level errors get a couple of short retries; anything
// else fails immediately rather than hiding a real bug behind a delay).
const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE']);
function isRetryable(err) {
  if (typeof err.status === 'number') return err.status === 429 || (err.status >= 500 && err.status < 600);
  return RETRYABLE_NETWORK_CODES.has(err.code);
}
const RETRY_DELAYS_MS = [1000, 2500];
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function generateEmbedding({ provider, text, apiKey }) {
  const fn = embedders[provider] || embedders.mock;
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn({ text, apiKey });
    } catch (e) {
      lastError = e;
      if (!isRetryable(e) || attempt === RETRY_DELAYS_MS.length) throw e;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

module.exports = { generateEmbedding };
