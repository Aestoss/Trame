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
const db = require('../lib/db');
const { v4: uuid } = require('uuid');

// The currently-worn outfit for one character in one save, or null if
// nothing has ever been recorded for them (falls back to their own
// "appearance" field everywhere this is read -- see promptBuilder.js).
function getCurrentOutfit(saveId, character) {
  return db.get('characterOutfits').find(o => o.saveId === saveId && o.character === character && o.endTurn === null).value() || null;
}

// All outfits ever recorded for a character, oldest first -- the "frise"
// itself. Used by logDebugSnapshot and could back a future UI timeline;
// not needed on the hot path (see getCurrentOutfit above for that).
function getOutfitHistory(saveId, character) {
  return db.get('characterOutfits').filter(o => o.saveId === saveId && o.character === character).sortBy('startTurn').value();
}

// Closes whatever this character is currently wearing (if anything) and
// opens a new row for the new outfit, starting this turn. Idempotent
// against no-op reports: if the description is unchanged from the current
// one, does nothing -- the Archivist is asked to only report real changes,
// but a duplicate report costing a spurious history entry would be a worse
// failure mode than silently ignoring it.
function applyOutfitChange(saveId, turnNumber, character, description, reason) {
  if (!character || !description || !description.trim()) return;
  const current = getCurrentOutfit(saveId, character);
  if (current && current.description === description.trim()) return;
  if (current) {
    db.get('characterOutfits').find({ id: current.id }).assign({ endTurn: turnNumber }).write();
  }
  db.get('characterOutfits').push({
    id: uuid(), saveId, character,
    description: description.trim(),
    reason: (reason && reason.trim()) || null,
    startTurn: turnNumber,
    endTurn: null,
    createdAt: new Date().toISOString()
  }).write();
}

module.exports = { getCurrentOutfit, getOutfitHistory, applyOutfitChange };
