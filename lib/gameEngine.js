const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { generateText, streamText, listOllamaModels, getOllamaBridgeStatus } = require('../providers/textProviders');
const { generateImage, listLocalSdModels } = require('../providers/imageProviders');
const { recordCost } = require('./costTracker');
const { normalizeNewFact, newMemoryFact } = require('./memoryFacts');
const { embedFact } = require('./embedFact');
const archivist = require('../roles/archivist');
const retriever = require('../roles/retriever');
const {
  buildWorldCreationPrompt, buildTurnPrompt, buildSummaryPrompt, buildImagePrompt,
  buildCharacterGenerationPrompt, buildWorldAiEditPrompt,
  buildNarrationPrompt, buildStatePrompt, splitNarrationResponse, NARRATION_END_MARKER,
  buildTimeSkipPrompt
} = require('./promptBuilder');

const RECENT_TURNS_WINDOW = 5;
const SUMMARIZE_EVERY = 10;
const RELEVANT_FACTS_LIMIT = 20;
// Turn images are base64 data URIs for most providers, stored inline in
// the database -- unlike chapter text, that's several hundred KB to a few MB per
// image with nothing to ever clear it, so a long save's image history alone
// can grow the whole database file without bound. Only the imageUrl of
// older turns is cleared (see pruneOldTurnImages) -- the turn itself
// (chapter text, snapshot) stays, since pagination/rewind still need it.
const MAX_STORED_TURN_IMAGES = 10;
const imagesDataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// Local images live at DATA_DIR/images/<file>, served as /images/<file>
// (see providers/imageProviders.js and server.js) -- anywhere an image URL
// is being replaced or cleared, delete the backing file too, or disk usage
// grows unbounded the same way the database used to. A no-op for null or an
// externally-hosted URL (e.g. Replicate), since there's nothing local to
// remove.
function deleteLocalImageFile(url) {
  if (!url || !url.startsWith('/images/')) return;
  try {
    fs.unlinkSync(path.join(imagesDataDir, url));
  } catch (e) {
    // Already gone, or never existed locally -- fine either way.
  }
}

function parseModelJSON(raw) {
  // Models occasionally wrap JSON in prose or code fences despite instructions;
  // this strips the common cases before parsing.
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // A response that doesn't end with a closing brace was almost certainly
    // cut off by an output-token cap before the model finished — a much
    // more useful diagnosis than a bare "Unexpected end of JSON input" when
    // this shows up in logs.
    if (!cleaned.endsWith('}')) {
      throw new Error(`Model response was truncated before valid JSON completed (likely hit a max output token limit) — got ${cleaned.length} chars: ...${cleaned.slice(-120)}`);
    }
    throw e;
  }
}

function getSettings() {
  return db.get('settings').value();
}

// providerOverride lets a single call use a different provider/model than
// the persisted settings, without writing anything back — used for the
// one-turn-only fallback offered when the primary provider (typically a
// local Ollama bridge) is reported offline or busy.
async function callText({ system, user, kind, worldId, saveId, providerOverride }) {
  const settings = getSettings();
  const provider = providerOverride?.provider || settings.textProvider;
  const model = providerOverride ? providerOverride.model : settings.textModel;
  const { text, usage } = await generateText({
    provider,
    system,
    user,
    apiKey: settings.apiKeys[provider],
    model,
    baseUrl: settings.ollamaBaseUrl
  });
  recordCost({ worldId, saveId, kind, provider, model, usage });
  return text;
}

// Same as callText, but streamed -- for callers that want to report real
// progress (raw chars received) while the model is still generating, rather
// than only knowing when the whole response finally lands.
async function streamTextTracked({ system, user, kind, worldId, saveId, onDelta }) {
  const settings = getSettings();
  const provider = settings.textProvider;
  const model = settings.textModel;
  const { text, usage } = await streamText({
    provider,
    system,
    user,
    apiKey: settings.apiKeys[provider],
    model,
    baseUrl: settings.ollamaBaseUrl,
    onDelta: onDelta || (() => {})
  });
  recordCost({ worldId, saveId, kind, provider, model, usage });
  return text;
}

async function listAvailableOllamaModels() {
  const settings = getSettings();
  return listOllamaModels({ apiKey: settings.apiKeys.ollama, baseUrl: settings.ollamaBaseUrl });
}

async function getOllamaStatus() {
  const settings = getSettings();
  return getOllamaBridgeStatus({ apiKey: settings.apiKeys.ollama, baseUrl: settings.ollamaBaseUrl });
}

async function listAvailableLocalSdModels() {
  const settings = getSettings();
  return listLocalSdModels({ apiKey: settings.apiKeys.localsd, baseUrl: settings.localImageBaseUrl });
}

// ---------- World templates ----------
// A world is a reusable template: create it once, then start as many
// independent saves from it as you like — each save gets its own turns,
// character choice, tracked-item values, and hidden state.

async function createWorld(playerIdea, language, { onChunk } = {}) {
  const settings = getSettings();
  // Baked onto the world at creation time, not read live from settings on
  // every turn afterwards — a world's own instructions/scenes are already
  // written in this language, and a later global setting change shouldn't
  // fight against that (see TODO.md: language now sticks per-world).
  const worldLanguage = language || settings.language;
  const worldId = uuid(); // generated up front so the creation call's cost can be attributed to it
  const { system, user } = buildWorldCreationPrompt(playerIdea, worldLanguage);
  // Streamed (rather than a single awaited callText) so an onChunk callback
  // can report real progress -- see POST /api/worlds/stream -- instead of
  // the old purely cosmetic progress bar. Raw JSON deltas aren't meant to be
  // shown to the player; the caller only cares about the running length.
  const raw = await streamTextTracked({ system, user, kind: 'world_creation', worldId, onDelta: onChunk });
  const parsed = parseModelJSON(raw);

  const world = {
    id: worldId,
    title: parsed.title,
    description: parsed.description || '',
    objective: parsed.objective || null,
    mature: Boolean(parsed.mature_content),
    contentWarnings: parsed.content_warnings || [],
    version: '1.00',
    language: worldLanguage,
    setting: parsed.setting,
    tone: parsed.tone,
    rules: parsed.rules || [],
    instructions: parsed.instructions || '',
    authorStyle: parsed.author_style || '',
    skills: parsed.skills || [],
    startingScene: parsed.starting_scene,
    openingChapter: parsed.opening_chapter,
    background: parsed.background || '',
    firstAction: parsed.first_action || null,
    victoryCondition: parsed.victory_condition || null,
    victoryText: parsed.victory_text || null,
    defeatCondition: parsed.defeat_condition || null,
    defeatText: parsed.defeat_text || null,
    imageStyle: parsed.image_style || '',
    imageStylePrefix: parsed.image_style_prefix || '',
    imageStyleSuffix: parsed.image_style_suffix || '',
    imageModel: null, // optional per-world override; null = provider default
    coverImageUrl: null,
    coverImagePromptOverride: null, // author-edited replacement for the auto-built cover description; null = auto
    characterSelectText: parsed.character_select_text || null, // shown to the player at character selection, in addition to the mature-content warning
    designNotes: playerIdea, // author-only note, never sent to the AI — the idea this world was generated from
    createdAt: new Date().toISOString()
  };

  if (settings.imagesEnabled) {
    try {
      world.coverImageUrl = await generateCoverImage(world, settings);
    } catch (e) {
      // A missing cover image is cosmetic — never block world creation on it.
      world.coverImageUrl = null;
    }
  }

  db.get('worlds').push(world).write();

  const playableCharacters = (parsed.playable_characters || []).map(c => ({
    id: uuid(), worldId: world.id, name: c.name, description: c.description, skills: c.skills || {},
    initialTrackedItemValues: c.initial_tracked_item_values || {},
    portraitUrl: null,
    portraitPromptOverride: null // author-edited replacement for the auto-built portrait description; null = auto
  }));
  if (settings.imagesEnabled) {
    for (const c of playableCharacters) {
      c.portraitUrl = await generateCharacterPortrait(world, c);
    }
  }
  playableCharacters.forEach(c => db.get('playableCharacters').push(c).write());

  (parsed.tracked_items || []).forEach(i => {
    db.get('trackedItemDefs').push({
      id: uuid(),
      worldId: world.id,
      name: i.name,
      dataType: i.data_type === 'number' ? 'number' : 'text',
      description: i.description,
      visibility: i.visibility === 'ai_only' ? 'ai_only' : 'player_and_ai',
      updateAutomatically: Boolean(i.update_automatically),
      updateInstructions: i.update_instructions || '',
      initialValue: i.initial_value ?? (i.data_type === 'number' ? 0 : '')
    }).write();
  });

  (parsed.starting_characters || []).forEach(c => {
    db.get('worldNpcs').push({
      id: uuid(),
      worldId: world.id,
      name: c.name,
      role: c.role,
      detail: c.detail || c.description || '',
      oneLiner: c.one_liner || '',
      appearance: c.appearance || '',
      location: c.location || ''
    }).write();
  });

  return { world, playableCharacters };
}

