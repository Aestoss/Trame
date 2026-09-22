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
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'trame.db');
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
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
  apiKeys: {
    anthropic: '',
    openai: '',
    openrouter: '',
    gemini: '',
    ollama: '',
    stability: '',
    replicate: '',
    localsd: ''
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
  costLog: ['id', 'worldId', 'saveId']
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

function insertRow(table, obj) {
  maybeBackup(dbPath);
  const cols = TABLE_COLUMNS[table] || ['id'];
  const colNames = cols.join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map(c => obj[c] ?? null);
  sqlite.prepare(`INSERT INTO ${table} (${colNames}, data) VALUES (${placeholders}, ?)`)
    .run(...values, JSON.stringify(obj));
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

function deleteRows(table, matcher) {
  maybeBackup(dbPath);
  if (typeof matcher === 'function') {
    const rows = selectRows(table, matcher);
    const stmt = sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`);
    rows.forEach(r => stmt.run(r.id));
    return rows.length;
  }
  const { whereParts, params, jsKeys } = splitMatcher(table, matcher || {});
  if (jsKeys.length) {
    // A matcher touching a non-indexed field (e.g. remove by name) -- not
    // needed by any current call site, but kept correct rather than silently
    // dropping the extra condition.
    const rows = selectRows(table, matcher);
    const stmt = sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`);
    rows.forEach(r => stmt.run(r.id));
    return rows.length;
  }
  const sql = `DELETE FROM ${table}` + (whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '');
  return sqlite.prepare(sql).run(...params).changes;
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
  }
};

module.exports = db;
