// SQLite-backed store, standing in for Fogbound's lowdb-on-a-JSON-file --
// see the "Fogbound V2 Architecture" doc's Storage section for why: not a
// scale problem, a retrieval-primitive problem (lowdb only ever offered
// array .filter()/.sortBy(), a full scan every time; the Retriever role
// coming in Milestone 2 needs real indexed queries and eventually a vector
// column, neither of which a flat JSON file can give it).
//
// Each "collection" is a real table: a TEXT PRIMARY KEY id, a few indexed
// columns for what's actually queried by (worldId, saveId, turnNumber,
// itemDefId), and a `data` column holding the rest of the row as JSON. This
// document-store shape is deliberate -- it's what lets lib/gameEngine.js
// port from lowdb's chain API (db.get('x').find({...}).assign({...}).write())
// almost unchanged below, while queries by an indexed column go through a
// real SQL WHERE instead of a JS array scan.
//
// This also happens to close the exact failure mode that took the old app's
// database down for real once (see CHANGELOG.md in the Fogbound repo): a
// truncated mid-write JSON file. SQLite's own writes are atomic at the
// engine level -- there is no "half-written file" state to corrupt into --
// so the atomic-rename-write dance lib/dbAdapter.js did there isn't needed
// here at all. The rolling-backup half of that lesson still carries over
// (see maybeBackup below): a corrupt *disk* or a bad deploy is still a real
// risk independent of the write path being atomic.

const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const fs = require('fs');
const path = require('path');
const { EMBEDDING_DIMS } = require('./embeddingConfig');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'trame.db');
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
// Must load before schema.sql runs -- schema.sql's memoryFacts_vec table
// uses the vec0 virtual table module this extension provides (see the
// Retriever role, Milestone 2 of the V2 design doc).
sqliteVec.load(sqlite);
sqlite.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const DEFAULT_SETTINGS = {
  textProvider: 'mock',
  textModel: '',
  ollamaBaseUrl: 'http://localhost:11434',
  fallbackProvider: '',
  fallbackModel: '',
  language: 'fr',
  chapterLength: 400,
  imageProvider: 'mock',
  imageModel: null,
  imagesEnabled: false,
  localImageBaseUrl: 'http://localhost:7860',
  embeddingProvider: 'mock', // see providers/embeddingProviders.js -- 'gemini' reuses apiKeys.gemini below, no separate key needed
  apiKeys: {
    anthropic: '',
    openai: '',
    openrouter: '',
    gemini: '',
    ollama: '',
    stability: '',
    replicate: '',
    localsd: ''
  },
  // Separate from apiKeys/textProvider above on purpose: the Archivist,
  // Proofreader and Mastermind (see lib/backgroundModel.js) are narrow,
  // structured, fire-and-forget calls that never reach the player directly
  // -- once a key is set here they always run on a fixed, cheap model
  // regardless of whatever the player-facing Writer is configured with, no
  // model choice exposed for it. Empty apiKey falls back to the Writer's
  // own provider (see getBackgroundModelConfig), so this stays optional.
  backgroundModel: {
    apiKey: ''
  }
};

