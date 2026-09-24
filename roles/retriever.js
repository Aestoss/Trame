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
// viewerCharacter (the POV mechanic's knowledge wall -- see
// lib/db.js's searchMemoryFactsByEmbedding): whose knowledge this
// retrieval is scoped to, normally the MC, or the POV character during a
// POV scene. Applies to every query below regardless of whose facts are
// being searched -- a fact only reaches the prompt if the *viewer*, not
// just the fact's own subject, is allowed to know it.
//
// omniscient (Milestone 4's Proofreader): bypasses the knownBy wall
// entirely instead of scoping to viewerCharacter -- for a narrator-level
// caller that needs to check the story's own consistency against every
// fact on record, private/secret ones included, not just what one
// character is allowed to know. viewerCharacter is ignored when this is
// true.
//
// forwardEmbedding (feedback item #1): the Mastermind's active plan's own
// stored embedding (see roles/mastermind.js's reviewPlan), searched
// alongside the backward-looking queryText embedding and merged into the
// same capped pool. Without this, retrieval only ever looks backward at
// "what just happened" -- a fact planted many turns ago for a payoff the
// plan is quietly building toward has no reason to resemble the current
// scene's wording, and would never surface on its own this way. Optional:
// a save with no active plan yet (or a failed query embedding) just runs
// whichever of the two queries it still has.
//
// Returns { memoryFacts, factsByCharacter } in exactly the shapes
// lib/promptBuilder.js's buildTurnContextBlocks already expects (mirroring
// what gatherTurnContext used to build itself via a recency slice):
// memoryFacts as full fact rows (only .fact is read downstream, but the
// whole row is kept in case a future milestone wants more of it), and
// factsByCharacter[name] as plain fact strings.
async function retrieveRelevantFacts({ saveId, queryText, forwardEmbedding, characterNames, viewerCharacter, omniscient, limit, settings }) {
  const embedding = await embedQuery(queryText, settings);
  if (!embedding && !forwardEmbedding) return { memoryFacts: [], factsByCharacter: {} };

  // Backward and forward queries each contribute up to `limit` candidates,
  // merged and deduped by id, then capped to `limit` once -- adding the
  // forward query widens the pool that gets ranked down to one bounded
  // result, it never adds a second uncapped bucket on top of the first.
  function mergedSearch(character) {
    const backward = embedding ? db.searchMemoryFactsByEmbedding({ saveId, embedding, k: limit, character, viewerCharacter, omniscient }) : [];
    const forward = forwardEmbedding ? db.searchMemoryFactsByEmbedding({ saveId, embedding: forwardEmbedding, k: limit, character, viewerCharacter, omniscient }) : [];
    const seen = new Set();
    const merged = [];
    for (const fact of [...backward, ...forward]) {
      if (seen.has(fact.id)) continue;
      seen.add(fact.id);
      merged.push(fact);
    }
    return merged.slice(0, limit);
  }

  const memoryFacts = mergedSearch(null);
  const factsByCharacter = {};
  for (const name of characterNames || []) {
    const rows = mergedSearch(name);
    if (rows.length) factsByCharacter[name] = rows.map(r => r.fact);
  }
  return { memoryFacts, factsByCharacter };
}

module.exports = { retrieveRelevantFacts };
