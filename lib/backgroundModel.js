// Model selection for the background/async roles (Archivist, Proofreader,
// Mastermind -- see roles/*.js). These are narrow, structured,
// fire-and-forget calls the player never waits on, so they don't need the
// Writer's own (often pricier) model. settings.backgroundModel holds only
// an API key -- the provider/model itself is fixed below, not something
// the Settings UI exposes a choice for.
const BACKGROUND_MODEL_PROVIDER = 'gemini';
const BACKGROUND_MODEL_ID = 'gemini-3.5-flash-lite';

// No background key set yet -> fall back to whatever the Writer is
// configured with, so mock/local setups and installs that haven't visited
// this new setting keep working exactly as before.
function getBackgroundModelConfig(settings) {
  const apiKey = (settings.backgroundModel && settings.backgroundModel.apiKey) || '';
  if (apiKey) {
    return { provider: BACKGROUND_MODEL_PROVIDER, model: BACKGROUND_MODEL_ID, apiKey, baseUrl: settings.ollamaBaseUrl };
  }
  return {
    provider: settings.textProvider,
    model: settings.textModel,
    apiKey: settings.apiKeys[settings.textProvider],
    baseUrl: settings.ollamaBaseUrl
  };
}

module.exports = { BACKGROUND_MODEL_PROVIDER, BACKGROUND_MODEL_ID, getBackgroundModelConfig };