function getWorld(worldId) {
  const world = db.get('worlds').find({ id: worldId }).value();
  if (!world) throw new Error('World not found');
  return world;
}

function bumpVersion(version) {
  const n = parseFloat(version);
  return (Number.isFinite(n) ? n + 0.01 : 1.01).toFixed(2);
}

function defaultCoverPromptText(world) {
  return `Cover art for "${world.title}": ${world.setting}`;
}

function generateCoverImage(world, settings, promptText) {
  const effectivePrompt = (promptText && promptText.trim()) || world.coverImagePromptOverride || defaultCoverPromptText(world);
  return generateImage({
    provider: settings.imageProvider,
    prompt: buildImagePrompt(world, effectivePrompt),
    apiKey: settings.apiKeys[settings.imageProvider],
    model: world.imageModel || settings.imageModel,
    baseUrl: settings.localImageBaseUrl
  });
}

// "Open the cover image" flow, step 1: generates a fresh image from either
// the given prompt text or the world's current effective prompt, WITHOUT
// touching the database — the author gets to look at it before deciding
// whether it's worth keeping (see acceptWorldCover).
async function previewWorldCover(worldId, promptText) {
  const world = getWorld(worldId);
  const settings = getSettings();
  if (!settings.imagesEnabled) throw new Error('Image generation is disabled in Settings');
  const effectivePrompt = (promptText && promptText.trim()) || world.coverImagePromptOverride || defaultCoverPromptText(world);
  const imageUrl = await generateCoverImage(world, settings, effectivePrompt);
  if (!imageUrl) throw new Error('Image generation returned nothing');
  return { imageUrl, prompt: effectivePrompt };
}

// Step 2: only ever called once the author has looked at a preview (from
// the route above) and chosen to keep it — replaces the actual cover, and
// remembers the prompt that produced it so it's pre-filled next time.
function acceptWorldCover(worldId, imageUrl, promptText) {
  const world = getWorld(worldId);
  if (!imageUrl) throw new Error('imageUrl is required');
  deleteLocalImageFile(world.coverImageUrl);
  db.get('worlds').find({ id: worldId }).assign({
    coverImageUrl: imageUrl,
    coverImagePromptOverride: (promptText && promptText.trim()) || null,
    version: bumpVersion(world.version)
  }).write();
  return db.get('worlds').find({ id: worldId }).value();
}

// Manual edits from the world-editor form. Fields previously reachable only
// through the AI retouch (title, skills, setting/tone/rules, victory/defeat)
// are now directly editable too — a natural-language retouch is
// disproportionate for renaming a world or fixing a single skill.
function updateWorld(worldId, {
  title, instructions, authorStyle, imageStyle, imageStylePrefix, imageStyleSuffix, imageModel,
  description, objective, background, firstAction, mature, contentWarnings,
  setting, tone, rules, skills, victoryCondition, victoryText, defeatCondition, defeatText,
  characterSelectText, designNotes
}) {
  const world = getWorld(worldId);
  const next = {
    title: title !== undefined ? title : world.title,
    instructions: instructions !== undefined ? instructions : world.instructions,
    authorStyle: authorStyle !== undefined ? authorStyle : world.authorStyle,
    imageStyle: imageStyle !== undefined ? imageStyle : world.imageStyle,
    imageStylePrefix: imageStylePrefix !== undefined ? imageStylePrefix : world.imageStylePrefix,
    imageStyleSuffix: imageStyleSuffix !== undefined ? imageStyleSuffix : world.imageStyleSuffix,
    imageModel: imageModel !== undefined ? imageModel : world.imageModel,
    description: description !== undefined ? description : world.description,
    objective: objective !== undefined ? objective : world.objective,
    background: background !== undefined ? background : world.background,
    firstAction: firstAction !== undefined ? firstAction : world.firstAction,
    mature: mature !== undefined ? Boolean(mature) : world.mature,
    contentWarnings: contentWarnings !== undefined ? contentWarnings : world.contentWarnings,
    setting: setting !== undefined ? setting : world.setting,
    tone: tone !== undefined ? tone : world.tone,
    rules: rules !== undefined ? rules : world.rules,
    skills: skills !== undefined ? skills : world.skills,
    victoryCondition: victoryCondition !== undefined ? victoryCondition : world.victoryCondition,
    victoryText: victoryText !== undefined ? victoryText : world.victoryText,
    defeatCondition: defeatCondition !== undefined ? defeatCondition : world.defeatCondition,
    defeatText: defeatText !== undefined ? defeatText : world.defeatText,
    characterSelectText: characterSelectText !== undefined ? characterSelectText : world.characterSelectText,
    designNotes: designNotes !== undefined ? designNotes : world.designNotes,
    version: bumpVersion(world.version)
  };
  db.get('worlds').find({ id: worldId }).assign(next).write();
  return db.get('worlds').find({ id: worldId }).value();
}

// "Regenerate cover image" button in the world editor — the cover is
// otherwise only ever set once, at creation, with no way to retry or
// refresh it afterwards.
async function regenerateWorldCover(worldId) {
  const world = getWorld(worldId);
  const settings = getSettings();
  if (!settings.imagesEnabled) throw new Error('Image generation is disabled in Settings');
  const coverImageUrl = await generateCoverImage(world, settings);
  deleteLocalImageFile(world.coverImageUrl);
  db.get('worlds').find({ id: worldId }).assign({ coverImageUrl, version: bumpVersion(world.version) }).write();
  return db.get('worlds').find({ id: worldId }).value();
}

// A light AI retouch: "make the tone darker", "add a rival character to the
// premise", etc. Only touches the world's core narrative fields — never
// playable characters, tracked items, or the opening chapter, since saves
// already depend on those staying put.
async function aiEditWorld(worldId, instruction) {
  const world = getWorld(worldId);
  const { system, user } = buildWorldAiEditPrompt(world, instruction);
  const raw = await callText({ system, user, kind: 'world_ai_edit', worldId });
  const parsed = parseModelJSON(raw);
  const next = {
    title: parsed.title ?? world.title,
    description: parsed.description ?? world.description,
    objective: parsed.objective ?? world.objective,
    background: parsed.background ?? world.background,
    firstAction: parsed.first_action ?? world.firstAction,
    mature: typeof parsed.mature_content === 'boolean' ? parsed.mature_content : world.mature,
    contentWarnings: parsed.content_warnings ?? world.contentWarnings,
    setting: parsed.setting ?? world.setting,
    tone: parsed.tone ?? world.tone,
    rules: parsed.rules ?? world.rules,
    instructions: parsed.instructions ?? world.instructions,
    authorStyle: parsed.author_style ?? world.authorStyle,
    skills: parsed.skills ?? world.skills,
    victoryCondition: parsed.victory_condition ?? world.victoryCondition,
    victoryText: parsed.victory_text ?? world.victoryText,
    defeatCondition: parsed.defeat_condition ?? world.defeatCondition,
    defeatText: parsed.defeat_text ?? world.defeatText,
    imageStyle: parsed.image_style ?? world.imageStyle,
    imageStylePrefix: parsed.image_style_prefix ?? world.imageStylePrefix,
    imageStyleSuffix: parsed.image_style_suffix ?? world.imageStyleSuffix,
    version: bumpVersion(world.version)
  };
  db.get('worlds').find({ id: worldId }).assign(next).write();
  return db.get('worlds').find({ id: worldId }).value();
}

// ---------- Playable characters (world templates) ----------

function defaultPortraitPromptText(character) {
  return `Portrait of ${character.name}: ${character.description}`;
}

