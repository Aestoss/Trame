// Shared shape helpers for memoryFacts rows -- factored out of
// lib/gameEngine.js so roles/archivist.js can build the exact same row shape
// without requiring gameEngine.js back (gameEngine.js requires
// roles/archivist.js to fire it off after a turn; requiring gameEngine.js
// from archivist.js too would make that a circular require).
const { v4: uuid } = require('uuid');

// new_facts entries are normally { fact, character, type, known_by } (see
// buildArchivistPrompt's NEW FACTS section), but a bare string is also
// accepted defensively -- a model not quite following the shape, or an
// older saved turn replayed some other way, should degrade to "general
// plot fact, publicly known" rather than crash the caller.
function normalizeNewFact(entry) {
  if (typeof entry === 'string') {
    return { fact: entry, character: null, type: 'plot', knownBy: null };
  }
  if (entry && typeof entry === 'object') {
    const knownBy = Array.isArray(entry.known_by)
      ? entry.known_by.map(n => (typeof n === 'string' ? n.trim() : '')).filter(Boolean)
      : null;
    return {
      fact: typeof entry.fact === 'string' ? entry.fact : '',
      character: (typeof entry.character === 'string' && entry.character.trim()) ? entry.character.trim() : null,
      type: entry.type === 'biographical' ? 'biographical' : 'plot',
      // Empty array would silently mean "known by no one" -- treat that the
      // same as omitted (null, publicly known) rather than trust a model's
      // empty list, which is far more likely to be a formatting slip than a
      // deliberate "nobody knows this" claim.
      knownBy: (knownBy && knownBy.length) ? knownBy : null
    };
  }
  return { fact: '', character: null, type: 'plot', knownBy: null };
}

// memoryFacts carries fields per the V2 design doc's Data model section
// that nothing read for a while: status/supersededBy (contradiction
// resolution, Milestone 4) and embedding (the Retriever, Milestone 2). Set
// here so every fact already has the right shape once those roles exist,
// instead of needing a backfill migration later.
//
// knownBy (added for the POV mechanic): null means publicly known/witnessed
// -- the default, and every fact ever created before this field existed
// behaves exactly the same as before. A populated array of character names
// means only those characters know it -- enforced at retrieval time (see
// lib/db.js's searchMemoryFactsByEmbedding), not left to the Writer's own
// judgment, so a fact learned only during one character's POV scene can't
// leak into another character's (or the MC's) context afterward.
function newMemoryFact({ saveId, turnNumber, fact, character, type, knownBy }) {
  return {
    id: uuid(), saveId, turnNumber, fact, character, type,
    status: 'active', supersededBy: null, embedding: null, knownBy: knownBy || null,
    createdAt: new Date().toISOString()
  };
}

module.exports = { normalizeNewFact, newMemoryFact };
