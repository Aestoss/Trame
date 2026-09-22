// The Writer role (see the "Fogbound V2 Architecture" doc's Roles table):
// drafts the chapter and its JSON metadata, synchronous, in the critical
// path. Right now this is a thin re-export of lib/gameEngine.js's
// turn-playing functions rather than a rewrite -- Milestone 0's job is
// parity, not a restructure. The actual extraction (moving
// buildNarrationPrompt/buildStatePrompt/playTurnStreaming's body in here
// for real, instead of pointing at it) happens incrementally as later
// milestones need to change what feeds the Writer -- Milestone 2 swaps
// gatherTurnContext's recency-capped fact selection for the Retriever's
// similarity search, Milestone 3 adds the story clock, etc. Each of those
// touches this seam anyway, so extracting it now, before there's a second
// role to justify the boundary, would just be churn.
module.exports = {
  playTurn: require('../lib/gameEngine').playTurn,
  playTurnStreaming: require('../lib/gameEngine').playTurnStreaming,
  regenerateTurn: require('../lib/gameEngine').regenerateTurn,
  regenerateTurnStreaming: require('../lib/gameEngine').regenerateTurnStreaming
};
