// Single source of truth for the embedding vector dimension -- shared by
// lib/db.js (the memoryFacts_vec virtual table's declared width) and
// providers/embeddingProviders.js (every provider's output width, since
// sqlite-vec's vec0 module requires one fixed dimension for the whole
// table, so a provider switch can't silently produce a mismatched vector).
// 768 matches Gemini's text-embedding-004 output natively, and the mock
// provider below is written to hash into this same width regardless.
const EMBEDDING_DIMS = 768;

module.exports = { EMBEDDING_DIMS };