// Shared by every path that actually calls the image provider for a
// portrait (creation, manual add, regenerate, preview) so the prompt-
// resolution rule (explicit override > saved character override > auto)
// only lives in one place. Throws on failure — callers that must never
// block on a missing portrait (creation) catch it themselves.
function generatePortraitImage(world, character, settings, promptText) {
  const effectivePrompt = (promptText && promptText.trim()) || character.portraitPromptOverride || defaultPortraitPromptText(character);
  return generateImage({
    provider: settings.imageProvider,
    prompt: buildImagePrompt(world, effectivePrompt),
    apiKey: settings.apiKeys[settings.imageProvider],
    model: world.imageModel || settings.imageModel,
    baseUrl: settings.localImageBaseUrl
  });
}

// A character portrait is only ever shown at selection time, never in
// gameplay itself (matching Infinite Worlds) — a missing/failed portrait is
// cosmetic and never blocks creating or playing a character.
async function generateCharacterPortrait(world, character) {
  const settings = getSettings();
  if (!settings.imagesEnabled) return null;
  try {
    return await generatePortraitImage(world, character, settings);
  } catch (e) {
    console.error(`[image] Character portrait generation failed (world ${world.id}, provider ${settings.imageProvider}): ${e.message}`);
    return null;
  }
}

function addCharacter(worldId, { name, description, skills, initialTrackedItemValues }) {
  const world = getWorld(worldId);
  if (!name || !name.trim()) throw new Error('name is required');
  const character = {
    id: uuid(),
    worldId,
    name: name.trim(),
    description: description || '',
    skills: skills || Object.fromEntries((world.skills || []).map(s => [s, 3])),
    initialTrackedItemValues: initialTrackedItemValues || {},
    portraitUrl: null,
    portraitPromptOverride: null
  };
  db.get('playableCharacters').push(character).write();
  return character;
}

// A manually-added character used to be the one path that never got a
// portrait at all (unlike an AI-generated one, or one from world creation)
// -- left the author to notice the missing image and hunt down the
// "Regenerate portrait" button themselves. Generated the same way as any
// other character now, right after the row exists; still best-effort (a
// failure here never blocks adding the character, same reasoning as
// generateCharacterPortrait's own try/catch).
async function addCharacterWithPortrait(worldId, fields) {
  const world = getWorld(worldId);
  const character = addCharacter(worldId, fields);
  const settings = getSettings();
  if (settings.imagesEnabled) {
    character.portraitUrl = await generateCharacterPortrait(world, character);
    db.get('playableCharacters').find({ id: character.id, worldId }).assign({ portraitUrl: character.portraitUrl }).write();
  }
  return character;
}

async function generateCharacterWithAI(worldId, description) {
  const world = getWorld(worldId);
  if (!description || !description.trim()) throw new Error('description is required');
  const { system, user } = buildCharacterGenerationPrompt(world, description.trim());
  const raw = await callText({ system, user, kind: 'character_generation', worldId });
  const parsed = parseModelJSON(raw);
  const character = {
    id: uuid(),
    worldId,
    name: parsed.name,
    description: parsed.description || '',
    skills: parsed.skills || {},
    initialTrackedItemValues: {},
    portraitUrl: null,
    portraitPromptOverride: null
  };
  character.portraitUrl = await generateCharacterPortrait(world, character);
  db.get('playableCharacters').push(character).write();
  return character;
}

function updateCharacter(worldId, characterId, { name, description, skills, initialTrackedItemValues }) {
  const character = db.get('playableCharacters').find({ id: characterId, worldId }).value();
  if (!character) throw new Error('Character not found');
  const next = {
    name: name !== undefined ? name : character.name,
    description: description !== undefined ? description : character.description,
    skills: skills !== undefined ? skills : character.skills,
    initialTrackedItemValues: initialTrackedItemValues !== undefined ? initialTrackedItemValues : character.initialTrackedItemValues
  };
  db.get('playableCharacters').find({ id: characterId, worldId }).assign(next).write();
  return db.get('playableCharacters').find({ id: characterId, worldId }).value();
}

function deleteCharacter(worldId, characterId) {
  const character = db.get('playableCharacters').find({ id: characterId, worldId }).value();
  if (!character) throw new Error('Character not found');
  deleteLocalImageFile(character.portraitUrl);
  db.get('playableCharacters').remove({ id: characterId, worldId }).write();
}

// "Regenerate portrait" button — separate from updateCharacter because it's
// an async AI call the manual-edit form shouldn't have to wait on, and
// because it's meaningful to retry independently of any other field.
async function regenerateCharacterPortrait(worldId, characterId) {
  const world = getWorld(worldId);
  const settings = getSettings();
  if (!settings.imagesEnabled) throw new Error('Image generation is disabled in Settings');
  const character = db.get('playableCharacters').find({ id: characterId, worldId }).value();
  if (!character) throw new Error('Character not found');
  const portraitUrl = await generatePortraitImage(world, character, settings);
  deleteLocalImageFile(character.portraitUrl);
  db.get('playableCharacters').find({ id: characterId, worldId }).assign({ portraitUrl }).write();
  return db.get('playableCharacters').find({ id: characterId, worldId }).value();
}

// "Open the portrait" flow, step 1 — mirrors previewWorldCover: generates
// from the given (or current effective) prompt without writing anything.
async function previewCharacterPortrait(worldId, characterId, promptText) {
  const world = getWorld(worldId);
  const settings = getSettings();
  if (!settings.imagesEnabled) throw new Error('Image generation is disabled in Settings');
  const character = db.get('playableCharacters').find({ id: characterId, worldId }).value();
  if (!character) throw new Error('Character not found');
  const effectivePrompt = (promptText && promptText.trim()) || character.portraitPromptOverride || defaultPortraitPromptText(character);
  const imageUrl = await generatePortraitImage(world, character, settings, effectivePrompt);
  if (!imageUrl) throw new Error('Image generation returned nothing');
  return { imageUrl, prompt: effectivePrompt };
}

// Step 2 — mirrors acceptWorldCover: only called once the author has looked
// at the preview and chosen to keep it.
function acceptCharacterPortrait(worldId, characterId, imageUrl, promptText) {
  const character = db.get('playableCharacters').find({ id: characterId, worldId }).value();
  if (!character) throw new Error('Character not found');
  if (!imageUrl) throw new Error('imageUrl is required');
  deleteLocalImageFile(character.portraitUrl);
  db.get('playableCharacters').find({ id: characterId, worldId }).assign({
    portraitUrl: imageUrl,
    portraitPromptOverride: (promptText && promptText.trim()) || null
  }).write();
  return db.get('playableCharacters').find({ id: characterId, worldId }).value();
}

// ---------- Tracked items (world templates) ----------
// Generated once at world creation, but editable afterwards like playable
// characters — adding one doesn't retroactively touch in-progress saves
// (playTurn already falls back to a def's initialValue when a save has no
// value row yet for it), and deleting one cleans up any current values so
// no save is left pointing at a tracked-item def that no longer exists.

function addTrackedItem(worldId, { name, dataType, description, visibility, updateAutomatically, updateInstructions, initialValue }) {
  getWorld(worldId);
  if (!name || !name.trim()) throw new Error('name is required');
  const item = {
    id: uuid(),
    worldId,
    name: name.trim(),
    dataType: dataType === 'number' ? 'number' : 'text',
    description: description || '',
    visibility: visibility === 'ai_only' ? 'ai_only' : 'player_and_ai',
    updateAutomatically: Boolean(updateAutomatically),
    updateInstructions: updateInstructions || '',
    initialValue: initialValue ?? (dataType === 'number' ? 0 : '')
  };
  db.get('trackedItemDefs').push(item).write();
  return item;
}

function updateTrackedItem(worldId, itemId, { name, dataType, description, visibility, updateAutomatically, updateInstructions, initialValue }) {
  const item = db.get('trackedItemDefs').find({ id: itemId, worldId }).value();
  if (!item) throw new Error('Tracked item not found');
  const next = {
    name: name !== undefined ? name : item.name,
    dataType: dataType !== undefined ? (dataType === 'number' ? 'number' : 'text') : item.dataType,
    description: description !== undefined ? description : item.description,
    visibility: visibility !== undefined ? (visibility === 'ai_only' ? 'ai_only' : 'player_and_ai') : item.visibility,
    updateAutomatically: updateAutomatically !== undefined ? Boolean(updateAutomatically) : item.updateAutomatically,
    updateInstructions: updateInstructions !== undefined ? updateInstructions : item.updateInstructions,
    initialValue: initialValue !== undefined ? initialValue : item.initialValue
  };
  db.get('trackedItemDefs').find({ id: itemId, worldId }).assign(next).write();
  return db.get('trackedItemDefs').find({ id: itemId, worldId }).value();
}

