// Best-effort $/1M-token pricing so the cost tracker can show an estimate,
// not just raw token counts. Provider pricing changes over time (we've
// already had one model get retired mid-project) — treat every number here
// as approximate and safe to edit; a missing entry just means "unknown
// cost", never a crash.
//
// Each provider maps a few known model-name substrings to { in, out } USD
// per 1M tokens. The first matching substring wins; `default` is used when
// no specific model is set (matches each provider's own hardcoded default).

// Entries are checked in order and the FIRST substring match wins, so a
// more specific generation (e.g. "sonnet-5") must be listed before a looser
// one that would also match it (e.g. "sonnet") — otherwise every generation
// of a model family collapses onto the same (likely wrong) price.
const PRICING = {
  anthropic: {
    default: { in: 3, out: 15 }, // matches the hardcoded fallback model (Sonnet 4.6)
    entries: [
      ['fable', { in: 3, out: 15 }], // Fable 5.1 — no published rate card yet, priced as Sonnet-tier pending confirmation
      ['haiku-4-5', { in: 1, out: 5 }],
      ['haiku', { in: 0.8, out: 4 }], // older Haiku generations
      ['opus-5', { in: 5, out: 25 }],
      ['opus', { in: 15, out: 75 }], // older Opus generations (4/4.1)
      ['sonnet-5', { in: 2, out: 10 }],
      ['sonnet', { in: 3, out: 15 }] // Sonnet 4.6 and earlier
    ]
  },
  openai: {
    default: { in: 2.5, out: 10 },
    entries: [
      ['mini', { in: 0.15, out: 0.6 }],
      ['gpt-4o', { in: 2.5, out: 10 }]
    ]
  },
  gemini: {
    // Flash promotional rate runs through end of 2026, doubling to
    // {in:1.50, out:7.50} on 2027-01-01 — revisit this then.
    default: { in: 0.75, out: 3.75 },
    entries: [
      ['flash', { in: 0.75, out: 3.75 }],
      ['pro', { in: 2, out: 12 }]
    ]
  },
  // OpenRouter proxies to wildly different underlying models at different
  // prices — showing a made-up number would be actively misleading, so we
  // only ever report token counts for it, never a $ estimate.
  openrouter: null,
  // A local Ollama instance runs on the user's own hardware — no per-token
  // billing exists to estimate.
  ollama: { default: { in: 0, out: 0 }, entries: [] },
  mock: { default: { in: 0, out: 0 }, entries: [] }
};

function rateFor(provider, model) {
  const table = PRICING[provider];
  if (!table) return null;
  const m = (model || '').toLowerCase();
  const match = table.entries.find(([needle]) => m.includes(needle));
  return (match ? match[1] : table.default) || null;
}

// Returns a USD estimate, or null when the provider/model has no known price.
function estimateCostUsd(provider, model, inputTokens, outputTokens) {
  const rate = rateFor(provider, model);
  if (!rate) return null;
  return (inputTokens / 1_000_000) * rate.in + (outputTokens / 1_000_000) * rate.out;
}

module.exports = { estimateCostUsd };
