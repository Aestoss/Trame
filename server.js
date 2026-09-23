const dns = require('dns');
// Some container platforms (Railway included) route IPv6 unreliably or not
// at all even when a host resolves to both an A and AAAA record — Node can
// then pick the IPv6 address first and hang until it times out before
// falling back to IPv4, adding several seconds to every external API call
// (Anthropic/OpenAI/Gemini/etc.) and making a real, working setup look
// broken. Preferring IPv4 first avoids that hop entirely.
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./lib/db');
const {
  createWorld, getWorld, updateWorld, aiEditWorld, deleteWorld,
  regenerateWorldCover, previewWorldCover, acceptWorldCover,
  addCharacter, addCharacterWithPortrait, generateCharacterWithAI, updateCharacter, deleteCharacter,
  regenerateCharacterPortrait, previewCharacterPortrait, acceptCharacterPortrait,
  addTrackedItem, updateTrackedItem, deleteTrackedItem,
  addNpc, updateNpc, deleteNpc,
  createSave, getSave, selectCharacter, continueAfterVictory, deleteSave, purgeSaveImages,
  playTurn, playTurnStreaming, playTimeSkipStreaming, playPovTurnStreaming, rewindToTurn, regenerateTurn, regenerateTurnStreaming, getSettings,
  listAvailableOllamaModels, getOllamaStatus, listAvailableLocalSdModels
} = require('./lib/gameEngine');
const { getTotalCosts, getWorldCosts } = require('./lib/costTracker');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Locally-generated images are written to disk under DATA_DIR/images (see
// providers/imageProviders.js) instead of stored inline as base64 in
// the database -- served from the same persistent volume the database lives on,
// not from the app bundle, so they survive deploys.
app.use('/images', express.static(path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'images')));

// secretInfo is deliberately hidden state (see docs/INFINITE_WORLDS_REFERENCE.md,
// Phase E) — strip it before any save object reaches the client. Returns a
// shallow copy so callers never accidentally mutate the live db record.
function publicSave(save) {
  if (!save) return save;
  const { secretInfo, ...rest } = save;
  return rest;
}

function worldPlayableCharacters(worldId) {
  return db.get('playableCharacters').filter({ worldId }).value();
}

function worldPublicTrackedItemDefs(worldId) {
  // ai_only tracked items are deliberately withheld from the client — that's
  // the whole point of the visibility flag (hidden state, e.g. a secret plot flag).
  // Used by any endpoint reachable from a player-facing flow (e.g. right
  // before character selection) — the world editor's own tracked-items
  // section fetches the unfiltered list separately (GET .../tracked-items),
  // since an author obviously needs to see what they're marking hidden.
  return db.get('trackedItemDefs').filter({ worldId, visibility: 'player_and_ai' }).value();
}

// Turns carry a full state snapshot (see gameEngine.captureSnapshot) so a
// past page can show tracked items as they were at that point in the story.
// outcome/skillUsed are deliberately not shown to the player by default —
// only "mode auteur" (debug=true) reveals them, along with ai_only items.
function publicTurn(turn, { debug, itemDefs }) {
  if (!turn) return turn;
  const snapshot = turn.snapshot || { trackedItemValues: [], secretInfo: '' };
  const visibleDefs = debug ? itemDefs : itemDefs.filter(d => d.visibility === 'player_and_ai');
  const trackedItems = visibleDefs.map(def => {
    const row = snapshot.trackedItemValues.find(v => v.itemDefId === def.id);
    return { name: def.name, value: row ? row.value : def.initialValue, visibility: def.visibility };
  });
  const { snapshot: _snapshot, outcome, skillUsed, ...rest } = turn;
  return debug ? { ...rest, outcome, skillUsed, trackedItems, secretInfo: snapshot.secretInfo || '' } : { ...rest, trackedItems };
}

// ---------- Worlds (reusable templates) ----------

app.get('/api/worlds', (req, res) => {
  const worlds = db.get('worlds').value();
  res.json(worlds.map(w => ({ ...w, saveCount: db.get('saves').filter({ worldId: w.id }).size().value() })));
});

