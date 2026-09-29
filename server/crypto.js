const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Refresh tokens (kept inside each oauth_accounts row, see db.js) are the
// "crown jewel" secret once OAuth removes the password from the picture —
// encrypted at rest with a key generated per-installation and stored in its
// own file, separate from calendar.db itself, never baked into source. A
// single file with restrictive permissions is a reasonable bar for a
// self-hosted single-machine deployment; TOKEN_KEY_PATH lets anyone who
// wants stronger separation (a different mounted secret volume, say) point
// it elsewhere without code changes.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const KEY_PATH = process.env.TOKEN_KEY_PATH || path.join(DATA_DIR, 'token.key');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getOrCreateKey() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(KEY_PATH)) return fs.readFileSync(KEY_PATH);
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, key, { mode: 0o600 });
  return key;
}

// Read once per process, not on every encrypt/decrypt call.
let cachedKey = null;
function activeKey() {
  if (!cachedKey) cachedKey = getOrCreateKey();
  return cachedKey;
}

// Packs iv + auth tag + ciphertext into one base64 string, so each
// encrypted value only needs a single TEXT column in storage.
function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, activeKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decrypt(packed) {
  const buf = Buffer.from(packed, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, activeKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, getOrCreateKey, KEY_PATH };
