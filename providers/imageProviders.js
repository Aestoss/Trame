const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { v4: uuid } = require('uuid');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const imagesDir = path.join(dataDir, 'images');

// Returns a URL (or base64 data URL) for the generated image, or null.

// Stability's v2beta "core" endpoint is a single fixed model — it has no
// per-request model parameter to override, unlike Replicate. Model choice
// on Stability would mean switching to an entirely different endpoint
// (ultra/sd3/core each are separate models), which is out of scope here.
async function callStability({ prompt, apiKey }) {
  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    body: (() => {
      const form = new (require('form-data'))();
      form.append('prompt', prompt);
      form.append('output_format', 'png');
      return form;
    })()
  });
  if (!res.ok) throw new Error(`Stability API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return `data:image/png;base64,${data.image}`;
}

async function callReplicate({ prompt, apiKey, model }) {
  const start = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      version: model || 'black-forest-labs/flux-schnell',
      input: { prompt }
    })
  });
  if (!start.ok) throw new Error(`Replicate API error ${start.status}: ${await start.text()}`);
  const prediction = await start.json();
  // Caller is expected to poll prediction.urls.get if not immediately resolved;
  // simplified here for the MVP.
  return prediction.output ? prediction.output[0] : null;
}

// Sentinel value for world.imageModel / settings.imageModel: Chroma lives on
// a completely separate Forge-fork instance (see scripts/windows/setup-forge-
// chroma.ps1) rather than as a 5th checkpoint on the main one -- mainline
// Forge has no native Chroma support, and Chroma itself needs a checkpoint +
// VAE + text encoder selected together, not a single swappable file. That
// instance only ever serves Chroma (selected once, by hand, in its own UI --
// see that script's .NOTES), so a request routed there never needs
// override_settings at all; picking this sentinel just changes which path
// gets called, nothing else.
const CHROMA_MODEL_SENTINEL = '__chroma__';

// Targets Forge (stable-diffusion-webui-forge and, for Chroma, the dedicated
// chromaforge fork) -- both keep AUTOMATIC1111's original /sdapi/v1/txt2img
// shape and --api flag, by design (Forge was built from day one to stay a
// drop-in API replacement). Reaches it through the same authenticated
// Caddy+tunnel bridge as Ollama -- see scripts/windows/setup-ollama-
// bridge.ps1 -- since it's the same PC/GPU. Caddy exposes the main instance
// at /sdapi/* and the Chroma instance at /sdapi-chroma/* on the SAME public
// URL (one tunnel, two paths) -- picking the path here is the only thing
// that differs for Chroma, not the base URL itself.
//
// width/height at 1024 (was 512 until this was reviewed for the Forge/Flux
// migration): 512x512 is SD1.5's native resolution, not SDXL's or Flux's --
// both NoobAI-XL/RealVisXL (SDXL) and Flux/Chroma are trained around
// 1024x1024, and generating well below that native resolution is a real,
// pre-existing quality problem for the two checkpoints already in use, not
// just a new concern for the models this migration adds.
//
// NOTE: written from Forge's documented /sdapi/v1/txt2img shape (inherited
// from AUTOMATIC1111, stable for years) but not exercised against a live
// instance in this session -- no such environment available here. Report
// back anything that doesn't match and it'll get fixed.
async function callLocalSD({ prompt, apiKey, baseUrl, model }) {
  const trimmedBase = (baseUrl || 'http://localhost:7860').replace(/\/$/, '');
  const isChroma = model === CHROMA_MODEL_SENTINEL;
  const url = `${trimmedBase}/${isChroma ? 'sdapi-chroma' : 'sdapi'}/v1/txt2img`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      prompt,
      steps: 20,
      width: 1024,
      height: 1024,
      // Per-request checkpoint override (Forge's documented override_settings
      // shape, inherited from AUTOMATIC1111) -- lets Fogbound's "Image model"
      // field pick between checkpoints on the MAIN instance (illustration,
      // photorealistic, Flux Safe, NSFW Flux) without changing the WebUI's
      // persisted default. Never sent for Chroma: that instance only ever
      // serves the one model already selected in its own UI, so there is
      // nothing to override.
      ...(model && !isChroma ? { override_settings: { sd_model_checkpoint: model }, override_settings_restore_afterwards: false } : {})
    })
  });
  if (!res.ok) throw new Error(`Local Stable Diffusion API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const image = data.images && data.images[0];
  return image ? `data:image/png;base64,${image}` : null;
}

async function callMock({ prompt }) {
  // No network call — returns a placeholder so the UI has something to render during testing.
  return null;
}

const providers = { stability: callStability, replicate: callReplicate, localsd: callLocalSD, mock: callMock, none: callMock };

