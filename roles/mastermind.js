// The Mastermind role (see the "Fogbound V2 Architecture" doc's Roles table,
// "The Mastermind" section, and Migration plan, Milestone 3): maintains a
// persistent hidden plan (future plot beats, background events) the Writer
// can draw on; periodically reviews whether recent chapters still fit the
// plan. Runs on a periodic cadence (every N turns or on major state
// change), not every turn -- see gameEngine.js's fireMastermind.
//
// Evolves Fogbound's static per-world secretInfo blob into mastermindPlans
// (see lib/schema.sql): versioned, one active row per save plus history --
// same status/supersededBy pattern as memoryFacts, never a hard delete, so
// past plan versions stay inspectable even though only the active one is
// ever read back into a prompt (see gameEngine.js's gatherTurnContext).
// Guardrail from the doc, worth restating here since it's easy to get wrong
// once this exists: the Mastermind proposes and never retroactively
// rewrites what's already been told to the player -- anything it wants
// treated as established has to pass through the same fact/contradiction
// pipeline as everything else (see buildMastermindMasterPrompt's own
// guardrail paragraph, sent to the model itself).
//
// Deliberately self-contained, same reasoning as roles/archivist.js and
// roles/proofreader.js: only depends on providers/, lib/db.js and
// lib/promptBuilder.js, never on lib/gameEngine.js itself.
const db = require('../lib/db');
const { v4: uuid } = require('uuid');
const { generateText } = require('../providers/textProviders');
const { recordCost } = require('../lib/costTracker');
const { buildMastermindPrompt } = require('../lib/promptBuilder');

// previousPlan: the current active mastermindPlans row, or null on the
// first call for a save. Fired without being awaited (see
// gameEngine.js's fireMastermind) -- never on the critical path, same as
// the Archivist and Proofreader.
async function reviewPlan({ worldId, saveId, turnNumber, world, previousPlan, recentTurns, storyClock, settings }) {
  const provider = settings.textProvider;
  const model = settings.textModel;
  const { system, user } = buildMastermindPrompt({ world, previousPlan, recentTurns, storyClock, language: settings.language });

  let raw;
  try {
    const result = await generateText({
      provider, system, user, apiKey: settings.apiKeys[provider], model, baseUrl: settings.ollamaBaseUrl
    });
    raw = result.text;
    recordCost({ worldId, saveId, kind: 'mastermind', provider, model, usage: result.usage });
  } catch (e) {
    // Never surfaces anywhere the player can see, same reasoning as the
    // Archivist/Proofreader's own catches: a missed review just means the
    // previous plan (if any) stays active until the next periodic check.
    console.error(`[mastermind] plan review call failed (save ${saveId}, turn ${turnNumber}): ${e.message}`);
    return;
  }

  let parsed;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error(`[mastermind] could not parse plan-review response (save ${saveId}, turn ${turnNumber}): ${e.message} -- got ${raw.length} chars: ...${raw.slice(-160)}`);
    return;
  }

  const plan = parsed.plan;
  if (!plan || (!plan.summary && !(Array.isArray(plan.beats) && plan.beats.length))) return;

  const newId = uuid();
  if (previousPlan && previousPlan.id) {
    db.get('mastermindPlans').find({ id: previousPlan.id }).assign({ status: 'superseded', supersededBy: newId }).write();
  }
  db.get('mastermindPlans').push({
    id: newId,
    saveId,
    turnNumber,
    summary: typeof plan.summary === 'string' ? plan.summary.trim() : '',
    beats: Array.isArray(plan.beats) ? plan.beats.filter(b => typeof b === 'string' && b.trim()).map(b => b.trim()) : [],
    status: 'active',
    supersededBy: null,
    createdAt: new Date().toISOString()
  }).write();
}

module.exports = { reviewPlan };
