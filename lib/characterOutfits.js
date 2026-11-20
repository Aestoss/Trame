// Per-character clothing/appearance-state history (see lib/schema.sql's
// characterOutfits table). Unlike memoryFacts (append-only, similarity-
// retrieved), an outfit is *current* state, closer in spirit to storyClock
// or a Mastermind plan: exactly one row per character is "active" (endTurn
// IS NULL) at any time, and putting on or changing out of something closes
// that row and opens a new one -- an interval history, same shape as the
// time-skip mechanic's timelineEvents, rather than a growing pile of facts
// with no notion of "this one is stale now".
//
// Self-contained for the same reason as lib/memoryFacts.js: only depends on
// lib/db.js and uuid, so roles/archivist.js can use it without requiring
// lib/gameEngine.js back (a circular require, since gameEngine.js is what
// fires the Archivist off).
//
// All three functions are async now (lib/db.js's Firestore backend has no
// synchronous driver) -- every caller awaits them, same logic as before.
const db = require('../lib/db');
const { v4: uuid } = require('uuid');

// The currently-worn outfit for one character in one save, or null if
// nothing has ever been recorded for them (falls back to their own
// "appearance" field everywhere this is read -- see promptBuilder.js).
async function getCurrentOutfit(saveId, character) {
  const ref = await db.get('characterOutfits').find(o => o.saveId === saveId && o.character === character && o.endTurn === null);
  return ref.value() || null;
}

// All outfits ever recorded for a character, oldest first -- the "frise"
// itself. Used by logDebugSnapshot and could back a future UI timeline;
// not needed on the hot path (see getCurrentOutfit above for that).
async function getOutfitHistory(saveId, character) {
  const result = await db.get('characterOutfits').filter(o => o.saveId === saveId && o.character === character);
  return result.sortBy('startTurn').value();
}

// Closes whatever this character is currently wearing (if anything) and
// opens a new row for the new outfit, starting this turn. Idempotent
// against no-op reports: if the description is unchanged from the current
// one, does nothing -- the Archivist is asked to only report real changes,
// but a duplicate report costing a spurious history entry would be a worse
// failure mode than silently ignoring it.
async function applyOutfitChange(saveId, turnNumber, character, description, reason) {
  if (!character || !description || !description.trim()) return;
  const current = await getCurrentOutfit(saveId, character);
  if (current && current.description === description.trim()) return;
  if (current) {
    const ref = await db.get('characterOutfits').find({ id: current.id });
    await ref.assign({ endTurn: turnNumber }).write();
  }
  await db.get('characterOutfits').push({
    id: uuid(), saveId, character,
    description: description.trim(),
    reason: (reason && reason.trim()) || null,
    startTurn: turnNumber,
    endTurn: null,
    createdAt: new Date().toISOString()
  }).write();
}

module.exports = { getCurrentOutfit, getOutfitHistory, applyOutfitChange };