app.get('/api/worlds/:id', (req, res) => {
  try {
    const world = getWorld(req.params.id);
    res.json({
      world,
      playableCharacters: worldPlayableCharacters(world.id),
      trackedItemDefs: worldPublicTrackedItemDefs(world.id)
    });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/api/worlds', async (req, res) => {
  try {
    const { idea, language } = req.body;
    if (!idea || !idea.trim()) return res.status(400).json({ error: 'idea is required' });
    const result = await createWorld(idea.trim(), language);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Streaming counterpart of the route above, same newline-delimited JSON
// event protocol as POST /api/saves/:id/turn/stream: {"type":"progress",
// "chars":N} while the model is still writing the world's JSON (raw deltas
// aren't shown to the player -- only their running length, to drive a real
// progress bar instead of the old fixed-duration cosmetic animation), then
// {"type":"done","world":...,"playableCharacters":...} or
// {"type":"error","message":...}.
app.post('/api/worlds/stream', async (req, res) => {
  const { idea, language } = req.body;
  if (!idea || !idea.trim()) return res.status(400).json({ error: 'idea is required' });

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no'
  });
  const send = (event) => res.write(JSON.stringify(event) + '\n');

  let chars = 0;
  try {
    const result = await createWorld(idea.trim(), language, {
      onChunk: (text) => { chars += text.length; send({ type: 'progress', chars }); }
    });
    send({ type: 'done', ...result });
  } catch (e) {
    console.error(e);
    send({ type: 'error', message: e.message });
  } finally {
    res.end();
  }
});

app.patch('/api/worlds/:id', (req, res) => {
  try {
    const {
      title, instructions, authorStyle, imageStyle, imageStylePrefix, imageStyleSuffix, imageModel,
      description, objective, background, firstAction, mature, contentWarnings,
      setting, tone, rules, skills, victoryCondition, victoryText, defeatCondition, defeatText,
      characterSelectText, designNotes
    } = req.body;
    const world = updateWorld(req.params.id, {
      title, instructions, authorStyle, imageStyle, imageStylePrefix, imageStyleSuffix, imageModel,
      description, objective, background, firstAction, mature, contentWarnings,
      setting, tone, rules, skills, victoryCondition, victoryText, defeatCondition, defeatText,
      characterSelectText, designNotes
    });
    res.json({ ok: true, world });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/ai-edit', async (req, res) => {
  try {
    const { instruction } = req.body;
    if (!instruction || !instruction.trim()) return res.status(400).json({ error: 'instruction is required' });
    const world = await aiEditWorld(req.params.id, instruction.trim());
    res.json({ ok: true, world });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/regenerate-cover', async (req, res) => {
  try {
    const world = await regenerateWorldCover(req.params.id);
    res.json({ ok: true, world });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// "Open the cover image" flow: preview a (possibly edited) prompt without
// touching the saved cover, then accept it explicitly to replace the old
// one. Two routes rather than one so a generated-but-rejected preview never
// touches the database at all.
app.post('/api/worlds/:id/cover/preview', async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await previewWorldCover(req.params.id, prompt);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/cover/accept', (req, res) => {
  try {
    const { imageUrl, prompt } = req.body;
    const world = acceptWorldCover(req.params.id, imageUrl, prompt);
    res.json({ ok: true, world });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/worlds/:id', (req, res) => {
  try {
    deleteWorld(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Playable characters (world templates) ----------

app.post('/api/worlds/:id/characters', async (req, res) => {
  try {
    const { name, description, appearance, skills } = req.body;
    // Generates a portrait right away (best-effort, same as an AI-generated
    // character) instead of leaving a manually-added one without an image
    // until someone notices and clicks "Regenerate portrait" by hand.
    const character = await addCharacterWithPortrait(req.params.id, { name, description, appearance, skills });
    res.json({ ok: true, character });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/characters/generate', async (req, res) => {
  try {
    const { description } = req.body;
    const character = await generateCharacterWithAI(req.params.id, description);
    res.json({ ok: true, character });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/worlds/:worldId/characters/:characterId', (req, res) => {
  try {
    const { name, description, appearance, skills, initialTrackedItemValues } = req.body;
    const character = updateCharacter(req.params.worldId, req.params.characterId, { name, description, appearance, skills, initialTrackedItemValues });
    res.json({ ok: true, character });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/worlds/:worldId/characters/:characterId', (req, res) => {
  try {
    deleteCharacter(req.params.worldId, req.params.characterId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:worldId/characters/:characterId/regenerate-portrait', async (req, res) => {
  try {
    const character = await regenerateCharacterPortrait(req.params.worldId, req.params.characterId);
    res.json({ ok: true, character });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Same preview/accept split as the world cover above, for character portraits.
app.post('/api/worlds/:worldId/characters/:characterId/portrait/preview', async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await previewCharacterPortrait(req.params.worldId, req.params.characterId, prompt);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/worlds/:worldId/characters/:characterId/portrait/accept', (req, res) => {
  try {
    const { imageUrl, prompt } = req.body;
    const character = acceptCharacterPortrait(req.params.worldId, req.params.characterId, imageUrl, prompt);
    res.json({ ok: true, character });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Tracked items (world templates) ----------
// Unfiltered on purpose — this is the author-only editor list, distinct
// from worldPublicTrackedItemDefs used in any player-facing response.

app.get('/api/worlds/:id/tracked-items', (req, res) => {
  try {
    getWorld(req.params.id);
    res.json(db.get('trackedItemDefs').filter({ worldId: req.params.id }).value());
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/tracked-items', (req, res) => {
  try {
    const { name, dataType, description, visibility, updateAutomatically, updateInstructions, initialValue } = req.body;
    const item = addTrackedItem(req.params.id, { name, dataType, description, visibility, updateAutomatically, updateInstructions, initialValue });
    res.json({ ok: true, item });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/worlds/:worldId/tracked-items/:itemId', (req, res) => {
  try {
    const { name, dataType, description, visibility, updateAutomatically, updateInstructions, initialValue } = req.body;
    const item = updateTrackedItem(req.params.worldId, req.params.itemId, { name, dataType, description, visibility, updateAutomatically, updateInstructions, initialValue });
    res.json({ ok: true, item });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/worlds/:worldId/tracked-items/:itemId', (req, res) => {
  try {
    deleteTrackedItem(req.params.worldId, req.params.itemId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- NPCs (world templates) ----------

app.get('/api/worlds/:id/npcs', (req, res) => {
  try {
    getWorld(req.params.id);
    res.json(db.get('worldNpcs').filter({ worldId: req.params.id }).value());
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.post('/api/worlds/:id/npcs', (req, res) => {
  try {
    const { name, role, detail, oneLiner, appearance, location } = req.body;
    const npc = addNpc(req.params.id, { name, role, detail, oneLiner, appearance, location });
    res.json({ ok: true, npc });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/worlds/:worldId/npcs/:npcId', (req, res) => {
  try {
    const { name, role, detail, oneLiner, appearance, location } = req.body;
    const npc = updateNpc(req.params.worldId, req.params.npcId, { name, role, detail, oneLiner, appearance, location });
    res.json({ ok: true, npc });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/worlds/:worldId/npcs/:npcId', (req, res) => {
  try {
    deleteNpc(req.params.worldId, req.params.npcId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Saves (one playthrough of a world) ----------

app.get('/api/saves', (req, res) => {
  const saves = db.get('saves').value();
  const list = saves.map(s => {
    const world = db.get('worlds').find({ id: s.worldId }).value();
    const lastTurn = db.get('turns').filter({ saveId: s.id }).sortBy('turnNumber').last().value();
    return {
      ...publicSave(s),
      worldTitle: world ? world.title : '(monde supprimé)',
      worldTone: world ? world.tone : '',
      coverImageUrl: world ? world.coverImageUrl : null,
      turnCount: db.get('turns').filter({ saveId: s.id }).size().value(),
      lastAction: lastTurn ? lastTurn.playerAction : null
    };
  });
  res.json(list);
});

app.post('/api/worlds/:id/saves', (req, res) => {
  try {
    const result = createSave(req.params.id);
    const itemDefs = db.get('trackedItemDefs').filter({ worldId: req.params.id }).value();
    res.json({ save: publicSave(result.save), openingTurn: publicTurn(result.openingTurn, { debug: false, itemDefs }) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/saves/:id', (req, res) => {
  try {
    const debug = req.query.debug === '1' || req.query.debug === 'true';
    const save = getSave(req.params.id);
    const world = getWorld(save.worldId);
    const itemDefs = db.get('trackedItemDefs').filter({ worldId: world.id }).value();
    const turns = db.get('turns').filter({ saveId: save.id }).sortBy('turnNumber').value()
      .map(t => publicTurn(t, { debug, itemDefs }));
    // The "frise chronologique" (see the time-skip mechanic): every past
    // skip in this save, for the pagination UI to badge the turn it
    // happened on. Refreshed on every reload of the save, including right
    // after a streamed turn completes (see app.js's refreshSave), so a
    // skip appears the moment it's recorded.
    const timelineEvents = db.get('timelineEvents').filter({ saveId: save.id }).sortBy('turnNumber').value();
    // Lean on purpose (no status/appearance/location/facts -- author-only
    // detail, not needed client-side): just enough for the POV picker (see
    // the POV mechanic) to list who the player can switch perspective to.
    const saveCharacters = db.get('saveCharacters').filter({ saveId: save.id }).value()
      .map(c => ({ id: c.id, name: c.name, role: c.role, oneLiner: c.oneLiner }));
    // The Proofreader's pacing-contradiction flags (see roles/proofreader.js,
    // Milestone 3): author-mode-only, same treatment as secretInfo above --
    // never sent to a non-debug request, since these are meant for the
    // author to judge, not something the player should see mid-story.
    const proofreaderFlags = debug
      ? db.get('proofreaderFlags').filter({ saveId: save.id }).sortBy('turnNumber').value()
      : [];
    res.json({
      save: debug ? save : publicSave(save),
      world,
      turns,
      timelineEvents,
      saveCharacters,
      proofreaderFlags,
      playableCharacters: worldPlayableCharacters(world.id)
    });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.delete('/api/saves/:id', (req, res) => {
  try {
    deleteSave(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Manual "purge all turn images now" for a save — the automatic cap (see
// pruneOldTurnImages in gameEngine.js) already keeps only the last 10, but
// an author who wants to reclaim space right away shouldn't have to wait
// for that many more turns to cycle it out.
app.post('/api/saves/:id/purge-images', (req, res) => {
  try {
    const result = purgeSaveImages(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/saves/:id/select-character', (req, res) => {
  try {
    const { characterId } = req.body;
    if (!characterId) return res.status(400).json({ error: 'characterId is required' });
    const character = selectCharacter(req.params.id, characterId);
    res.json({ ok: true, character });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/saves/:id/continue', (req, res) => {
  try {
    const save = continueAfterVictory(req.params.id);
    res.json({ ok: true, save: publicSave(save) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/saves/:id/turn', async (req, res) => {
  try {
    const { action, authorMode, authorNote, debug, providerOverride } = req.body;
    if (!action || !action.trim()) return res.status(400).json({ error: 'action is required' });
    const save = getSave(req.params.id);
    const turn = await playTurn(req.params.id, action.trim(), {
      authorMode: Boolean(authorMode),
      authorNote: authorNote && authorNote.trim() ? authorNote.trim() : undefined,
      providerOverride
    });
    const itemDefs = db.get('trackedItemDefs').filter({ worldId: save.worldId }).value();
    res.json(publicTurn(turn, { debug: Boolean(debug), itemDefs }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Streaming counterpart of the route above: same effect (persists a turn
// exactly the same way, via the shared playTurnStreaming/persistTurn path),
// but the response is newline-delimited JSON events instead of one JSON
// object, so the client can show the chapter text as it's written instead
// of waiting for the whole turn (narration + state) to finish. Each line is
// one of: {"type":"chunk","text":...}, {"type":"done","turn":...}, or
// {"type":"error","message":...} (terminal either way).
app.post('/api/saves/:id/turn/stream', async (req, res) => {
  const { action, authorMode, authorNote, debug, providerOverride } = req.body;
  if (!action || !action.trim()) return res.status(400).json({ error: 'action is required' });

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no' // ask any reverse proxy in front of Railway not to buffer this
  });
  const send = (event) => res.write(JSON.stringify(event) + '\n');

  try {
    const save = getSave(req.params.id);
    const turn = await playTurnStreaming(req.params.id, action.trim(), {
      authorMode: Boolean(authorMode),
      authorNote: authorNote && authorNote.trim() ? authorNote.trim() : undefined,
      providerOverride,
      onChapterChunk: (text) => send({ type: 'chunk', text })
    });
    const itemDefs = db.get('trackedItemDefs').filter({ worldId: save.worldId }).value();
    send({ type: 'done', turn: publicTurn(turn, { debug: Boolean(debug), itemDefs }) });
  } catch (e) {
    console.error(e);
    send({ type: 'error', message: e.message });
  } finally {
    res.end();
  }
});

// The explicit, player-requested half of the time-skip mechanic (see
// PACING & TIME SKIPS in lib/promptBuilder.js for the autonomous half,
// which needs no separate route -- the Writer can already decide to skip
// on any normal turn). Same newline-delimited JSON event protocol as
// POST .../turn/stream. hint is optional free text for what the skip
// should cover or lead to.
app.post('/api/saves/:id/time-skip/stream', async (req, res) => {
  const { hint, debug, providerOverride } = req.body;

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no'
  });
  const send = (event) => res.write(JSON.stringify(event) + '\n');

  try {
    const save = getSave(req.params.id);
    const turn = await playTimeSkipStreaming(req.params.id, hint, {
      providerOverride,
      onChapterChunk: (text) => send({ type: 'chunk', text })
    });
    const itemDefs = db.get('trackedItemDefs').filter({ worldId: save.worldId }).value();
    send({ type: 'done', turn: publicTurn(turn, { debug: Boolean(debug), itemDefs }) });
  } catch (e) {
    console.error(e);
    send({ type: 'error', message: e.message });
  } finally {
    res.end();
  }
});

// The player/author-initiated half of the POV mechanic (see
// lib/memoryFacts.js's knownBy and buildPovPrompt in lib/promptBuilder.js
// for how the knowledge wall is enforced). Same newline-delimited JSON
// event protocol as the routes above. character is required (an exact
// name from GET /api/saves/:id's saveCharacters); hint is optional free
// text for what the scene should show.
app.post('/api/saves/:id/pov/stream', async (req, res) => {
  const { character, hint, debug, providerOverride } = req.body;
  if (!character || !character.trim()) {
    res.status(400).json({ error: 'character is required' });
    return;
  }

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no'
  });
  const send = (event) => res.write(JSON.stringify(event) + '\n');

  try {
    const save = getSave(req.params.id);
    const turn = await playPovTurnStreaming(req.params.id, character.trim(), hint, {
      providerOverride,
      onChapterChunk: (text) => send({ type: 'chunk', text })
    });
    const itemDefs = db.get('trackedItemDefs').filter({ worldId: save.worldId }).value();
    send({ type: 'done', turn: publicTurn(turn, { debug: Boolean(debug), itemDefs }) });
  } catch (e) {
    console.error(e);
    send({ type: 'error', message: e.message });
  } finally {
    res.end();
  }
});

app.post('/api/saves/:id/turns/:turnNumber/regenerate', async (req, res) => {
  try {
    const { action, note, debug, providerOverride } = req.body;
    const turnNumber = Number(req.params.turnNumber);
    const save = getSave(req.params.id);
    const turn = await regenerateTurn(req.params.id, turnNumber, { action, note, providerOverride });
    const itemDefs = db.get('trackedItemDefs').filter({ worldId: save.worldId }).value();
    res.json(publicTurn(turn, { debug: Boolean(debug), itemDefs }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Streaming counterpart of the route above — same newline-delimited JSON
// event protocol as POST /api/saves/:id/turn/stream.
app.post('/api/saves/:id/turns/:turnNumber/regenerate/stream', async (req, res) => {
  const { action, note, debug, providerOverride } = req.body;
  const turnNumber = Number(req.params.turnNumber);

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no'
  });
  const send = (event) => res.write(JSON.stringify(event) + '\n');

  try {
    const save = getSave(req.params.id);
    const turn = await regenerateTurnStreaming(req.params.id, turnNumber, {
      action, note, providerOverride,
      onChapterChunk: (text) => send({ type: 'chunk', text })
    });
    const itemDefs = db.get('trackedItemDefs').filter({ worldId: save.worldId }).value();
    send({ type: 'done', turn: publicTurn(turn, { debug: Boolean(debug), itemDefs }) });
  } catch (e) {
    console.error(e);
    send({ type: 'error', message: e.message });
  } finally {
    res.end();
  }
});

app.post('/api/saves/:id/rewind', (req, res) => {
  try {
    const { turnNumber } = req.body;
    if (typeof turnNumber !== 'number') return res.status(400).json({ error: 'turnNumber is required' });
    const save = rewindToTurn(req.params.id, turnNumber);
    res.json({ ok: true, save: publicSave(save) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Costs ----------

app.get('/api/costs', (req, res) => {
  res.json(getTotalCosts());
});

app.get('/api/worlds/:id/costs', (req, res) => {
  res.json(getWorldCosts(req.params.id));
});

// ---------- Settings ----------

app.get('/api/settings', (req, res) => {
  const settings = getSettings();
  // Never send raw keys back to the client — only whether each is set.
  const safe = {
    ...settings,
    apiKeys: Object.fromEntries(Object.entries(settings.apiKeys).map(([k, v]) => [k, Boolean(v)])),
    backgroundModel: { apiKey: Boolean(settings.backgroundModel && settings.backgroundModel.apiKey) }
  };
  res.json(safe);
});

app.post('/api/settings', (req, res) => {
  const current = db.get('settings').value();
  const {
    textProvider, textModel, ollamaBaseUrl, fallbackProvider, fallbackModel,
    language, chapterLength, imageProvider, imageModel, imagesEnabled, localImageBaseUrl,
    embeddingProvider, apiKeys, backgroundModel
  } = req.body;
  const next = {
    textProvider: textProvider ?? current.textProvider,
    textModel: textModel ?? current.textModel,
    ollamaBaseUrl: ollamaBaseUrl ?? current.ollamaBaseUrl,
    fallbackProvider: fallbackProvider ?? current.fallbackProvider,
    fallbackModel: fallbackModel ?? current.fallbackModel,
    language: language ?? current.language,
    // Snapped to the nearest 100 within [100, 1000] -- matches the settings
    // slider's step, and keeps a malformed/out-of-range value from a raw API
    // call reaching the prompt builder.
    chapterLength: Number.isFinite(Number(chapterLength))
      ? Math.min(1000, Math.max(100, Math.round(Number(chapterLength) / 100) * 100))
      : current.chapterLength,
    imageProvider: imageProvider ?? current.imageProvider,
    imageModel: imageModel !== undefined ? (imageModel || null) : current.imageModel,
    imagesEnabled: typeof imagesEnabled === 'boolean' ? imagesEnabled : current.imagesEnabled,
    localImageBaseUrl: localImageBaseUrl ?? current.localImageBaseUrl,
    // See providers/embeddingProviders.js (the Retriever role, Milestone 2)
    // -- 'gemini' reuses apiKeys.gemini below, no separate key needed.
    embeddingProvider: embeddingProvider ?? current.embeddingProvider,
    apiKeys: { ...current.apiKeys, ...(apiKeys || {}) },
    // Locked-model background roles (Archivist/Proofreader/Mastermind) --
    // see lib/backgroundModel.js. Only field here is the key itself.
    backgroundModel: { ...current.backgroundModel, ...(backgroundModel || {}) }
  };
  db.set('settings', next).write();
  res.json({ ok: true });
});

// ---------- Ollama bridge (status + installed models) ----------

app.get('/api/ollama/status', async (req, res) => {
  const status = await getOllamaStatus();
  res.json(status);
});

app.get('/api/ollama/models', async (req, res) => {
  try {
    const models = await listAvailableOllamaModels();
    res.json({ models });
  } catch (e) {
    res.status(502).json({ error: e.message, models: [] });
  }
});

// ---------- Local Stable Diffusion (installed checkpoints) ----------

app.get('/api/localsd/models', async (req, res) => {
  try {
    const models = await listAvailableLocalSdModels();
    res.json({ models });
  } catch (e) {
    res.status(502).json({ error: e.message, models: [] });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Trame listening on port ${PORT}`));
