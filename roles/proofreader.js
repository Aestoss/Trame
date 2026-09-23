// The Proofreader role (see the "Fogbound V2 Architecture" doc's Roles
// table and Migration plan, Milestones 3-4): re-retrieves what the new
// chapter just claimed and checks it against the archive, including the
// story clock; flags contradictions. Runs async, alongside the Archivist.
//
// Milestone 3 shipped pacing language against storyClock only (a month
// passing then being referred to as "this morning"). This is that check
// plus Milestone 4's full pass: the chapter is also checked against the
// facts most relevant to it, retrieved omniscient (see lib/db.js's
// searchMemoryFactsByEmbedding) so a private/secret fact the player
// character was never told is still checked against -- this is a
// narrator-level consistency check, not a character-scoped one. See
// lib/promptBuilder.js's buildProofreaderPrompt for the full reasoning.
//
// Deliberately self-contained, same reasoning as roles/archivist.js: only
// depends on providers/, lib/db.js and lib/promptBuilder.js, never on
// lib/gameEngine.js itself. Fired by gameEngine.js's playTurn/
// playTurnStreaming WITHOUT being awaited, right after the turn is already
// persisted -- never on the critical path, same as the Archivist.
const db = require('../lib/db');
const { v4: uuid } = require('uuid');
const { generateText } = require('../providers/textProviders');
const { recordCost } = require('../lib/costTracker');
const { buildProofreaderPrompt } = require('../lib/promptBuilder');
const { getBackgroundModelConfig } = require('../lib/backgroundModel');

// storyClock: the value as of right after this chapter (see
// gameEngine.js's fireProofreader -- it reads the just-persisted value,
// not the one from before the turn, since a time skip or story_clock
// update that happened THIS turn is exactly what a contradiction would be
// checked against). relevantFacts: plain fact strings, similarity-retrieved
// against the chapter text itself (see gameEngine.js's fireProofreader).
// Model choice: see lib/backgroundModel.js -- same fixed, cheap model as
// the Archivist once a background key is set.
async function checkChapter({ worldId, saveId, turnNumber, chapterText, storyClock, relevantFacts, settings }) {
  const { provider, model, apiKey, baseUrl } = getBackgroundModelConfig(settings);
  const { system, user } = buildProofreaderPrompt({ chapterText, storyClock, relevantFacts, language: settings.language });

  let raw;
  try {
    const result = await generateText({
      provider, system, user, apiKey, model, baseUrl
    });
    raw = result.text;
    recordCost({ worldId, saveId, kind: 'proofreader', provider, model, usage: result.usage });
  } catch (e) {
    // Never surfaces anywhere the player can see, same reasoning as the
    // Archivist's own catch below it: the chapter they read was already
    // final either way -- a missed check just means no flag this turn.
    console.error(`[proofreader] continuity check call failed (save ${saveId}, turn ${turnNumber}): ${e.message}`);
    return;
  }

  let parsed;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error(`[proofreader] could not parse continuity-check response (save ${saveId}, turn ${turnNumber}): ${e.message} -- got ${raw.length} chars: ...${raw.slice(-160)}`);
    return;
  }

  const contradictions = Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
  const createdAt = new Date().toISOString();
  // One row per real contradiction found -- a single chapter can raise both
  // a pacing issue and a fact issue at once, and proofreaderFlags has no
  // uniqueness constraint on (saveId, turnNumber), so multiple rows for the
  // same turn is the expected shape here, not a bug.
  let written = 0;
  for (const c of contradictions) {
    if (!c || typeof c.summary !== 'string' || !c.summary.trim()) continue;
    const type = c.type === 'fact' ? 'fact' : 'pacing';
    db.get('proofreaderFlags').push({
      id: uuid(),
      saveId,
      turnNumber,
      type,
      summary: c.summary.trim(),
      quote: typeof c.quote === 'string' ? c.quote.trim() : null,
      createdAt
    }).write();
    written++;
  }
  // Logged every run, including the (common, expected) zero-flags case --
  // "ran and found nothing" needs to be distinguishable from "never ran" in
  // the deploy logs alone.
  console.log(`[proofreader] save=${saveId} turn=${turnNumber} provider=${provider} model=${model || '(default)'}: ${written} flag(s) raised`);
}

module.exports = { checkChapter };
