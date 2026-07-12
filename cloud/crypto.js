/*
 * At-rest encryption for user data.
 *
 * When DATA_ENCRYPTION_KEY is set (a 32-byte key as hex or base64), every
 * user's data blob is encrypted with AES-256-GCM before it touches the
 * database — so a stolen/leaked DB dump is unreadable ciphertext. The server
 * holds the key, so it can still decrypt to run the smart notifications,
 * admin analytics, etc. (This is at-rest encryption, not zero-knowledge.)
 *
 * Backward compatible: rows written before a key was set stay readable, and
 * with no key configured this is a transparent no-op (values pass through).
 */
'use strict';
const crypto = require('crypto');

let _warned = false;
function key() {
  const raw = String(process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  let buf = null;
  try { buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64'); } catch { buf = null; }
  if (!buf || buf.length !== 32) {
    if (!_warned) { console.warn('⚠️  DATA_ENCRYPTION_KEY is set but is not a valid 32-byte key (hex or base64) — data encryption is OFF.'); _warned = true; }
    return null;
  }
  return buf;
}
function enabled() { return !!key(); }

// Encrypt a JS object → a self-describing envelope, or the object unchanged if
// no key is configured. The envelope is plain JSON so it fits a TEXT or JSONB column.
function encryptData(obj) {
  const k = key();
  if (!k) return obj; // no key → store as-is
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return { __enc: 'a256gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
// Reverse of encryptData. Legacy plaintext (no __enc envelope) passes straight through.
function decryptData(stored) {
  if (!stored || typeof stored !== 'object' || stored.__enc !== 'a256gcm') return stored;
  const k = key();
  if (!k) throw new Error('DATA_ENCRYPTION_KEY is required to read encrypted data but is not set.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(stored.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(stored.ct, 'base64')), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

module.exports = { encryptData, decryptData, enabled };
