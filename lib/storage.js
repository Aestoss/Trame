// Cloud Storage-backed image store, replacing the local DATA_DIR/images disk
// folder (see git history, and the migration scope doc for why: Cloud Run
// has no persistent local disk). Images keep the exact same /images/<file>
// URL shape as before -- server.js now streams that path from the bucket
// instead of express.static-ing a local folder -- so nothing stored in
// Firestore (world.coverImageUrl, character.portraitUrl, turn.imageUrl)
// needs to change shape.
//
// Requiring ./db first is deliberate, not incidental: it's the one place
// that calls initializeApp(), and this module needs that same app (with its
// storageBucket option) already initialized before getStorage() can resolve
// a default bucket.
require('./db');
const { getStorage } = require('firebase-admin/storage');

const bucket = getStorage().bucket();

function keyFor(filename) {
  return `images/${filename}`;
}

async function saveImage(filename, buffer, contentType) {
  await bucket.file(keyFor(filename)).save(buffer, { metadata: { contentType } });
}

// Streams the image straight into the given response, setting its
// content-type from the object's own stored metadata. Returns false (having
// written nothing) if the object doesn't exist, so the caller can 404.
async function streamImage(filename, res) {
  const file = bucket.file(keyFor(filename));
  const [exists] = await file.exists();
  if (!exists) return false;
  const [metadata] = await file.getMetadata();
  res.setHeader('content-type', metadata.contentType || 'application/octet-stream');
  await new Promise((resolve, reject) => {
    file.createReadStream().on('error', reject).on('end', resolve).pipe(res);
  });
  return true;
}

async function deleteImage(filename) {
  try {
    await bucket.file(keyFor(filename)).delete();
  } catch (e) {
    // Already gone, or never existed -- fine either way, same as the old
    // fs.unlinkSync's try/catch.
  }
}

module.exports = { saveImage, streamImage, deleteImage };
