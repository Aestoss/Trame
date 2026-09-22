-- Trame's schema. Every "collection" table follows the same shape: a real
-- TEXT PRIMARY KEY id, a handful of indexed columns actually queried by
-- (worldId, saveId, turnNumber, itemDefId), and a `data` column holding the
-- rest of the row as JSON -- see lib/db.js for why (a document-store shape
-- keeps the port from Fogbound's lowdb schema close to line-for-line, while
-- still giving real indexed WHERE queries instead of lowdb's full-array
-- scan, per the V2 design doc's Storage section).

CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playableCharacters (
  id TEXT PRIMARY KEY,
  worldId TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playableCharacters_worldId ON playableCharacters(worldId);

CREATE TABLE IF NOT EXISTS worldNpcs (
  id TEXT PRIMARY KEY,
  worldId TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_worldNpcs_worldId ON worldNpcs(worldId);

CREATE TABLE IF NOT EXISTS trackedItemDefs (
  id TEXT PRIMARY KEY,
  worldId TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trackedItemDefs_worldId ON trackedItemDefs(worldId);

CREATE TABLE IF NOT EXISTS saves (
  id TEXT PRIMARY KEY,
  worldId TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saves_worldId ON saves(worldId);

CREATE TABLE IF NOT EXISTS saveCharacters (
  id TEXT PRIMARY KEY,
  saveId TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saveCharacters_saveId ON saveCharacters(saveId);

CREATE TABLE IF NOT EXISTS saveTrackedItemValues (
  id TEXT PRIMARY KEY,
  saveId TEXT NOT NULL,
  itemDefId TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saveTrackedItemValues_saveId ON saveTrackedItemValues(saveId);
CREATE INDEX IF NOT EXISTS idx_saveTrackedItemValues_itemDefId ON saveTrackedItemValues(itemDefId);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  saveId TEXT NOT NULL,
  turnNumber INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_saveId ON turns(saveId);
CREATE INDEX IF NOT EXISTS idx_turns_saveId_turnNumber ON turns(saveId, turnNumber);

-- New fields per the V2 design doc's Data model section (status,
-- supersededBy, embedding) live inside `data` for now -- see lib/db.js.
-- They're unpopulated until the Archivist/Retriever roles land
-- (Milestones 1-2), but the column shape needs no migration to get there.
CREATE TABLE IF NOT EXISTS memoryFacts (
  id TEXT PRIMARY KEY,
  saveId TEXT NOT NULL,
  turnNumber INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memoryFacts_saveId ON memoryFacts(saveId);

-- The Retriever's index (Milestone 2 of the V2 design doc): one row per
-- memoryFacts row that has an embedding, same rowid on both sides (see
-- lib/db.js's syncVecInsert/syncVecDelete -- kept in lockstep there, not
-- here, since this table has no id/foreign-key column of its own to join
-- on otherwise). Dimension must match lib/embeddingConfig.js's
-- EMBEDDING_DIMS; sqlite-vec's vec0 module (loaded in lib/db.js before this
-- file runs) is what provides the CREATE VIRTUAL TABLE syntax below.
CREATE VIRTUAL TABLE IF NOT EXISTS memoryFacts_vec USING vec0(embedding float[768]);

CREATE TABLE IF NOT EXISTS costLog (
  id TEXT PRIMARY KEY,
  worldId TEXT,
  saveId TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_costLog_worldId ON costLog(worldId);
CREATE INDEX IF NOT EXISTS idx_costLog_saveId ON costLog(saveId);

-- Singleton -- always exactly one row (id=1). See lib/db.js's settings
-- special-case.
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

-- New per the V2 design doc's Data model section -- one row per save,
-- populated every turn starting Milestone 1 (nothing reads it until
-- Milestone 3's Proofreader). `id` always equals the save's id (there's
-- inherently at most one row per save) so this table fits the same
-- id-keyed CollectionRef machinery as every other table in lib/db.js,
-- rather than needing its own special case there.
CREATE TABLE IF NOT EXISTS storyClock (
  id TEXT PRIMARY KEY,
  saveId TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_storyClock_saveId ON storyClock(saveId);

-- New per the V2 design doc -- versioned, one active row per save + history,
-- unpopulated until Milestone 3 (the Mastermind).
CREATE TABLE IF NOT EXISTS mastermindPlans (
  id TEXT PRIMARY KEY,
  saveId TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mastermindPlans_saveId ON mastermindPlans(saveId);
