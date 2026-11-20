// Firestore-backed store, replacing the SQLite version (see git history for
// that one, and the migration scope doc for why: Cloud Run has no real
// persistent local disk, and this app's data now lives in Firebase).
//
// Each "collection" maps 1:1 to a Firestore collection of the same name,
// one document per row, the document id equal to the row's own `id` field.
// Unlike the old SQLite version, nothing needs declaring up front as an
// "indexed column" -- Firestore auto-indexes every top-level field for
// simple equality queries, which is all this app's matchers ever use.
//
// The one real consequence of this swap: Firestore's client is entirely
// asynchronous (no synchronous driver exists), where better-sqlite3's was
// synchronous. The public chain API below (db.get('x').find({...}).value())
// keeps the exact same shape, but find()/filter() now return a Promise that
// resolves to the ref/result, so every call site needs an `await` before
// chaining .value()/.assign()/.sortBy() -- a mechanical change, not a
// logic change, but a real one, propagated through gameEngine.js and
// roles/*.js.
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'trame-dev';

if (!getApps().length) {
  initializeApp({
    projectId,
    // Lets lib/storage.js resolve the default bucket via getStorage().bucket()
    // with no argument -- overridable via FIREBASE_STORAGE_BUCKET once a real
    // project exists, in case its actual default bucket name differs.
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`
  });
}

const firestore = getFirestore();

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

const SETTINGS_DOC = firestore.collection('_meta').doc('settings');

async function getSettings() {
  const snap = await SETTINGS_DOC.get();
  if (!snap.exists) {
    await SETTINGS_DOC.set(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  return snap.data();
}

// Firestore's .where() rejects `undefined` outright -- the old SQL version
// treated an undefined/null matcher value as "IS NULL"; same intent here.
async function selectRows(table, matcher) {
  if (typeof matcher === 'function') {
    const snap = await firestore.collection(table).get();
    return snap.docs.map(d => d.data()).filter(matcher);
  }
  let query = firestore.collection(table);
  for (const [k, v] of Object.entries(matcher || {})) {
    query = query.where(k, '==', v === undefined ? null : v);
  }
  const snap = await query.get();
  return snap.docs.map(d => d.data());
}

// Thin chain wrappers so lib/gameEngine.js and roles/*.js read almost
// identically to the SQLite version they were ported from --
// db.get('x').find({...}).assign({...}).write(), db.get('x').filter({...})
// .sortBy('turnNumber').value(), etc. find()/filter() are async (they do a
// real Firestore read); everything chained after their resolved value is
// synchronous again, same as before, since by then the data is already
// local.
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
    if (!this.row) return { write: async () => undefined };
    this.row = Object.assign({}, this.row, patch);
    const row = this.row;
    const writePromise = firestore.collection(this.table).doc(row.id).set(row);
    return { write: () => writePromise.then(() => row) };
  }
}

class CollectionRef {
  constructor(table) { this.table = table; }
  async value() {
    const snap = await firestore.collection(this.table).get();
    return snap.docs.map(d => d.data());
  }
  push(obj) {
    const writePromise = firestore.collection(this.table).doc(obj.id).set(obj);
    return { write: () => writePromise.then(() => obj) };
  }
  async find(matcher) {
    const rows = await selectRows(this.table, matcher);
    return new SingleRef(this.table, rows[0] || null);
  }
  async filter(matcher) {
    const rows = await selectRows(this.table, matcher);
    return new ArrayResult(rows);
  }
  remove(matcher) {
    const writePromise = (async () => {
      const rows = await selectRows(this.table, matcher);
      if (!rows.length) return 0;
      const batch = firestore.batch();
      rows.forEach(r => batch.delete(firestore.collection(this.table).doc(r.id)));
      await batch.commit();
      return rows.length;
    })();
    return { write: () => writePromise };
  }
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// The Retriever's one real query (see roles/retriever.js): top-K memoryFacts
// by embedding similarity to a query vector, scoped to a save and to either
// the general pool (character IS NULL, excluding WORLD LORE's biographical
// facts) or one character's own facts. No managed vector index here --
// Firestore has none, and the paid alternative (Vertex AI Vector Search)
// has no free tier -- so this is a plain brute-force scan: fetch every
// active candidate fact for the save (already scoped by the real saveId
// index Firestore gives every field for free) and rank by cosine
// similarity in JS. Genuinely fine at this app's scale: a save's fact count
// runs in the hundreds to low thousands at most (memoryFacts are never
// pruned the way turns are -- see maybeSummarize in gameEngine.js), and
// comparing a few thousand 768-number vectors is well under a tenth of a
// second, invisible next to the AI call itself.
//
// knownBy/omniscient semantics are unchanged from the SQLite version -- see
// its own comment history for the reasoning; only the ranking mechanism
// changed, not the filtering rules.
async function searchMemoryFactsByEmbedding({ saveId, embedding, k, character, viewerCharacter, omniscient }) {
  const snap = await firestore.collection('memoryFacts').where('saveId', '==', saveId).get();
  const candidates = snap.docs
    .map(d => d.data())
    .filter(fact =>
      fact.status === 'active' &&
      Array.isArray(fact.embedding) &&
      (character ? fact.character === character : (!fact.character && fact.type !== 'biographical')) &&
      (omniscient || !fact.knownBy || fact.knownBy.includes(viewerCharacter))
    );
  if (!candidates.length) return [];
  const scored = candidates.map(fact => ({ fact, score: cosineSimilarity(embedding, fact.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(s => s.fact);
}

const db = {
  get(key) {
    if (key === 'settings') {
      return { value: () => getSettings() };
    }
    return new CollectionRef(key);
  },
  set(key, value) {
    if (key !== 'settings') throw new Error(`db.set() only supports 'settings' in this compat layer, got '${key}'`);
    const writePromise = SETTINGS_DOC.set(value);
    return { write: () => writePromise.then(() => value) };
  },
  searchMemoryFactsByEmbedding
};

module.exports = db;