// Providers return either null, an already-hosted URL (Replicate), or a
// base64 data URI (Stability, local Forge/Chroma). A data URI stored
// inline in the database has no size cap and is what actually drives this
// app's memory footprint -- several hundred KB to a few MB per image, with
// nothing to ever shrink it (see MAX_STORED_TURN_IMAGES in gameEngine.js,
// which only caps turn images, not world covers or character portraits).
// That's a confirmed, real production incident: it drove memory usage up
// until the container's OOM killer fired mid-write, which corrupted the
// database once already (see Fogbound's lib/dbAdapter.js). Writing the bytes to disk
// here instead, and only ever putting a short /images/<file> path in
// the database, removes the actual cause of those OOM kills rather than just
// tolerating them -- the database now stays plain-text-sized permanently.
function persistIfDataUri(result) {
  if (!result || !result.startsWith('data:')) return result; // null, or already an external URL -- nothing to do
  const match = /^data:([^;]+);base64,(.+)$/s.exec(result);
  if (!match) return result;
  const [, mime, base64] = match;
  const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
  fs.mkdirSync(imagesDir, { recursive: true });
  const filename = `${uuid()}.${ext}`;
  fs.writeFileSync(path.join(imagesDir, filename), Buffer.from(base64, 'base64'));
  return `/images/${filename}`;
}

async function generateImage({ provider, prompt, apiKey, model, baseUrl }) {
  if (!prompt) return null;
  const fn = providers[provider] || providers.mock;
  const result = await fn({ prompt, apiKey, model, baseUrl });
  return persistIfDataUri(result);
}

// Best-effort classification by filename -- Forge's API doesn't report what
// a checkpoint is meant to draw, so this guesses from known names. Covers
// the checkpoints setup-forge.ps1 downloads by default (NoobAI-XL, RealVisXL,
// Flux Safe) plus other well-known models in each family, so a manually
// added checkpoint still gets a sensible label instead of none. Falls back
// to 'other', never to no category at all -- the dropdown always shows
// "<what it does> - <name>".
//
// Checked before the illustration/photorealistic keywords, not after: an
// NSFW Flux fine-tune's filename (e.g. "fluxed-up...") would otherwise also
// match 'flux' in PHOTOREAL_KEYWORDS and get mislabeled as the safe
// photorealistic category instead of the mature one it actually is.
const MATURE_KEYWORDS = ['fluxedup', 'fluxed-up', 'fluxed_up', 'nsfw'];
const ILLUSTRATION_KEYWORDS = ['noobai', 'illustrious', 'pony', 'animagine', 'waifu', 'niji', 'anything', 'counterfeit', 'aingdiffusion'];
const PHOTOREAL_KEYWORDS = ['realvis', 'juggernaut', 'epicrealism', 'photoreal', 'realistic', 'dreamshaper', 'absolutereality', 'realism', 'flux'];

function classifyLocalSdModel(filename) {
  const lower = filename.toLowerCase();
  if (MATURE_KEYWORDS.some(k => lower.includes(k))) return 'mature';
  if (ILLUSTRATION_KEYWORDS.some(k => lower.includes(k))) return 'illustration';
  if (PHOTOREAL_KEYWORDS.some(k => lower.includes(k))) return 'photorealistic';
  return 'other';
}

// Lists checkpoints currently installed on the MAIN Forge instance, via its
// documented /sdapi/v1/sd-models endpoint -- feeds the per-world "Image
// model" preset dropdown so it reflects what's actually on disk instead of
// requiring the exact filename to be typed by hand. `value` (the filename,
// with extension) is what gets saved as world.imageModel and sent back as
// override_settings.sd_model_checkpoint by callLocalSD above.
//
// The dedicated Chroma instance is a fixed, always-offered choice appended
// here rather than something queried from its own /sdapi/v1/sd-models --
// there is only ever one meaningful "model" on that instance (whatever was
// selected once in its own UI, see setup-forge-chroma.ps1), so listing it
// the same way as the main instance's real checkpoints would be misleading
// (it doesn't reflect an actual per-request choice the way the others do).
async function listLocalSdModels({ apiKey, baseUrl }) {
  const url = `${(baseUrl || 'http://localhost:7860').replace(/\/$/, '')}/sdapi/v1/sd-models`;
  const res = await fetch(url, {
    headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    timeout: 5000
  });
  if (!res.ok) throw new Error(`Local Stable Diffusion API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const models = (data || []).map(m => {
    const rawName = (m.filename || '').split(/[\\/]/).pop() || m.model_name || m.title || 'model';
    const value = rawName;
    const name = rawName.replace(/\.(safetensors|ckpt)$/i, '');
    return { value, name, category: classifyLocalSdModel(rawName) };
  });
  models.push({ value: CHROMA_MODEL_SENTINEL, name: 'Chroma (instance dediee, non censure a l\'entrainement)', category: 'mature' });
  return models;
}

module.exports = { generateImage, listLocalSdModels };
