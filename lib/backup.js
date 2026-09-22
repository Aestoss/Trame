// Rolling backups of the SQLite file -- an independent safety net alongside
// the engine's own write atomicity (see lib/db.js's top comment). Ported
// from Fogbound's lib/dbAdapter.js almost unchanged: same interval, same
// retention count, same reasoning -- a corrupt disk or a bad deploy is a
// real risk independent of whether the write path itself is atomic, and
// this is cheap insurance against it either way.

const fs = require('fs');
const path = require('path');

const BACKUP_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BACKUPS = 12;

let lastBackupAt = 0;

function backupDir(sourcePath) {
  return path.join(path.dirname(sourcePath), 'backups');
}

function maybeBackup(sourcePath) {
  const now = Date.now();
  if (now - lastBackupAt < BACKUP_INTERVAL_MS) return;
  lastBackupAt = now;
  try {
    if (!fs.existsSync(sourcePath)) return;
    const dir = backupDir(sourcePath);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(dir, `${path.basename(sourcePath)}.${stamp}.bak`);
    // better-sqlite3's own .backup() would be the "correct" way to snapshot
    // a live WAL-mode database consistently, but a plain file copy of the
    // main db file is what Fogbound's equivalent did and is good enough for
    // this stage -- revisit if a restore is ever actually attempted from
    // mid-write WAL state.
    fs.copyFileSync(sourcePath, dest);
    const files = fs.readdirSync(dir).filter(f => f.startsWith(`${path.basename(sourcePath)}.`)).sort();
    const excess = files.length - MAX_BACKUPS;
    if (excess > 0) files.slice(0, excess).forEach(f => fs.unlinkSync(path.join(dir, f)));
  } catch (e) {
    // A failed backup should never take the app down with it.
    console.error(`[backup] failed: ${e.message}`);
  }
}

module.exports = { maybeBackup };
