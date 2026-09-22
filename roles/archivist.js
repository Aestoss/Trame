// The Archivist role (see the "Fogbound V2 Architecture" doc's Roles table
// and Migration plan, Milestone 1): extracts new facts from a finished
// chapter and appends them to the archive -- never prunes. Runs async,
// right after the chapter is shown to the player.
//
// Not implemented yet. In Milestone 0, fact extraction still happens
// synchronously inside lib/gameEngine.js's persistTurn/maybeSummarize (the
// direct port of Fogbound's buildSummaryPrompt/maybeSummarize). Milestone 1
// moves that call off the critical path into here, and adds the
// per-character fact cap that's the direct fix for the production num_ctx
// bug this whole doc started from. Milestone 4 adds contradiction detection
// against the archive on top of that.
//
// Not required by anything in Milestone 0 -- exported as a function so an
// accidental require() elsewhere doesn't crash the app at load time the way
// a module-level throw would.
function extractFacts() {
  throw new Error('roles/archivist.js: not implemented until Milestone 1 -- see the Migration plan in the V2 architecture doc');
}

module.exports = { extractFacts };