function deleteTrackedItem(worldId, itemId) {
  const item = db.get('trackedItemDefs').find({ id: itemId, worldId }).value();
  if (!item) throw new Error('Tracked item not found');
  db.get('saveTrackedItemValues').remove({ itemDefId: itemId }).write();
  db.get('trackedItemDefs').remove({ id: itemId, worldId }).write();
}

// ---------- NPCs (world templates) ----------
// Each save copies these into its own saveCharacters row at creation time
// and evolves independently from there — editing or deleting the world-level
// template afterwards never touches an already-created save's own copy.

function addNpc(worldId, { name, role, detail, oneLiner, appearance, location }) {
  getWorld(worldId);
  if (!name || !name.trim()) throw new Error('name is required');
  const npc = {
    id: uuid(),
    worldId,
    name: name.trim(),
    role: role || '',
    detail: detail || '',
    oneLiner: oneLiner || '',
    appearance: appearance || '',
    location: location || ''
  };
  db.get('worldNpcs').push(npc).write();
  return npc;
}

function updateNpc(worldId, npcId, { name, role, detail, oneLiner, appearance, location }) {
  const npc = db.get('worldNpcs').find({ id: npcId, worldId }).value();
  if (!npc) throw new Error('NPC not found');
  const next = {
    name: name !== undefined ? name : npc.name,
    role: role !== undefined ? role : npc.role,
    detail: detail !== undefined ? detail : npc.detail,
    oneLiner: oneLiner !== undefined ? oneLiner : npc.oneLiner,
    appearance: appearance !== undefined ? appearance : npc.appearance,
    location: location !== undefined ? location : npc.location
  };
  db.get('worldNpcs').find({ id: npcId, worldId }).assign(next).write();
  return db.get('worldNpcs').find({ id: npcId, worldId }).value();
}

function deleteNpc(worldId, npcId) {
  const npc = db.get('worldNpcs').find({ id: npcId, worldId }).value();
  if (!npc) throw new Error('NPC not found');
  db.get('worldNpcs').remove({ id: npcId, worldId }).write();
}

// ---------- Saves (one playthrough of a world) ----------
// Starting a save never calls the AI again for the opening chapter — the
// world template already has one, written to work before any character is
// chosen, so every new adventure from the same world is instant and free.

// A compact copy of everything about a save that can change turn to turn —
// stored on each turn so "revenir à cette page" can restore exactly this
// state later, without needing a separate history table.
function captureSnapshot(save) {
  const itemValues = db.get('saveTrackedItemValues').filter({ saveId: save.id }).value();
  const characters = db.get('saveCharacters').filter({ saveId: save.id }).value();
  return {
    trackedItemValues: itemValues.map(v => ({ itemDefId: v.itemDefId, value: v.value })),
    characters: characters.map(c => ({
      name: c.name, role: c.role, status: c.status, oneLiner: c.oneLiner, appearance: c.appearance, location: c.location
    })),
    secretInfo: save.secretInfo,
    gameOver: save.gameOver
  };
}

