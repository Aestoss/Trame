// The Archivist role (see the "Fogbound V2 Architecture" doc's Roles table
// and Migration plan, Milestone 1): extracts new facts from a finished
// chapter and appends them to the archive -- never prunes. Fired by
// lib/gameEngine.js's playTurn/playTurnStreaming WITHOUT being awaited,
// right after the turn is already persisted and on its way back to the
// player, so this call is never on the critical path -- a slow or failed
// extraction can never add latency or an error to the turn the player is
// looking at.
//
// Deliberately self-contained: this only depends on providers/, lib/db.js,
// lib/promptBuilder.js and lib/memoryFacts.js, never on lib/gameEngine.js
// itself (which requires this module to fire it) -- reaching back into
// gameEngine.js's internals here would both recreate a circular require and
// blur the "clear module boundary" the design doc asks for.
const db = require('../lib/db');
const { generateText } = require('../providers/textProviders');
const { recordCost } = require('../lib/costTracker');
const { buildArchivistPrompt } = require('../lib/promptBuilder');
const { normalizeNewFact, newMemoryFact } = require('../lib/memoryFacts');

// Model choice: reuses the same textProvider/textModel the Writer is
// configured with. The design doc suggests a cheap, fast default
// (gemini-3.5-flash-lite) for exactly this kind of narrow, structured task,
// as a Settings-level per-role choice -- not implemented yet (no Milestone 1
// deliverable asks for it), so for now the Archivist just piggybacks on
// whatever provider is already configured, same as every other call before
// this role existed.
async function extractFacts({ worldId, saveId, turnNumber, playerAction, chapterText, characterNames, settings }) {
  const provider = settings.textProvider;
  const model = settings.textModel;
  const { system, user } = buildArchivistPrompt({ characterNames, playerAction, chapterText, language: settings.language });

  let raw;
  try {
    const result = await generateText({
      provider, system, user, apiKey: settings.apiKeys[provider], model, baseUrl: settings.ollamaBaseUrl
    });
    raw = result.text;
    recordCost({ worldId, saveId, kind: 'archivist', provider, model, usage: result.usage });
  } catch (e) {
    // Never surfaces anywhere the player can see -- the chapter they read
    // was already correct; a missed extraction just means today's facts
    // don't make it into the archive; a future turn's context is capped and
    // recency-ordered either way (see gatherTurnContext), so nothing crashes.
    console.error(`[archivist] fact extraction call failed (save ${saveId}, turn ${turnNumber}): ${e.message}`);
    return;
  }

  let parsed;
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error(`[archivist] could not parse fact-extraction response (save ${saveId}, turn ${turnNumber}): ${e.message} -- got ${raw.length} chars: ...${raw.slice(-160)}`);
    return;
  }

  (parsed.new_facts || []).forEach(rawFact => {
    const { fact, character, type } = normalizeNewFact(rawFact);
    if (!fact) return;
    db.get('memoryFacts').push(newMemoryFact({ saveId, turnNumber, fact, character, type })).write();
  });
}

module.exports = { extractFacts };
