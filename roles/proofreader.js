// The Proofreader role (see the "Fogbound V2 Architecture" doc's Roles
// table and Migration plan, Milestone 3): re-retrieves what the new chapter
// just claimed and checks it against the archive, including the story
// clock; flags contradictions. Runs async, alongside the Archivist.
//
// Not implemented yet -- no current equivalent exists in Fogbound. Its
// first pass (Milestone 3) is narrow on purpose: pacing language against
// storyClock, the exact scenario that motivated this doc (a month passing
// then being referred to as "this morning"). Full contradiction detection
// on every extracted fact is Milestone 4.
//
// Not required by anything in Milestone 0 -- exported as a function so an
// accidental require() elsewhere doesn't crash the app at load time.
function checkChapter() {
  throw new Error('roles/proofreader.js: not implemented until Milestone 3 -- see the Migration plan in the V2 architecture doc');
}

module.exports = { checkChapter };
