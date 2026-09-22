// The Mastermind role (see the "Fogbound V2 Architecture" doc's Roles table,
// "The Mastermind" section, and Migration plan, Milestone 3): maintains a
// persistent hidden plan (future plot beats, background events) the Writer
// can draw on; periodically reviews whether recent chapters still fit the
// plan. Runs on a periodic cadence (every N turns or on major state
// change), not every turn.
//
// Not implemented yet. Evolves Fogbound's static per-world secretInfo blob
// into mastermindPlans (see lib/schema.sql -- table exists, unpopulated):
// versioned, one active row per save plus history. Guardrail from the doc,
// worth restating here since it's easy to get wrong once this exists: the
// Mastermind proposes and never retroactively rewrites what's already been
// told to the player -- anything it wants treated as established has to
// pass through the same fact/contradiction pipeline as everything else.
//
// Not required by anything in Milestone 0 -- exported as a function so an
// accidental require() elsewhere doesn't crash the app at load time.
function reviewPlan() {
  throw new Error('roles/mastermind.js: not implemented until Milestone 3 -- see the Migration plan in the V2 architecture doc');
}

module.exports = { reviewPlan };
