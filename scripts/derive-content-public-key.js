#!/usr/bin/env node
// Derive contentKeyPair.publicKey from browser masterSecret (base64url).
const sodium = require('libsodium-wrappers');
const crypto = require('crypto');
const masterArg = process.argv[2];
if (!masterArg) { console.error('Usage: node scripts/derive-content-public-key.js <masterSecret-base64url>'); process.exit(2); }
function decodeBase64Url(str) { let b64 = str.replace(/-/g, '+').replace(/_/g, '/'); while (b64.length % 4 !== 0) b64 += '='; return Buffer.from(b64, 'base64'); }
function hmacSha512(key, data) { return crypto.createHmac('sha512', key).update(data).digest(); }
function deriveKey(master, usage, path) {
  let I = hmacSha512(Buffer.from(usage + ' Master Seed'), master);
  let state = { key: I.subarray(0, 32), chainCode: I.subarray(32) };
  for (const index of path) { I = hmacSha512(state.chainCode, Buffer.concat([Buffer.from([0x00]), Buffer.from(index, 'utf-8')])); state = { key: I.subarray(0, 32), chainCode: I.subarray(32) }; }
  return state.key;
}
(async () => { await sodium.ready; const masterSecret = decodeBase64Url(masterArg); const contentDataKey = deriveKey(masterSecret, 'Happy EnCoder', ['content']); const keypair = sodium.crypto_box_seed_keypair(contentDataKey); console.log(Buffer.from(keypair.publicKey).toString('base64')); })();
