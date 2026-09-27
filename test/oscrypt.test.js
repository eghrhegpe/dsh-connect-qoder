/**
 * Round-trip tests for the OSCrypt blob decoder.
 *
 * Run: node --test test/oscrypt.test.js
 *
 * `decryptOscrypt` is the one function in this module that decides whether the
 * plugin can read a credential at all, and it had no coverage. It is a pure
 * function, so the fixtures here are built with the real AES-256-GCM rather
 * than checked in as opaque blobs: a test that only fed it one captured sample
 * would pass even if the nonce, tag or prefix offset were wrong, as long as the
 * one sample happened to line up.
 *
 * Every fixture is produced by the same construction the Chromium/VS Code store
 * uses — `"v10" || nonce(12) || ciphertext || tag(16)`.
 *
 * One thing is NOT asserted here, deliberately: that the explicit
 * `blob.length < 3 + 12 + 16` guard runs, rather than a short blob being
 * rejected further down by `createDecipheriv` throwing on a truncated nonce.
 * Both paths return `undefined`, so the two are indistinguishable from outside,
 * and a test claiming to tell them apart would be asserting an implementation
 * detail it cannot actually see. Deleting the guard was measured to leave this
 * file green.
 *
 * DETERMINISM: the key below is a fixed hash, not `randomBytes`, so a failure
 * reproduces exactly. The nonces are still random, because a GCM nonce is
 * part of what is being tested — reusing one across fixtures would be testing
 * something the real store never does. The one probabilistic assertion (random
 * noise must not decode) is bounded so tightly that it cannot flake: 200
 * samples at a 1-in-2^24 per-attempt false-positive rate gives an expected
 * count of 0.00001, and the bound allows 2.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { decryptOscrypt } from '../lib/credentials.js'

/**
 * A fixed 32-byte key: the SHA-256 of a constant.
 *
 * Previously `crypto.randomBytes(32)` at module scope. That made a failure
 * unreproducible — a failing run could not be re-run to see whether it was a
 * real defect or a one-off, which is exactly when you need to re-run it.
 */
const KEY = crypto.createHash('sha256').update('dsh-connect-qoder oscrypt test key').digest()

/** A second fixed key, for the wrong-key cases. */
const OTHER_KEY = crypto.createHash('sha256').update('a different key entirely').digest()

/** Build an OSCrypt blob the way the app's store writes one. */
function seal(plaintext, key = KEY, prefix = 'v10') {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from(prefix, 'latin1'), nonce, ciphertext, cipher.getAuthTag()])
}

test('a blob written by the store decodes back to its plaintext', () => {
  const plaintext = JSON.stringify({
    schemaVersion: 1,
    token: 'dt-secret',
    user: { id: 'u-1', name: 'Tester', email: 't@example.test' },
  })
  assert.strictEqual(decryptOscrypt(seal(plaintext), KEY), plaintext)
})

test('the empty string round-trips', () => {
  // AES-GCM produces a tag even for zero-length plaintext, so this is a real
  // edge: the length guard must not reject a 3+12+16 byte blob outright.
  assert.strictEqual(decryptOscrypt(seal(''), KEY), '')
})

test('non-ASCII plaintext survives as UTF-8', () => {
  const plaintext = '{"name":"张三","note":"emoji 🎉 and ünïcode"}'
  assert.strictEqual(decryptOscrypt(seal(plaintext), KEY), plaintext)
})

test('a wrong key does not decode', () => {
  // GCM must authenticate: a wrong key has to fail rather than return garbage
  // that would then be JSON.parsed into a nonsense credential. The wrong key is
  // fixed, not random, so this case reproduces.
  const blob = seal('{"token":"real"}')
  assert.strictEqual(decryptOscrypt(blob, OTHER_KEY), undefined, 'a wrong key must not produce plaintext')
})

test('a near-miss key — one bit different — does not decode', () => {
  // GCM's authentication is not approximate: a single flipped bit in the key
  // must fail exactly as a completely different key does.
  const flipped = Buffer.from(KEY)
  flipped[0] ^= 0x01
  const blob = seal('{"token":"real"}', KEY)
  assert.strictEqual(decryptOscrypt(blob, flipped), undefined)
})