function createSave(worldId) {
  const world = getWorld(worldId);
  const save = {
    id: uuid(),
    worldId,
    activeCharacterId: null,
    gameOver: null,
    secretInfo: '',
    summarizedUpToTurn: -1, // highest turnNumber already folded into a (summary) memory fact — see maybeSummarize
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.get('saves').push(save).write();

  db.get('trackedItemDefs').filter({ worldId }).value().forEach(def => {
    db.get('saveTrackedItemValues').push({ id: uuid(), saveId: save.id, itemDefId: def.id, value: def.initialValue }).write();
  });

  db.get('worldNpcs').filter({ worldId }).value().forEach(npc => {
    db.get('saveCharacters').push({
      id: uuid(), saveId: save.id, name: npc.name, role: npc.role,
      status: npc.detail, oneLiner: npc.oneLiner, appearance: npc.appearance, location: npc.location
    }).write();
  });

  // Worlds with a "background" (player-facing popup shown at adventure
  // start) generate their real first turn on demand from world.firstAction,
  // once a character is chosen — see POST /api/saves/:id/turn and the
  // background-modal flow in app.js. Older worlds without one keep the
  // free, static opening_chapter turn created immediately here.
  if (world.background) {
    return { save, openingTurn: null };
  }

  const openingTurn = {
    id: uuid(),
    saveId: save.id,
    turnNumber: 0,
    playerAction: '(story begins)',
    chapterText: world.openingChapter,
    outcome: 'n/a',
    skillUsed: null,
    gameOver: null,
    imagePrompt: null,
    imageUrl: null,
    suggestedActions: [],
    snapshot: captureSnapshot(save),
    createdAt: new Date().toISOString()
  };
  db.get('turns').push(openingTurn).write();

  return { save, openingTurn };
}

function getSave(saveId) {
  const save = db.get('saves').find({ id: saveId }).value();
  if (!save) throw new Error('Save not found');
  return save;
}

// Tracked items are seeded onto the save at createSave() time, before any
// character is chosen — so a character's own starting overrides (e.g. a
// "rich" character starting with more gold than a "poor" one) can only be
// applied here, once we actually know which character was picked.
function applyCharacterStartingItemValues(saveId, worldId, character) {
  const overrides = character.initialTrackedItemValues || {};
  if (!Object.keys(overrides).length) return;
  const itemDefs = db.get('trackedItemDefs').filter({ worldId }).value();
  Object.entries(overrides).forEach(([itemName, value]) => {
    const def = itemDefs.find(d => d.name === itemName);
    if (!def) return;
    const valueRow = db.get('saveTrackedItemValues').find({ saveId, itemDefId: def.id }).value();
    if (valueRow) {
      db.get('saveTrackedItemValues').find({ saveId, itemDefId: def.id }).assign({ value }).write();
    } else {
      db.get('saveTrackedItemValues').push({ id: uuid(), saveId, itemDefId: def.id, value }).write();
    }
  });
}

function selectCharacter(saveId, characterId) {
  const save = getSave(saveId);
  const character = db.get('playableCharacters').find({ id: characterId, worldId: save.worldId }).value();
  if (!character) throw new Error('Character not found');
  applyCharacterStartingItemValues(saveId, save.worldId, character);
  db.get('saves').find({ id: saveId }).assign({ activeCharacterId: characterId, updatedAt: new Date().toISOString() }).write();
  return character;
}

// A defeat always ends the story for good. A victory only ends it by
// default — the player may choose to keep going in the same save.
function continueAfterVictory(saveId) {
  const save = getSave(saveId);
  if (!save.gameOver) throw new Error('This story has not ended');
  if (save.gameOver.result !== 'victory') throw new Error('Only a victory can be continued');
  db.get('saves').find({ id: saveId }).assign({ gameOver: null, updatedAt: new Date().toISOString() }).write();
  return save;
}

// Destructive, on purpose (no branching): discards every turn after
// targetTurnNumber and restores the save's evolving state (tracked items,
// characters, secretInfo, gameOver) to exactly how it was right after that
// turn — "reprendre à partir d'ici".
function rewindToTurn(saveId, targetTurnNumber) {
  const save = getSave(saveId);
  const targetTurn = db.get('turns').find({ saveId, turnNumber: targetTurnNumber }).value();
  if (!targetTurn) throw new Error('Turn not found');
  const snapshot = targetTurn.snapshot || { trackedItemValues: [], characters: [], secretInfo: '', gameOver: null };

  db.get('turns').filter(t => t.saveId === saveId && t.turnNumber > targetTurnNumber && t.imageUrl).value().forEach(t => deleteLocalImageFile(t.imageUrl));
  db.get('turns').remove(t => t.saveId === saveId && t.turnNumber > targetTurnNumber).write();
  db.get('memoryFacts').remove(f => f.saveId === saveId && f.turnNumber > targetTurnNumber).write();
  // A discarded time skip's timeline entry goes with the turns it covered --
  // same "never discard, only retrieve" boundary as memoryFacts above: kept
  // for any turn that survives the rewind, dropped for any that doesn't.
  db.get('timelineEvents').remove(e => e.saveId === saveId && e.turnNumber > targetTurnNumber).write();

  // Same reasoning as summarizedUpToTurn just below: a story-clock update
  // could have been anchored on a turn that's about to be discarded, so
  // clamp lastReferencedTurn rather than leave it pointing past the new end
  // of the save. currentDate/elapsedDescription themselves are left as
  // whatever they were -- there's no per-turn history to roll them back to,
  // only a single current value (see upsertStoryClock).
  const clock = getStoryClock(saveId);
  if (clock && clock.lastReferencedTurn > targetTurnNumber) {
    db.get('storyClock').find({ id: saveId }).assign({ lastReferencedTurn: targetTurnNumber }).write();
  }

  db.get('saveTrackedItemValues').remove({ saveId }).write();
  (snapshot.trackedItemValues || []).forEach(v => {
    db.get('saveTrackedItemValues').push({ id: uuid(), saveId, itemDefId: v.itemDefId, value: v.value }).write();
  });

  db.get('saveCharacters').remove({ saveId }).write();
  (snapshot.characters || []).forEach(c => {
    db.get('saveCharacters').push({ id: uuid(), saveId, ...c }).write();
  });

  db.get('saves').find({ id: saveId }).assign({
    secretInfo: snapshot.secretInfo || '',
    gameOver: snapshot.gameOver || null,
    // The memoryFacts removal above can delete a (summary) fact that covered
    // turns at or before the rewind point (it was recorded under whatever
    // turnNumber was current when maybeSummarize ran, which can be well past
    // the turns it actually summarized) — clamping here means a later
    // maybeSummarize will redo that coverage instead of assuming turns up to
    // the old high-water mark are still summarized somewhere.
    summarizedUpToTurn: Math.min(save.summarizedUpToTurn ?? -1, targetTurnNumber),
    updatedAt: new Date().toISOString()
  }).write();

  return getSave(saveId);
}

// Redo a past turn: rewinds to just before it, then plays it again — either
// with an edited action, or the same action plus extra guidance about what
// should happen differently this time. Everything after that turn is lost,
// same as any other rewind.
async function regenerateTurn(saveId, turnNumber, { action, note, providerOverride } = {}) {
  if (turnNumber < 1) throw new Error('The opening chapter cannot be regenerated');
  const original = db.get('turns').find({ saveId, turnNumber }).value();
  if (!original) throw new Error('Turn not found');
  const actionToUse = (action && action.trim()) || original.playerAction;

  rewindToTurn(saveId, turnNumber - 1);
  return playTurn(saveId, actionToUse, { authorNote: note && note.trim() ? note.trim() : undefined, providerOverride });
}

// Streaming counterpart of regenerateTurn, mirroring how playTurnStreaming
// relates to playTurn — same rewind-then-replay logic, just calling the
// streamed narration+state path so a regenerated chapter also appears live
// instead of after the full wait.
async function regenerateTurnStreaming(saveId, turnNumber, { action, note, providerOverride, onChapterChunk } = {}) {
  if (turnNumber < 1) throw new Error('The opening chapter cannot be regenerated');
  const original = db.get('turns').find({ saveId, turnNumber }).value();
  if (!original) throw new Error('Turn not found');
  const actionToUse = (action && action.trim()) || original.playerAction;

  rewindToTurn(saveId, turnNumber - 1);
  return playTurnStreaming(saveId, actionToUse, { authorNote: note && note.trim() ? note.trim() : undefined, providerOverride, onChapterChunk });
}

function deleteSave(saveId) {
  getSave(saveId);
  db.get('turns').filter(t => t.saveId === saveId && t.imageUrl).value().forEach(t => deleteLocalImageFile(t.imageUrl));
  db.get('turns').remove({ saveId }).write();
  db.get('memoryFacts').remove({ saveId }).write();
  db.get('saveCharacters').remove({ saveId }).write();
  db.get('saveTrackedItemValues').remove({ saveId }).write();
  db.get('costLog').remove({ saveId }).write();
  db.get('storyClock').remove({ saveId }).write();
  db.get('timelineEvents').remove({ saveId }).write();
  db.get('saves').remove({ id: saveId }).write();
}

function deleteWorld(worldId) {
  const world = getWorld(worldId);
  db.get('saves').filter({ worldId }).value().forEach(save => deleteSave(save.id));
  deleteLocalImageFile(world.coverImageUrl);
  db.get('playableCharacters').filter({ worldId }).value().forEach(c => deleteLocalImageFile(c.portraitUrl));
  db.get('playableCharacters').remove({ worldId }).write();
  db.get('worldNpcs').remove({ worldId }).write();
  db.get('trackedItemDefs').remove({ worldId }).write();
  db.get('costLog').remove({ worldId, saveId: null }).write();
  db.get('worlds').remove({ id: worldId }).write();
}

// storyClock (see the V2 design doc's Data model section, Milestone 1): one
// row per save, upserted every turn from the Writer's own story_clock field
// (see promptBuilder.js) -- currentDate/elapsedDescription carry forward
// unchanged when the Writer reports no change this turn (null), and
// lastReferencedTurn only advances when the Writer actually asserted a
// concrete date/duration, so a future Proofreader pass (Milestone 3) has a
// real "last time this was anchored" to diff pacing language against. Read
// back into every prompt as of the time-skip mechanic (see
// gatherTurnContext) -- no longer write-only.
function getStoryClock(saveId) {
  return db.get('storyClock').find({ id: saveId }).value();
}

function upsertStoryClock(saveId, turnNumber, storyClock) {
  const currentDate = storyClock && typeof storyClock.current_date === 'string' ? storyClock.current_date : null;
  const elapsedDescription = storyClock && typeof storyClock.elapsed_description === 'string' ? storyClock.elapsed_description : null;
  const existing = getStoryClock(saveId);
  const next = {
    id: saveId,
    saveId,
    currentDate: currentDate ?? (existing ? existing.currentDate : null),
    elapsedDescription: elapsedDescription ?? (existing ? existing.elapsedDescription : null),
    lastReferencedTurn: (currentDate || elapsedDescription) ? turnNumber : (existing ? existing.lastReferencedTurn : -1)
  };
  if (existing) db.get('storyClock').find({ id: saveId }).assign(next).write();
  else db.get('storyClock').push(next).write();
}

// The time-skip mechanic's "frise chronologique" -- one row per time skip,
// appended (never overwritten) so the Writer can see the full history of
// past skips, not just the current point in time. See promptBuilder.js's
// STORY TIMELINE block and the PACING & TIME SKIPS instructions that ask
// the Writer to set parsed.time_skip when it decides to compress a stretch,
// or the dedicated time-skip prompt (roles-less -- see playTimeSkipStreaming)
// when the player explicitly requests one.
function recordTimelineEvent(saveId, turnNumber, timeSkip) {
  if (!timeSkip || typeof timeSkip.elapsed_description !== 'string' || !timeSkip.elapsed_description.trim()) return;
  db.get('timelineEvents').push({
    id: uuid(), saveId, turnNumber,
    elapsedDescription: timeSkip.elapsed_description.trim(),
    summary: typeof timeSkip.summary === 'string' ? timeSkip.summary.trim() : '',
    createdAt: new Date().toISOString()
  }).write();
}

// Applies a fully-parsed turn (same shape regardless of whether it came from
// the single-call path or the narration+state split below) to the save:
// persists the turn row, folds in tracked-item/character/memory-fact
// updates, and snapshots the result for rewind/regenerate. Shared by
// playTurn and playTurnStreaming so the two paths can't silently drift.
function persistTurn({ saveId, world, playerAction, parsed, framedImagePrompt, imageUrl, itemDefs, allTurns }) {
  const turnNumber = (allTurns[allTurns.length - 1]?.turnNumber ?? -1) + 1;
  const gameOver = (parsed.game_over && (parsed.game_over.result === 'victory' || parsed.game_over.result === 'defeat'))
    ? {
        result: parsed.game_over.result,
        text: parsed.game_over.text || (parsed.game_over.result === 'victory' ? world.victoryText : world.defeatText) || ''
      }
    : null;
  const turn = {
    id: uuid(),
    saveId,
    turnNumber,
    playerAction,
    chapterText: parsed.chapter_text,
    outcome: parsed.outcome || 'n/a',
    skillUsed: parsed.skill_used || null,
    gameOver,
    imagePrompt: framedImagePrompt,
    imageUrl,
    suggestedActions: parsed.suggested_actions || [],
    createdAt: new Date().toISOString()
  };
  db.get('turns').push(turn).write();

  const saveUpdates = { updatedAt: new Date().toISOString() };
  if (gameOver) saveUpdates.gameOver = gameOver;
  if (typeof parsed.secret_info === 'string') saveUpdates.secretInfo = parsed.secret_info;
  db.get('saves').find({ id: saveId }).assign(saveUpdates).write();

  // Structured memory (new_facts) is no longer extracted or written here —
  // see the Archivist role (Milestone 1 of the V2 design doc): it's a
  // separate, async call fired by playTurn/playTurnStreaming right after
  // this function returns, so fact extraction never sits on the player's
  // critical path. persistTurn only still owns state that has to be correct
  // the instant the turn is shown (tracked items, secret info, story clock).
  const updates = parsed.state_updates || {};
  upsertStoryClock(saveId, turnNumber, parsed.story_clock);
  recordTimelineEvent(saveId, turnNumber, parsed.time_skip);
  (updates.characters_changed || []).forEach(c => {
    const existing = db.get('saveCharacters').find({ saveId, name: c.name }).value();
    if (existing) {
      db.get('saveCharacters').find({ saveId, name: c.name }).assign({ status: c.change }).write();
    } else {
      db.get('saveCharacters').push({ id: uuid(), saveId, name: c.name, role: 'unknown', status: c.change }).write();
    }
  });

  // Only items marked as auto-updating can actually be changed by the AI —
  // static reference items and unrecognized names are ignored defensively,
  // since this echoes back through JSON parsed from a model's output.
  (parsed.tracked_item_updates || []).forEach(u => {
    const def = itemDefs.find(d => d.name === u.name);
    if (!def || !def.updateAutomatically) return;
    const valueRow = db.get('saveTrackedItemValues').find({ saveId, itemDefId: def.id }).value();
    if (valueRow) {
      db.get('saveTrackedItemValues').find({ saveId, itemDefId: def.id }).assign({ value: u.new_value }).write();
    } else {
      db.get('saveTrackedItemValues').push({ id: uuid(), saveId, itemDefId: def.id, value: u.new_value }).write();
    }
  });

  // Snapshot the state as it stands right after this turn's mutations, so
  // rewinding or regenerating from this turn later can restore it exactly.
  const updatedSave = getSave(saveId);
  const snapshot = captureSnapshot(updatedSave);
  db.get('turns').find({ id: turn.id }).assign({ snapshot }).write();
  turn.snapshot = snapshot;

  pruneOldTurnImages(saveId);

  return { turn, turnNumber };
}

// Keeps only the MAX_STORED_TURN_IMAGES most recent turn images for a save —
// see that constant's own comment for why this matters (base64 images
// stored inline in the database, no other cap on the file's growth over a long
// save). Only imageUrl is cleared; the turn itself (text, snapshot) is
// untouched since pagination/rewind still need it.
function pruneOldTurnImages(saveId) {
  const turnsWithImages = db.get('turns')
    .filter(t => t.saveId === saveId && t.imageUrl)
    .sortBy('turnNumber')
    .value();
  const excess = turnsWithImages.length - MAX_STORED_TURN_IMAGES;
  if (excess <= 0) return;
  turnsWithImages.slice(0, excess).forEach(t => {
    deleteLocalImageFile(t.imageUrl);
    db.get('turns').find({ id: t.id }).assign({ imageUrl: null }).write();
  });
}

// Manual "purge all images now" escape hatch (per save) for when the
// automatic cap above isn't enough — e.g. right after lowering it, or if
// disk space is tight before the next turn even runs.
function purgeSaveImages(saveId) {
  getSave(saveId);
  db.get('turns').filter(t => t.saveId === saveId && t.imageUrl).value().forEach(t => {
    deleteLocalImageFile(t.imageUrl);
    db.get('turns').find({ id: t.id }).assign({ imageUrl: null }).write();
  });
  return { ok: true };
}

// Shared setup for both playTurn and playTurnStreaming: everything about the
// save/world/character/tracked-items/history needed to build a turn prompt,
// gathered once so the two don't duplicate (and risk drifting on) this logic.
//
// memoryFacts entries carry { fact, character, type } (see the Archivist,
// roles/archivist.js), split three ways -- this is what keeps a fact like
// "Edgar has served 30 years" correct no matter how many turns pass without
// anyone restating it:
//   - character == null && type == 'plot' -- KNOWN FACTS below: general,
//     still-evolving state, retrieved by similarity (see the Retriever,
//     Milestone 2 of the V2 design doc).
//   - character == null && type == 'biographical' -- WORLD LORE: fixed
//     setting/lore details untied to one person, static and always included
//     in full (small and stable enough per save that a full scan costs
//     nothing -- see the design doc's Storage section).
//   - character set -- attached directly to that character's own entry in
//     OTHER CHARACTERS, also retrieved by similarity, same as KNOWN FACTS.
// Async now that retrieval needs an embedding call before it can query --
// gatherTurnContext(saveId, playerAction) is awaited by both callers below.
async function gatherTurnContext(saveId, playerAction) {
  const save = getSave(saveId);
  const world = getWorld(save.worldId);
  const settings = getSettings();
  if (!save.activeCharacterId) throw new Error('Choose a character before playing');
  if (save.gameOver) throw new Error('This story has already ended');

  const activeCharacter = db.get('playableCharacters').find({ id: save.activeCharacterId }).value();
  const allTurns = db.get('turns').filter({ saveId }).sortBy('turnNumber').value();
  const recentTurns = allTurns.slice(-RECENT_TURNS_WINDOW);

  const worldLoreFacts = db.get('memoryFacts').filter({ saveId }).value().filter(f => !f.character && f.type === 'biographical');

  // The retrieval query is the player's action plus a short window of
  // recent scene text (see the design doc's Retrieval mechanism section) --
  // gatherTurnContext builds the text, roles/retriever.js only embeds and
  // searches it.
  const sceneWindow = recentTurns.map(t => `${t.playerAction} ${t.chapterText}`).join(' ');
  const queryText = `${playerAction} ${sceneWindow}`.trim();
  const characterRows = db.get('saveCharacters').filter({ saveId }).value();
  const { memoryFacts, factsByCharacter } = await retriever.retrieveRelevantFacts({
    saveId, queryText, characterNames: characterRows.map(c => c.name), limit: RELEVANT_FACTS_LIMIT, settings
  });
  const characters = characterRows.map(c => ({ ...c, facts: factsByCharacter[c.name] || [] }));

  const itemDefs = db.get('trackedItemDefs').filter({ worldId: world.id }).value();
  const itemValues = db.get('saveTrackedItemValues').filter({ saveId }).value();
  const trackedItems = itemDefs.map(def => {
    const valueRow = itemValues.find(v => v.itemDefId === def.id);
    return { ...def, value: valueRow ? valueRow.value : def.initialValue };
  });

  // Read back into every prompt as of the time-skip mechanic -- storyClock
  // was write-only through Milestone 1 (populated but nothing consumed it
  // yet). The Writer needs to see the current point in story-time to reason
  // about elapsed time at all, and timelineEvents (the "frise
  // chronologique") is the append-only history of past skips that keeps a
  // long story's several skips consistent with each other -- see
  // promptBuilder.js's STORY CLOCK / STORY TIMELINE blocks.
  const storyClock = getStoryClock(saveId);
  const timelineEvents = db.get('timelineEvents').filter({ saveId }).sortBy('turnNumber').value();

  return { save, world, settings, activeCharacter, memoryFacts, worldLoreFacts, characters, itemDefs, trackedItems, allTurns, recentTurns, storyClock, timelineEvents };
}

async function generateTurnImage(world, settings, imagePrompt) {
  const framedImagePrompt = buildImagePrompt(world, imagePrompt);
  let imageUrl = null;
  if (settings.imagesEnabled && framedImagePrompt) {
    try {
      imageUrl = await generateImage({
        provider: settings.imageProvider,
        prompt: framedImagePrompt,
        apiKey: settings.apiKeys[settings.imageProvider],
        model: world.imageModel || settings.imageModel,
        baseUrl: settings.localImageBaseUrl
      });
      if (!imageUrl) {
        console.error(`[image] Turn image: ${settings.imageProvider} returned no image (world ${world.id}, prompt: "${framedImagePrompt.slice(0, 150)}")`);
      }
    } catch (e) {
      // Image failure should never break the story turn -- but silently
      // swallowing it here previously meant a real error (e.g. AUTOMATIC1111
      // unreachable, wrong model name, a genuine 500) left no trace anywhere,
      // making "why is there no image" undiagnosable after the fact.
      console.error(`[image] Turn image generation failed (world ${world.id}, provider ${settings.imageProvider}): ${e.message}`);
      imageUrl = null;
    }
  } else if (settings.imagesEnabled && !framedImagePrompt) {
    console.log(`[image] Turn image skipped: no image_prompt returned for this turn (world ${world.id}).`);
  }
  return { framedImagePrompt, imageUrl };
}

// Fires the Archivist (see roles/archivist.js) without awaiting it -- this
// is what makes fact extraction async, off the player's critical path (see
// Milestone 1 of the V2 design doc). Deliberately called after the turn is
// already persisted and about to be returned to the caller, so nothing here
// can add latency or an error to the response the player is waiting on; any
// failure is caught and logged, never thrown into the caller.
function fireArchivist({ world, saveId, turnNumber, playerAction, chapterText, characters, settings }) {
  archivist.extractFacts({
    worldId: world.id, saveId, turnNumber, playerAction, chapterText,
    characterNames: characters.map(c => c.name), settings
  }).catch(e => console.error(`[archivist] unhandled error (save ${saveId}, turn ${turnNumber}): ${e.message}`));
}

async function playTurn(saveId, playerAction, { authorMode, authorNote, providerOverride } = {}) {
  const { world, settings, activeCharacter, memoryFacts, worldLoreFacts, characters, itemDefs, trackedItems, allTurns, recentTurns, save, storyClock, timelineEvents } = await gatherTurnContext(saveId, playerAction);

  const { system, user } = buildTurnPrompt({
    world, memoryFacts, worldLoreFacts, characters, recentTurns, playerAction, activeCharacter, trackedItems, secretInfo: save.secretInfo,
    storyClock, timelineEvents, language: world.language || settings.language, chapterLength: settings.chapterLength, authorMode, authorNote
  });
  const raw = await callText({ system, user, kind: 'turn', worldId: world.id, saveId, providerOverride });
  const parsed = parseModelJSON(raw);

  const { framedImagePrompt, imageUrl } = await generateTurnImage(world, settings, parsed.image_prompt);
  const { turn, turnNumber } = persistTurn({ saveId, world, playerAction, parsed, framedImagePrompt, imageUrl, itemDefs, allTurns });
  await maybeSummarize(saveId, turnNumber);
  fireArchivist({ world, saveId, turnNumber, playerAction, chapterText: turn.chapterText, characters, settings });
  return turn;
}

// Narration+state split (see TODO.md/CHANGELOG.md): a fast, streamable call
// produces just what the player needs to start reading (chapter text + a
// small META trailer with outcome/skill_used/game_over/suggested_actions),
// forwarded to onChapterChunk as it arrives; a second call — given that
// chapter text as input — computes the bookkeeping the player never sees
// synchronously (tracked items, secret info, new facts, the image prompt).
// Ends up persisting the exact same turn shape as playTurn via the shared
// persistTurn() above, so rewind/regenerate/display code needs no changes.
async function playTurnStreaming(saveId, playerAction, { authorMode, authorNote, providerOverride, onChapterChunk } = {}) {
  const { world, settings, activeCharacter, memoryFacts, worldLoreFacts, characters, itemDefs, trackedItems, allTurns, recentTurns, save, storyClock, timelineEvents } = await gatherTurnContext(saveId, playerAction);
  const language = world.language || settings.language;
  const provider = providerOverride?.provider || settings.textProvider;
  const model = providerOverride ? providerOverride.model : settings.textModel;

  const narrationPrompt = buildNarrationPrompt({
    world, memoryFacts, worldLoreFacts, characters, recentTurns, playerAction, activeCharacter, trackedItems, secretInfo: save.secretInfo,
    storyClock, timelineEvents, language, chapterLength: settings.chapterLength, authorMode, authorNote
  });

  // Forwards only the actual chapter prose to the reader: strips the leading
  // "===CHAPTER===" marker, and stops once the response crosses into the
  // ===META=== trailer (further chunks are just JSON fragments). Recomputes
  // from the whole buffer received so far on every chunk rather than trying
  // to patch each delta — the buffer stays a few KB at most for a turn, so
  // this is cheap. The start marker is naturally safe (a partial prefix like
  // "===CHAP" fails the startMatch regex, so nothing is sent until it's
  // whole) but the end marker needs an explicit holdback: indexOf returns -1
  // for "not found *yet*" exactly the same as "will never be found", so
  // without this, a chunk boundary landing mid-marker (e.g. "...\n===MET" /
  // "A===\n{...}" as two separate deltas) would leak the partial "===MET"
  // fragment into the visible text before the next chunk completes it —
  // already streamed and with no way to retract it from the reader's screen.
  let rawBuffer = '';
  let visibleSent = 0;
  let sawEndMarker = false;
  const forwardChapterChunk = (chunk) => {
    if (sawEndMarker) return;
    rawBuffer += chunk;
    const endIdx = rawBuffer.indexOf(NARRATION_END_MARKER);
    let visiblePortion;
    if (endIdx !== -1) {
      visiblePortion = rawBuffer.slice(0, endIdx);
    } else {
      const holdBack = NARRATION_END_MARKER.length - 1;
      visiblePortion = rawBuffer.slice(0, Math.max(0, rawBuffer.length - holdBack));
    }
    const startMatch = visiblePortion.match(/^===CHAPTER===\s*/);
    if (!startMatch) return; // start marker not fully received yet — nothing to show
    if (onChapterChunk) {
      const cleanedVisible = visiblePortion.slice(startMatch[0].length);
      if (cleanedVisible.length > visibleSent) {
        onChapterChunk(cleanedVisible.slice(visibleSent));
        visibleSent = cleanedVisible.length;
      }
    }
    if (endIdx !== -1) sawEndMarker = true;
  };

  const { text: narrationRaw, usage: narrationUsage } = await streamText({
    provider, system: narrationPrompt.system, user: narrationPrompt.user,
    apiKey: settings.apiKeys[provider], model, baseUrl: settings.ollamaBaseUrl,
    onDelta: forwardChapterChunk
  });
  recordCost({ worldId: world.id, saveId, kind: 'turn_narration', provider, model, usage: narrationUsage });
  const { chapterText, meta } = splitNarrationResponse(narrationRaw);

  const statePrompt = buildStatePrompt({
    world, characters, worldLoreFacts, activeCharacter, trackedItems, secretInfo: save.secretInfo, playerAction, chapterText, language
  });
  const stateRaw = await callText({ system: statePrompt.system, user: statePrompt.user, kind: 'turn_state', worldId: world.id, saveId, providerOverride });
  const stateParsed = parseModelJSON(stateRaw);

  const parsed = {
    chapter_text: chapterText,
    outcome: meta.outcome,
    skill_used: meta.skill_used,
    game_over: meta.game_over,
    suggested_actions: meta.suggested_actions,
    tracked_item_updates: stateParsed.tracked_item_updates,
    secret_info: stateParsed.secret_info,
    state_updates: stateParsed.state_updates,
    story_clock: stateParsed.story_clock,
    time_skip: stateParsed.time_skip,
    image_prompt: stateParsed.image_prompt
  };

  const { framedImagePrompt, imageUrl } = await generateTurnImage(world, settings, parsed.image_prompt);
  const { turn, turnNumber } = persistTurn({ saveId, world, playerAction, parsed, framedImagePrompt, imageUrl, itemDefs, allTurns });
  await maybeSummarize(saveId, turnNumber);
  fireArchivist({ world, saveId, turnNumber, playerAction, chapterText: turn.chapterText, characters, settings });
  return turn;
}

// The explicit, player-requested half of the time-skip mechanic (the
// autonomous half lives inside playTurnStreaming's own narration prompt --
// see PACING & TIME SKIPS in promptBuilder.js). Mirrors playTurnStreaming's
// structure almost exactly -- same narration/state split, same streaming
// wire format, same persistTurn/maybeSummarize/fireArchivist tail -- the
// only real difference is buildTimeSkipPrompt instead of buildNarrationPrompt
// for the narration half, which is where the framing genuinely needs to
// differ (see that function's own comment). No non-streaming counterpart:
// unlike playTurn, nothing in the frontend uses a non-streaming turn call,
// so one wasn't worth building and maintaining here.
//
// hint is the player's own free text for what the skip should cover or
// lead to (may be empty -- the Writer is told to use its judgment then). It
// doubles as this turn's playerAction, both for display in the turn
// history and as the Retriever's query text, so a hint like "until I reach
// the capital" pulls facts about the capital the same way a normal action
// would.
async function playTimeSkipStreaming(saveId, hint, { providerOverride, onChapterChunk } = {}) {
  const playerAction = (hint && hint.trim()) || '(time skip)';
  const { world, settings, memoryFacts, worldLoreFacts, characters, activeCharacter, itemDefs, trackedItems, allTurns, recentTurns, save, storyClock, timelineEvents } = await gatherTurnContext(saveId, playerAction);
  const language = world.language || settings.language;
  const provider = providerOverride?.provider || settings.textProvider;
  const model = providerOverride ? providerOverride.model : settings.textModel;

  const narrationPrompt = buildTimeSkipPrompt({
    world, memoryFacts, worldLoreFacts, characters, recentTurns, activeCharacter, trackedItems, secretInfo: save.secretInfo,
    storyClock, timelineEvents, hint, language, chapterLength: settings.chapterLength
  });

  // Same chunk-forwarding logic as playTurnStreaming -- see its own comment
  // for why the end-marker holdback is needed. Unchanged because the wire
  // format (===CHAPTER===/===META===) is identical either way.
  let rawBuffer = '';
  let visibleSent = 0;
  let sawEndMarker = false;
  const forwardChapterChunk = (chunk) => {
    if (sawEndMarker) return;
    rawBuffer += chunk;
    const endIdx = rawBuffer.indexOf(NARRATION_END_MARKER);
    let visiblePortion;
    if (endIdx !== -1) {
      visiblePortion = rawBuffer.slice(0, endIdx);
    } else {
      const holdBack = NARRATION_END_MARKER.length - 1;
      visiblePortion = rawBuffer.slice(0, Math.max(0, rawBuffer.length - holdBack));
    }
    const startMatch = visiblePortion.match(/^===CHAPTER===\s*/);
    if (!startMatch) return;
    if (onChapterChunk) {
      const cleanedVisible = visiblePortion.slice(startMatch[0].length);
      if (cleanedVisible.length > visibleSent) {
        onChapterChunk(cleanedVisible.slice(visibleSent));
        visibleSent = cleanedVisible.length;
      }
    }
    if (endIdx !== -1) sawEndMarker = true;
  };

  const { text: narrationRaw, usage: narrationUsage } = await streamText({
    provider, system: narrationPrompt.system, user: narrationPrompt.user,
    apiKey: settings.apiKeys[provider], model, baseUrl: settings.ollamaBaseUrl,
    onDelta: forwardChapterChunk
  });
  recordCost({ worldId: world.id, saveId, kind: 'turn_narration', provider, model, usage: narrationUsage });
  const { chapterText, meta } = splitNarrationResponse(narrationRaw);

  // Same state-extraction call as any other turn -- its job (extract what
  // changed from the chapter it's given) applies identically to a
  // compressed chapter, time_skip included (see buildStateMasterPrompt).
  const statePrompt = buildStatePrompt({
    world, characters, worldLoreFacts, activeCharacter, trackedItems, secretInfo: save.secretInfo, playerAction, chapterText, language
  });
  const stateRaw = await callText({ system: statePrompt.system, user: statePrompt.user, kind: 'turn_state', worldId: world.id, saveId, providerOverride });
  const stateParsed = parseModelJSON(stateRaw);

  const parsed = {
    chapter_text: chapterText,
    outcome: meta.outcome,
    skill_used: meta.skill_used,
    game_over: meta.game_over,
    suggested_actions: meta.suggested_actions,
    tracked_item_updates: stateParsed.tracked_item_updates,
    secret_info: stateParsed.secret_info,
    state_updates: stateParsed.state_updates,
    story_clock: stateParsed.story_clock,
    time_skip: stateParsed.time_skip,
    image_prompt: stateParsed.image_prompt
  };

  const { framedImagePrompt, imageUrl } = await generateTurnImage(world, settings, parsed.image_prompt);
  const { turn, turnNumber } = persistTurn({ saveId, world, playerAction, parsed, framedImagePrompt, imageUrl, itemDefs, allTurns });
  await maybeSummarize(saveId, turnNumber);
  fireArchivist({ world, saveId, turnNumber, playerAction, chapterText: turn.chapterText, characters, settings });
  return turn;
}

// Every SUMMARIZE_EVERY turns, compress older turns into one memory fact so
// the "recent turns" window stays small and cheap regardless of how long the
// story runs.
//
// Bug fixed here: this used to slice from the very start of the save every
// time (allTurns.slice(0, -RECENT_TURNS_WINDOW)) instead of only the turns
// newly aged out of the recent-turns window since the last summary. On a
// long save that meant every periodic summarization re-sent the ENTIRE
// history to the model again (an unbounded, ever-growing call all on its
// own) and pushed a new (summary) fact that mostly re-covered ground the
// previous summaries already had -- burning cost for no benefit, and
// crowding the RELEVANT_FACTS_LIMIT-sized recent-facts window with
// near-duplicate summaries instead of a good spread of distinct facts as
// the game went on. save.summarizedUpToTurn now tracks the real high-water
// mark so each run only summarizes what's actually new.
// Beyond the prose summary, this batch point is also the safety net for the
// per-turn fact extraction (see buildStateMasterPrompt's NEW FACTS section):
// a dedicated second pass re-reads the SAME departing turns specifically
// hunting for concrete details missed the first time, cross-checked against
// what's already recorded so it only reports genuinely new gaps. Confirmed
// for real that this gap exists (a character's stated years-of-service
// number went unrecorded and was later reconstructed wrong) -- see
// CHANGELOG.md.
async function maybeSummarize(saveId, turnNumber) {
  if (turnNumber === 0 || turnNumber % SUMMARIZE_EVERY !== 0) return;
  const save = getSave(saveId);
  const summarizedUpToTurn = save.summarizedUpToTurn ?? -1;
  const allTurns = db.get('turns').filter({ saveId }).sortBy('turnNumber').value();
  const eligible = allTurns.slice(0, Math.max(0, allTurns.length - RECENT_TURNS_WINDOW));
  const toSummarize = eligible.filter(t => t.turnNumber > summarizedUpToTurn);
  if (toSummarize.length < SUMMARIZE_EVERY) return;

  const world = getWorld(save.worldId);
  const settings = getSettings();
  const characterNames = db.get('saveCharacters').filter({ saveId }).value().map(c => c.name);
  const allMemoryFacts = db.get('memoryFacts').filter({ saveId }).value();
  const alreadyKnownFacts = allMemoryFacts.map(f => f.fact);

  const { system, user } = buildSummaryPrompt(toSummarize, { characterNames, alreadyKnownFacts, language: world.language || settings.language });
  try {
    const raw = await callText({ system, user, kind: 'summary', worldId: save.worldId, saveId });
    const parsed = parseModelJSON(raw);
    const summaryText = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (summaryText) {
      const summaryFact = `(summary) ${summaryText}`;
      const row = newMemoryFact({ saveId, turnNumber, fact: summaryFact, character: null, type: 'plot' });
      row.embedding = await embedFact(summaryFact, settings, `save ${saveId}, turn ${turnNumber} summary`);
      db.get('memoryFacts').push(row).write();
    }
    for (const rawFact of parsed.missed_facts || []) {
      const { fact, character, type } = normalizeNewFact(rawFact);
      if (!fact) continue;
      const row = newMemoryFact({ saveId, turnNumber, fact, character, type });
      row.embedding = await embedFact(fact, settings, `save ${saveId}, turn ${turnNumber} missed fact`);
      db.get('memoryFacts').push(row).write();
    }
    db.get('saves').find({ id: saveId }).assign({
      summarizedUpToTurn: toSummarize[toSummarize.length - 1].turnNumber
    }).write();
  } catch (e) {
    // Summarization is a nice-to-have; never let it break gameplay. Leaving
    // summarizedUpToTurn untouched means this same batch is retried at the
    // next SUMMARIZE_EVERY checkpoint rather than silently skipped forever.
  }
}

module.exports = {
  createWorld, getWorld, updateWorld, aiEditWorld, deleteWorld,
  regenerateWorldCover, previewWorldCover, acceptWorldCover,
  addCharacter, addCharacterWithPortrait, generateCharacterWithAI, updateCharacter, deleteCharacter,
  regenerateCharacterPortrait, previewCharacterPortrait, acceptCharacterPortrait,
  addTrackedItem, updateTrackedItem, deleteTrackedItem,
  addNpc, updateNpc, deleteNpc,
  createSave, getSave, selectCharacter, continueAfterVictory, deleteSave, purgeSaveImages,
  playTurn, playTurnStreaming, playTimeSkipStreaming, rewindToTurn, regenerateTurn, regenerateTurnStreaming, getSettings,
  listAvailableOllamaModels, getOllamaStatus, listAvailableLocalSdModels
};
