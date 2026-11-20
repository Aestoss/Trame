// The Supersede checker (new as of the Firebase migration -- see
// lib/promptBuilder.js's buildSupersedeMasterPrompt for the full reasoning
// and lib/memoryFacts.js for the status/supersededBy fields this finally
// wires up). Run once per newly-extracted fact, right after
// roles/archivist.js writes it: finds the handful of existing facts most
// similar to the new one (the same brute-force similarity search the
// Retriever uses, scoped omnisciently like the Proofreader -- this is
// narrator-level bookkeeping, not limited to what any one character
// knows), and asks the cheap background model which of them, if any, the
// new fact now contradicts or clearly supersedes.
//
// Deliberately narrow and conservative: it only ever marks an OLDER fact
// superseded by the fact that was JUST written, never edits fact text, and
// a parse failure or empty response just leaves every candidate active --
// same "never worse than doing nothing" discipline as the other background
// roles. Fired from roles/archivist.js, awaited there (unlike the other
// background roles, this one is part of the same already-async extraction
// loop rather than a separate fire site in gameEngine.js).
const db = require('../lib/db');
const { generateText } = require('../providers/textProviders');
const { recordCost } = require('../lib/costTracker');
const { buildSupersedePrompt } = require('../lib/promptBuilder');
const { getBackgroundModelConfig } = require('../lib/backgroundModel');

// +1 over the limit so the new fact's own near-identical embedding (it was
// just written, so it's always its own closest match) doesn't crowd out a
// real candidate once it's filtered out below.
const CANDIDATE_LIMIT = 5;

async function checkForSupersededFacts({ worldId, saveId, turnNumber, newFact, settings }) {
  if (!Array.isArray(newFact.embedding)) return;

  const nearby = await db.searchMemoryFactsByEmbedding({
    saveId, embedding: newFact.embedding, k: CANDIDATE_LIMIT + 1,
    character: newFact.character, viewerCharacter: null, omniscient: true
  });
  const candidates = nearby.filter(c => c.id !== newFact.id && c.status === 'active');
  if (!candidates.length) return;

  const { provider, model, apiKey, baseUrl } = getBackgroundModelConfig(settings);
  const { system, user } = buildSupersedePrompt({ newFact, candidates, language: settings.language });

  let raw;
  try {
    const result = await generateText({ provider, system, user, apiKey, model, baseUrl });
    raw = result.text;
    await recordCost({ worldId, saveId, kind: 'supersede', provider, model, usage: result.usage });
  } catch (e) {
    // Never surfaces anywhere the player can see, same reasoning as every
    // other background role's catch: a missed check just means an outdated
    // fact stays active one turn longer than ideal, not a broken turn.
    console.error(`[supersede] check call failed (save ${saveId}, turn ${turnNumber}): ${e.message}`);
    return;
  }

  let parsed;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error(`[supersede] could not parse response (save ${saveId}, turn ${turnNumber}): ${e.message} -- got ${raw.length} chars: ...${raw.slice(-160)}`);
    return;
  }

  const candidateIds = new Set(candidates.map(c => c.id));
  const supersededIds = Array.isArray(parsed.superseded_ids)
    ? parsed.superseded_ids.filter(id => candidateIds.has(id))
    : [];

  for (const id of supersededIds) {
    const ref = await db.get('memoryFacts').find({ id });
    if (ref.value()) {
      await ref.assign({ status: 'superseded', supersededBy: newFact.id }).write();
    }
  }
  console.log(`[supersede] save=${saveId} turn=${turnNumber} provider=${provider} model=${model || '(default)'}: ${supersededIds.length}/${candidates.length} candidate(s) superseded by fact ${newFact.id}`);
}

module.exports = { checkForSupersededFacts };
