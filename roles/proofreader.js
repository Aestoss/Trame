// The Proofreader role (see the "Fogbound V2 Architecture" doc's Roles
// table and Migration plan, Milestone 3): re-retrieves what the new chapter
// just claimed and checks it against the archive, including the story
// clock; flags contradictions. Runs async, alongside the Archivist.
//
// First pass (this one) is narrow on purpose: pacing language against
// storyClock, the exact scenario that motivated this doc (a month passing
// then being referred to as "this morning"). Full contradiction detection
// on every extracted fact is Milestone 4.
//
// Deliberately self-contained, same reasoning as roles/archivist.js: only
// depends on providers/, lib/db.js and lib/promptBuilder.js, never on
// lib/gameEngine.js itself. Fired by gameEngine.js's playTurn/
// playTurnStreaming/regenerateTurn/regenerateTurnStreaming WITHOUT being
// awaited, right after the turn is already persisted -- never on the
// critical path, same as the Archivist.
const db = require('../lib/db');
const { v4: uuid } = require('uuid');
const { generateText } = require('../providers/textProviders');
const { recordCost } = require('../lib/costTracker');
const { buildProofreaderPrompt } = require('../lib/promptBuilder');

// storyClock: the value as of right after this chapter (see
// gameEngine.js's fireProofreader -- it reads the just-persisted value,
// not the one from before the turn, since a time skip or story_clock
// update that happened THIS turn is exactly what a contradiction would be
// checked against).
async function checkChapter({ worldId, saveId, turnNumber, chapterText, storyClock, settings }) {
  const provider = settings.textProvider;
  const model = settings.textModel;
  const { system, user } = buildProofreaderPrompt({ chapterText, storyClock, language: settings.language });

  let raw;
  try {
    const result = await generateText({
      provider, system, user, apiKey: settings.apiKeys[provider], model, baseUrl: settings.ollamaBaseUrl
    });
    raw = result.text;
    recordCost({ worldId, saveId, kind: 'proofreader', provider, model, usage: result.usage });
  } catch (e) {
    // Never surfaces anywhere the player can see, same reasoning as the
    // Archivist's own catch below it: the chapter they read was already
    // final either way -- a missed check just means no flag this turn.
    console.error(`[proofreader] pacing check call failed (save ${saveId}, turn ${turnNumber}): ${e.message}`);
    return;
  }

  let parsed;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error(`[proofreader] could not parse pacing-check response (save ${saveId}, turn ${turnNumber}): ${e.message} -- got ${raw.length} chars: ...${raw.slice(-160)}`);
    return;
  }

  const contradiction = parsed.contradiction;
  if (!contradiction || typeof contradiction.summary !== 'string' || !contradiction.summary.trim()) return;

  db.get('proofreaderFlags').push({
    id: uuid(),
    saveId,
    turnNumber,
    summary: contradiction.summary.trim(),
    quote: typeof contradiction.quote === 'string' ? contradiction.quote.trim() : null,
    createdAt: new Date().toISOString()
  }).write();
}

module.exports = { checkChapter };
