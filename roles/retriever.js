// The Retriever role (see the "Fogbound V2 Architecture" doc's Roles table
// and Migration plan, Milestone 2): picks the relevant subset of the
// archive to hand the Writer, by similarity to the current scene -- not by
// recency. Runs synchronously, just before the Writer call.
//
// Not implemented yet. Milestone 0 still uses lib/gameEngine.js's
// gatherTurnContext, ported directly from Fogbound -- recency-capped
// (RELEVANT_FACTS_LIMIT) general facts, uncapped per-character and
// world-lore facts. Milestone 2 replaces that recency cap with a real
// similarity search (sqlite-vec) over memoryFacts.embedding (see
// lib/schema.sql -- the column already exists, just unpopulated).
//
// Not required by anything in Milestone 0 -- exported as a function so an
// accidental require() elsewhere doesn't crash the app at load time.
function retrieveRelevantFacts() {
  throw new Error('roles/retriever.js: not implemented until Milestone 2 -- see the Migration plan in the V2 architecture doc');
}

module.exports = { retrieveRelevantFacts };
