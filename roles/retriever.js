// The Retriever role (see the "Fogbound V2 Architecture" doc's Roles table
// and Migration plan, Milestone 2): picks the relevant subset of the
// archive to hand the Writer, by similarity to the current scene -- not by
// recency. Runs synchronously, just before the Writer call (see
// gameEngine.js's gatherTurnContext) -- unlike the Archivist, this one is
// on the critical path by necessity: the Writer's prompt needs its output
// before it can be built.
//
// Self-contained for the same reason as roles/archivist.js: depends only on
// providers/ and lib/db.js, never lib/gameEngine.js.
const db = require('../lib/db');
const { generateEmbedding } = require('../providers/embeddingProviders');

// A failed query embedding degrades to "nothing retrieved this turn" rather
// than throwing. Unlike a failed Archivist call (invisible to the player,
// since it runs after the chapter is already shown), this IS on the
// player's critical path -- so it must never fail the turn itself. An empty
// general/character fact pool for one turn is a far smaller cost than every
// action failing outright until an embedding provider recovers.
async function embedQuery(text, settings) {
  try {
    const provider = settings.embeddingProvider;
    return await generateEmbedding({ provider, text, apiKey: settings.apiKeys[provider] });
  } catch (e) {
    console.error(`[retriever] failed to embed the query, retrieval skipped for this turn: ${e.message}`);
    return null;
  }
}

// queryText should be the player's action plus a short window of recent
// scene text (see the design doc's Retrieval mechanism section) --
// gameEngine.js builds that string, this role only embeds and searches it.
//
// Returns { memoryFacts, factsByCharacter } in exactly the shapes
// lib/promptBuilder.js's buildTurnContextBlocks already expects (mirroring
// what gatherTurnContext used to build itself via a recency slice):
// memoryFacts as full fact rows (only .fact is read downstream, but the
// whole row is kept in case a future milestone wants more of it), and
// factsByCharacter[name] as plain fact strings.
async function retrieveRelevantFacts({ saveId, queryText, characterNames, limit, settings }) {
  const embedding = await embedQuery(queryText, settings);
  if (!embedding) return { memoryFacts: [], factsByCharacter: {} };

  const memoryFacts = db.searchMemoryFactsByEmbedding({ saveId, embedding, k: limit, character: null });
  const factsByCharacter = {};
  for (const name of characterNames || []) {
    const rows = db.searchMemoryFactsByEmbedding({ saveId, embedding, k: limit, character: name });
    if (rows.length) factsByCharacter[name] = rows.map(r => r.fact);
  }
  return { memoryFacts, factsByCharacter };
}

module.exports = { retrieveRelevantFacts };