const hasSettings = sqlite.prepare('SELECT 1 FROM settings WHERE id = 1').get();
if (!hasSettings) {
  sqlite.prepare('INSERT INTO settings (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SETTINGS));
}

// Indexed (real) columns per table -- everything else in a row lives only
// inside `data`. A matcher key not listed here still works (see
// _matcherToRows below), just via a JS-level filter after the indexed
// columns have already narrowed the SQL result set.
const TABLE_COLUMNS = {
  worlds: ['id'],
  playableCharacters: ['id', 'worldId'],
  worldNpcs: ['id', 'worldId'],
  trackedItemDefs: ['id', 'worldId'],
  saves: ['id', 'worldId'],
  saveCharacters: ['id', 'saveId'],
  saveTrackedItemValues: ['id', 'saveId', 'itemDefId'],
  turns: ['id', 'saveId', 'turnNumber'],
  memoryFacts: ['id', 'saveId', 'turnNumber'],
  costLog: ['id', 'worldId', 'saveId'],
  storyClock: ['id', 'saveId'],
  timelineEvents: ['id', 'saveId', 'turnNumber'],
  proofreaderFlags: ['id', 'saveId', 'turnNumber'],
  mastermindPlans: ['id', 'saveId']
};

function toRow(data) {
  return JSON.parse(data);
}

// Splits a plain-object matcher into the part that can be pushed down into
// SQL (columns this table actually indexes) and the part that has to be
// checked in JS after the fact (everything else -- e.g. matching on `name`
// or `visibility`, which only ever live inside `data`).
function splitMatcher(table, matcher) {
  const cols = TABLE_COLUMNS[table] || ['id'];
  const whereParts = [];
  const params = [];
  const jsKeys = [];
  for (const [k, v] of Object.entries(matcher)) {
    if (cols.includes(k)) {
      if (v === null || v === undefined) whereParts.push(`${k} IS NULL`);
      else { whereParts.push(`${k} = ?`); params.push(v); }
    } else {
      jsKeys.push(k);
    }
  }
  return { whereParts, params, jsKeys };
}

function selectRows(table, matcher) {
  if (typeof matcher === 'function') {
    // No indexed column to push a predicate function down into SQL with --
    // every call site in gameEngine.js scopes these by saveId in the
    // predicate itself, and per-save row counts are small (see the design
    // doc's Storage section: "not a scale problem"), so a full scan here is
    // the honest tradeoff rather than trying to sniff the closure.
    return sqlite.prepare(`SELECT data FROM ${table}`).all().map(r => toRow(r.data)).filter(matcher);
  }
  const { whereParts, params, jsKeys } = splitMatcher(table, matcher || {});
  const sql = `SELECT data FROM ${table}` + (whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '');
  let rows = sqlite.prepare(sql).all(...params).map(r => toRow(r.data));
  if (jsKeys.length) rows = rows.filter(row => jsKeys.every(k => row[k] === matcher[k]));
  return rows;
}

const { maybeBackup } = require('./backup');

// memoryFacts rows with an embedding get a matching row in memoryFacts_vec
// (see the Retriever role, Milestone 2), kept in lockstep by rowid --
// gameEngine.js/roles/archivist.js never touch the vec table directly, only
// ever going through db.get('memoryFacts').push()/.remove() like any other
// collection, so this sync has to happen here rather than at every caller.
const VEC_COMPANIONS = { memoryFacts: 'memoryFacts_vec' };

function syncVecInsert(table, obj, rowid) {
  const vecTable = VEC_COMPANIONS[table];
  if (!vecTable || !Array.isArray(obj.embedding)) return;
  if (obj.embedding.length !== EMBEDDING_DIMS) {
    console.error(`[db] ${table} row ${obj.id} has a ${obj.embedding.length}-dim embedding, expected ${EMBEDDING_DIMS} -- skipping the vector index for it (the fact itself is still saved; it just won't be reachable by similarity search)`);
    return;
  }
  const vec = new Float32Array(obj.embedding);
  // rowid is always an internally-generated integer (better-sqlite3's own
  // lastInsertRowid on the row we just inserted), never user input --
  // inlined as a literal because vec0 virtual tables reject a *bound*
  // parameter for their rowid column (confirmed against sqlite-vec 0.1.9:
  // "Only integers are allowed for primary key values on <table>", even
  // when the bound value already is a plain integer).
  sqlite.prepare(`INSERT INTO ${vecTable}(rowid, embedding) VALUES (${rowid}, ?)`).run(vec);
}

function syncVecDelete(table, rowids) {
  const vecTable = VEC_COMPANIONS[table];
  if (!vecTable || !rowids.length) return;
  const stmt = sqlite.prepare(`DELETE FROM ${vecTable} WHERE rowid = ?`);
  rowids.forEach(rowid => stmt.run(rowid));
}

function insertRow(table, obj) {
  maybeBackup(dbPath);
  const cols = TABLE_COLUMNS[table] || ['id'];
  const colNames = cols.join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map(c => obj[c] ?? null);
  const info = sqlite.prepare(`INSERT INTO ${table} (${colNames}, data) VALUES (${placeholders}, ?)`)
    .run(...values, JSON.stringify(obj));
  syncVecInsert(table, obj, info.lastInsertRowid);
  return obj;
}

function updateRow(table, obj) {
  maybeBackup(dbPath);
  const cols = TABLE_COLUMNS[table] || ['id'];
  const setCols = cols.filter(c => c !== 'id');
  const setClause = setCols.map(c => `${c} = ?`).join(', ');
  const values = setCols.map(c => obj[c] ?? null);
  sqlite.prepare(`UPDATE ${table} SET ${setClause}${setClause ? ', ' : ''}data = ? WHERE id = ?`)
    .run(...values, JSON.stringify(obj), obj.id);
  return obj;
}

// Shared by both "delete by id, one row at a time" paths below (a JS
// predicate function, or a matcher touching a non-indexed field) -- cleans
// up any vec companion row first, by rowid, before the main delete.
function deleteRowsByIds(table, rows) {
  if (rows.length) {
    const rowidStmt = sqlite.prepare(`SELECT rowid FROM ${table} WHERE id = ?`);
    syncVecDelete(table, rows.map(r => rowidStmt.get(r.id).rowid));
  }
  const stmt = sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`);
  rows.forEach(r => stmt.run(r.id));
  return rows.length;
}

function deleteRows(table, matcher) {
  maybeBackup(dbPath);
  if (typeof matcher === 'function') {
    return deleteRowsByIds(table, selectRows(table, matcher));
  }
  const { whereParts, params, jsKeys } = splitMatcher(table, matcher || {});
  if (jsKeys.length) {
    // A matcher touching a non-indexed field (e.g. remove by name) -- not
    // needed by any current call site, but kept correct rather than silently
    // dropping the extra condition.
    return deleteRowsByIds(table, selectRows(table, matcher));
  }
  const whereSql = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';
  if (VEC_COMPANIONS[table]) {
    const rowidRows = sqlite.prepare(`SELECT rowid FROM ${table}${whereSql}`).all(...params);
    syncVecDelete(table, rowidRows.map(r => r.rowid));
  }
  return sqlite.prepare(`DELETE FROM ${table}${whereSql}`).run(...params).changes;
}

// Thin chain wrappers so lib/gameEngine.js can read almost identically to
// the lowdb version it was ported from -- db.get('x').find({...}).assign({...}).write(),
// db.get('x').filter({...}).sortBy('turnNumber').value(), etc. Writes
// (push/assign/remove) happen immediately when called, same as they did
// under lowdb's own FileSync adapter; .write() is a no-op kept only so the
// call sites don't need to change.
class ArrayResult {
  constructor(rows) { this.rows = rows; }
  value() { return this.rows; }
  sortBy(field) {
    return new ArrayResult([...this.rows].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0)));
  }
  size() { const n = this.rows.length; return { value: () => n }; }
  last() { const row = this.rows[this.rows.length - 1]; return { value: () => row }; }
}

class SingleRef {
  constructor(table, row) { this.table = table; this.row = row; }
  value() { return this.row; }
  assign(patch) {
    if (!this.row) return { write: () => undefined };
    this.row = Object.assign({}, this.row, patch);
    updateRow(this.table, this.row);
    const row = this.row;
    return { write: () => row };
  }
}

class CollectionRef {
  constructor(table) { this.table = table; }
  value() { return selectRows(this.table, {}); }
  push(obj) { insertRow(this.table, obj); return { write: () => obj }; }
  find(matcher) { return new SingleRef(this.table, selectRows(this.table, matcher)[0] || null); }
  filter(matcher) { return new ArrayResult(selectRows(this.table, matcher)); }
  remove(matcher) { deleteRows(this.table, matcher); return { write: () => true }; }
}

// The Retriever's one real query (see roles/retriever.js, Milestone 2):
// top-K memoryFacts by embedding similarity to a query vector, scoped to a
// save and to either the general pool (character IS NULL, excluding
// WORLD LORE's biographical facts, which stay static/full elsewhere and are
// never retrieved) or one character's own facts. Superseded facts (see the
// status field, Milestone 4) are excluded even though nothing sets that yet.
//
// Two queries rather than one: sqlite-vec's vec0 MATCH needs a `rowid IN
// (...)` list to pre-filter by save/character (verified against sqlite-vec
// 0.1.9 -- this is the supported pattern for a scoped KNN search), so the
// candidate set is fetched first from the plain memoryFacts table, which
// already has real indexes on saveId (see TABLE_COLUMNS) to make that cheap.
// viewerCharacter (added for the POV mechanic): the character whose
// knowledge this retrieval is scoped to -- the MC's name on a normal turn,
// or the POV character's name during a POV scene (see
// gameEngine.js's gatherTurnContext / playPovTurnStreaming). A fact with a
// non-null knownBy is excluded unless viewerCharacter is in that list --
// this is the actual knowledge wall, enforced here rather than left to the
// Writer's own judgment. A fact with knownBy: null (the default -- every
// fact created before this field existed, and most facts since) is
// unaffected and visible to everyone, same as before this existed.
// omniscient (Milestone 4's Proofreader -- see roles/proofreader.js): skips
// the knownBy check entirely instead of scoping to a single viewer. The
// knowledge wall exists to keep a CHARACTER (the MC, a POV character) from
// knowing something they have no way to know -- it was never meant to hide
// facts from the narrator-level bookkeeping that checks the story's own
// consistency against itself. A private/secret fact is exactly the kind of
// thing a contradiction check most needs to see.
function searchMemoryFactsByEmbedding({ saveId, embedding, k, character, viewerCharacter, omniscient }) {
  // status/character/type/knownBy live only inside `data` (see
  // TABLE_COLUMNS -- memoryFacts only indexes id/saveId/turnNumber), so the
  // candidate pool is narrowed by the real saveId index first, then
  // filtered in JS -- same pattern splitMatcher's jsKeys fallback already
  // uses elsewhere.
  const rows = sqlite.prepare('SELECT rowid, data FROM memoryFacts WHERE saveId = ?').all(saveId);
  const candidates = rows
    .map(r => ({ rowid: r.rowid, fact: toRow(r.data) }))
    .filter(({ fact }) =>
      fact.status === 'active' &&
      (character ? fact.character === character : (!fact.character && fact.type !== 'biographical')) &&
      (omniscient || !fact.knownBy || fact.knownBy.includes(viewerCharacter))
    );
  if (!candidates.length) return [];
  // Candidate rowids come from our own just-run query (real integers, not
  // user input) -- inlined for the same reason as syncVecInsert's rowid: a
  // bound parameter list here would need one placeholder per candidate
  // anyway, and vec0's own rowid handling is already known to be picky
  // about bound values (see syncVecInsert's comment).
  const rowidList = candidates.map(r => r.rowid).join(',');
  const matches = sqlite.prepare(
    `SELECT rowid, distance FROM memoryFacts_vec WHERE embedding MATCH ? AND k = ? AND rowid IN (${rowidList}) ORDER BY distance`
  ).all(new Float32Array(embedding), k);
  const getRow = sqlite.prepare('SELECT data FROM memoryFacts WHERE rowid = ?');
  return matches.map(m => toRow(getRow.get(m.rowid).data));
}

const db = {
  get(key) {
    if (key === 'settings') {
      const row = sqlite.prepare('SELECT data FROM settings WHERE id = 1').get();
      const data = row ? toRow(row.data) : null;
      return { value: () => data };
    }
    return new CollectionRef(key);
  },
  set(key, value) {
    if (key !== 'settings') throw new Error(`db.set() only supports 'settings' in this compat layer, got '${key}'`);
    return { write: () => { sqlite.prepare('UPDATE settings SET data = ? WHERE id = 1').run(JSON.stringify(value)); return value; } };
  },
  searchMemoryFactsByEmbedding
};

module.exports = db;
