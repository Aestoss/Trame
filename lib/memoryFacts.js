// Shared shape helpers for memoryFacts rows -- factored out of
// lib/gameEngine.js so roles/archivist.js can build the exact same row shape
// without requiring gameEngine.js back (gameEngine.js requires
// roles/archivist.js to fire it off after a turn; requiring gameEngine.js
// from archivist.js too would make that a circular require).
const { v4: uuid } = require('uuid');

// new_facts entries are normally { fact, character, type } (see
// buildArchivistPrompt's NEW FACTS section), but a bare string is also
// accepted defensively -- a model not quite following the shape, or an
// older saved turn replayed some other way, should degrade to "general
// plot fact" rather than crash the caller.
function normalizeNewFact(entry) {
  if (typeof entry === 'string') {
    return { fact: entry, character: null, type: 'plot' };
  }
  if (entry && typeof entry === 'object') {
    return {
      fact: typeof entry.fact === 'string' ? entry.fact : '',
      character: (typeof entry.character === 'string' && entry.character.trim()) ? entry.character.trim() : null,
      type: entry.type === 'biographical' ? 'biographical' : 'plot'
    };
  }
  return { fact: '', character: null, type: 'plot' };
}

// memoryFacts carries three fields per the V2 design doc's Data model
// section that nothing reads yet: status/supersededBy (contradiction
// resolution, Milestone 4) and embedding (the Retriever, Milestone 2). Set
// here so every fact already has the right shape once those roles exist,
// instead of needing a backfill migration later.
function newMemoryFact({ saveId, turnNumber, fact, character, type }) {
  return {
    id: uuid(), saveId, turnNumber, fact, character, type,
    status: 'active', supersededBy: null, embedding: null,
    createdAt: new Date().toISOString()
  };
}

module.exports = { normalizeNewFact, newMemoryFact };