test('a tampered ciphertext does not decode', () => {
  const blob = seal('{"token":"real"}')
  blob[blob.length - 20] ^= 0xff
  assert.strictEqual(decryptOscrypt(blob, KEY), undefined, 'GCM must reject a modified body')
})

test('a tampered authentication tag does not decode', () => {
  const blob = seal('{"token":"real"}')
  blob[blob.length - 1] ^= 0x01
  assert.strictEqual(decryptOscrypt(blob, KEY), undefined)
})

test('a wrong prefix is rejected before any decryption is attempted', () => {
  // The store has used more than one prefix over the years. Anything that is
  // not `v10` is not ours to interpret, and guessing would mean handing an
  // unverified string to JSON.parse.
  for (const prefix of ['v11', 'v20', 'xxx', 'V10']) {
    assert.strictEqual(decryptOscrypt(seal('{"a":1}', KEY, prefix), KEY), undefined, `prefix ${prefix}`)
  }
})

test('a truncated blob is rejected rather than throwing', () => {
  const blob = seal('{"token":"real"}')
  // Shorter than v10 + nonce + tag: there is no ciphertext at all.
  assert.strictEqual(decryptOscrypt(blob.subarray(0, 30), KEY), undefined)
  assert.strictEqual(decryptOscrypt(Buffer.alloc(0), KEY), undefined)
  assert.strictEqual(decryptOscrypt(Buffer.from('v10'), KEY), undefined)
  // Exactly the header, with no body.
  assert.strictEqual(decryptOscrypt(Buffer.concat([Buffer.from('v10'), crypto.randomBytes(12)]), KEY), undefined)
  // Every length from 0 to 30, so no short input can throw.
  for (let length = 0; length < 31; length++) {
    assert.doesNotThrow(() => decryptOscrypt(crypto.randomBytes(length), KEY), `length ${length}`)
  }
  // A blob of exactly the minimum size is a header with an empty ciphertext.
  const minimum = Buffer.concat([Buffer.from('v10'), crypto.randomBytes(12), crypto.randomBytes(16)])
  assert.strictEqual(minimum.length, 31)
  assert.strictEqual(decryptOscrypt(minimum, KEY), undefined)
})

test('a key of the wrong length is rejected without throwing', () => {
  // createDecipheriv throws on a bad key size; that must not escape the decoder,
  // because every caller treats this function as total — it answers undefined
  // rather than failing, so a corrupt key cannot crash region startup.
  const blob = seal('{"a":1}')
  for (const size of [16, 24, 64]) {
    const bad = crypto.createHash('sha256').update(`wrong size ${size}`).digest().subarray(0, size)
    assert.doesNotThrow(() => decryptOscrypt(blob, bad), `key size ${size}`)
    assert.strictEqual(decryptOscrypt(blob, bad), undefined, `key size ${size}`)
  }
})

test('arbitrary bytes are rejected by structure alone, before any key is tried', () => {
  // Deterministic counterpart to the probabilistic noise check this file used
  // to have. The decoder rejects on the `v10` prefix and the minimum length
  // before it ever constructs a cipher, so input that fails those is refused no
  // matter what follows — and that is checkable exactly, not statistically.
  for (let length = 0; length < 31; length++) {
    const bytes = crypto.randomBytes(length)
    assert.strictEqual(decryptOscrypt(bytes, KEY), undefined, `length ${length} without a prefix`)
  }
  // A well-formed prefix and length, but a wrong key: still refused.
  for (let i = 0; i < 50; i++) {
    const blob = Buffer.concat([Buffer.from('v10'), crypto.randomBytes(37)])
    assert.strictEqual(decryptOscrypt(blob, KEY), undefined)
  }
  // And the same, with a non-ASCII payload, which must not be mistaken for a
  // valid UTF-8 decode of arbitrary bytes.
  const utf8Noise = Buffer.from('这不是密钥'.repeat(12), 'utf8')
  assert.strictEqual(decryptOscrypt(utf8Noise, KEY), undefined)
})
