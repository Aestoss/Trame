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
const { embedFact } = require('../lib/embedFact');
const { getBackgroundModelConfig } = require('../lib/backgroundModel');
const { applyOutfitChange } = require('../lib/characterOutfits');

// Model choice: see lib/backgroundModel.js -- a fixed, cheap model
// (gemini-3.5-flash-lite) once settings.backgroundModel.apiKey is set,
// falling back to whatever the Writer is configured with otherwise.
// povCharacter: set when the chapter being extracted from was a POV scene
// (see buildPovPrompt/playPovTurnStreaming) -- the MC was explicitly not
// present, so buildArchivistPrompt needs to scope known_by to whoever
// actually was, instead of defaulting new facts to "publicly known" the
// way a normal MC-POV chapter's facts do.
async function extractFacts({ worldId, saveId, turnNumber, playerAction, chapterText, characterNames, currentOutfits, povCharacter, settings }) {
  const { provider, model, apiKey, baseUrl } = getBackgroundModelConfig(settings);
  const { system, user } = buildArchivistPrompt({ characterNames, playerAction, chapterText, currentOutfits, povCharacter, language: settings.language });

  let raw;
  try {
    const result = await generateText({
      provider, system, user, apiKey, model, baseUrl
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

  let written = 0;
  for (const rawFact of parsed.new_facts || []) {
    const { fact, character, type, knownBy } = normalizeNewFact(rawFact);
    if (!fact) continue;
    const row = newMemoryFact({ saveId, turnNumber, fact, character, type, knownBy });
    row.embedding = await embedFact(fact, settings, `save ${saveId}, turn ${turnNumber}`);
    db.get('memoryFacts').push(row).write();
    written++;
  }

  let outfitsChanged = 0;
  for (const rawOutfit of parsed.outfit_changes || []) {
    if (!rawOutfit || typeof rawOutfit !== 'object') continue;
    const character = typeof rawOutfit.character === 'string' ? rawOutfit.character.trim() : '';
    const description = typeof rawOutfit.description === 'string' ? rawOutfit.description.trim() : '';
    const reason = typeof rawOutfit.reason === 'string' ? rawOutfit.reason.trim() : null;
    if (!character || !description) continue;
    applyOutfitChange(saveId, turnNumber, character, description, reason);
    outfitsChanged++;
  }

  // Logged on every run, not just failures -- this is what lets a turn's
  // background activity be confirmed from Railway's own deploy logs alone,
  // without a debug dump: provider/model actually used (background key vs.
  // Writer's own), and how many facts actually landed vs. what the model proposed.
  console.log(`[archivist] save=${saveId} turn=${turnNumber} provider=${provider} model=${model || '(default)'}: ${written}/${(parsed.new_facts || []).length} fact(s) written, ${outfitsChanged} outfit(s) updated`);
}

module.exports = { extractFacts };
