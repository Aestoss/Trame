// Shared by roles/archivist.js and lib/gameEngine.js's maybeSummarize --
// the two places a memoryFacts row is created (see the Retriever role,
// Milestone 2 of the V2 design doc: every fact needs an embedding the
// moment it's created, not just the ones the per-turn Archivist writes, or
// a save's periodic-summary facts would be silently invisible to
// similarity search). A failed embedding is never fatal -- same reasoning
// as a failed image generation elsewhere in this app: the fact itself is
// still saved and still useful for anyone reading the raw archive, it just
// won't be reachable by the Retriever's similarity search this run.
const { generateEmbedding } = require('../providers/embeddingProviders');

async function embedFact(text, settings, context) {
  try {
    const provider = settings.embeddingProvider;
    return await generateEmbedding({ provider, text, apiKey: settings.apiKeys[provider] });
  } catch (e) {
    console.error(`[embeddings] failed to embed a fact${context ? ` (${context})` : ''}: ${e.message}`);
    return null;
  }
}

module.exports = { embedFact };
