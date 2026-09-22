const { v4: uuid } = require('uuid');
const db = require('./db');
const { estimateCostUsd } = require('./pricing');

// One row per AI text-generation call. Image generation isn't token-based
// so it isn't costed here — see TODO.md if that's ever worth adding.
function recordCost({ worldId, saveId, kind, provider, model, usage }) {
  const inputTokens = usage?.inputTokens || 0;
  const outputTokens = usage?.outputTokens || 0;
  db.get('costLog').push({
    id: uuid(),
    worldId: worldId || null,
    saveId: saveId || null,
    kind, // 'world_creation' | 'turn' | 'summary' | 'character_generation' | 'world_ai_edit'
    provider,
    model: model || null,
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCostUsd(provider, model, inputTokens, outputTokens),
    createdAt: new Date().toISOString()
  }).write();
}

function summarize(entries) {
  return entries.reduce((acc, e) => {
    acc.inputTokens += e.inputTokens;
    acc.outputTokens += e.outputTokens;
    acc.calls += 1;
    if (e.estimatedCostUsd != null) {
      acc.estimatedCostUsd = (acc.estimatedCostUsd || 0) + e.estimatedCostUsd;
    } else {
      acc.hasUnknownCost = true;
    }
    return acc;
  }, { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: null, hasUnknownCost: false });
}

function getTotalCosts() {
  return summarize(db.get('costLog').value());
}

function getWorldCosts(worldId) {
  return summarize(db.get('costLog').filter({ worldId }).value());
}

module.exports = { recordCost, getTotalCosts, getWorldCosts };
