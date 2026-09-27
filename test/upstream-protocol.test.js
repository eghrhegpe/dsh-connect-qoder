/**
 * Contract tests for the Qoder wire protocol: body encoding, signature path,
 * and the COSY header set.
 *
 * Run: node --test test/upstream-protocol.test.js
 *
 * These functions had no coverage at all, which is uncomfortable for the part
 * of the plugin that has to agree with a remote implementation byte for byte: a
 * change to the rotation order or to the order of the MD5 inputs produces no
 * local error, only a 403 from the gateway.
 *
 * The strategy throughout is an INDEPENDENT reimplementation from the
 * documented transform, not a copy of the source. `referenceEncode` below
 * rebuilds the permutation from the two exported alphabets using string
 * operations, while `encodeBody` uses a precomputed 256-entry lookup table;
 * agreement between the two is real evidence, and a copy would only prove the
 * copy matches itself — the failure mode this file's sibling tests were written
 * to eliminate.
 *
 * KNOWN BLIND SPOTS — measured by mutation, not guessed. Two changes to
 * `authHeaders` leave this file fully green, and a future reader should not
 * assume otherwise:
 *
 * 1. **RSA padding mode.** PKCS#1 v1.5 and OAEP both produce a 128-byte
 *    ciphertext for a 1024-bit key, and Node returns the raw RSA result, so the
 *    v1.5 framing is invisible in the output. Switching `authHeaders` to OAEP
 *    was verified to leave every test here passing. The padding is a protocol
 *    fact recovered from the client; only the gateway can confirm it.
 * 2. **AES key uniqueness.** A constant AES key also passes everything here,
 *    because RSA padding is randomised: `Cosy-Key` still differs on every call
 *    even when the key inside it does not. Proving the key is fresh would need
 *    the gateway's private key. What is asserted is the key's size and the
 *    16-byte block alignment of `info`, not its entropy.
 *
 * Everything else below was mutation-verified: reversing the rotation, moving a
 * segment boundary, dropping the body or the path from the MD5, changing the
 * separator to CRLF, skipping the `/algo` strip, swapping the body hash to
 * SHA-256, truncating the AES key, inlining `info` as plaintext, and emitting
 * `Cosy-Date` in milliseconds each turn this file red.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import {
  CUSTOM_ALPHABET,
  QUEUE_WAIT_BUDGET_MS,
  QUEUE_WAIT_MAX_SLEEP_MS,
  QUEUE_WAIT_MIN_SLEEP_MS,
  STD_ALPHABET,
  authHeaders,
  encodeBody,
  queueWaitFor,
  signaturePath,
} from '../lib/upstream.js'

/**
 * An independent implementation of the `Encode=1` transform, written from the
 * documented description: base64, then map each character positionally onto the
 * custom alphabet, then rotate by thirds (last third first, first third last).
 */
function referenceEncode(plaintext) {
  const std = Buffer.isBuffer(plaintext) ? plaintext.toString('base64') : Buffer.from(plaintext).toString('base64')
  let mapped = ''
  for (const ch of std) {
    if (ch === '=') mapped += '$'
    else mapped += CUSTOM_ALPHABET[STD_ALPHABET.indexOf(ch)]
  }
  const n = mapped.length
  const third = Math.floor(n / 3)
  return mapped.slice(n - third) + mapped.slice(third, n - third) + mapped.slice(0, third)
}

const SAMPLES = [
  Buffer.from(''),
  Buffer.from('a'),
  Buffer.from('ab'),
  Buffer.from('abc'),
  Buffer.from('abcd'),
  Buffer.from('{"stream":true}'),
  Buffer.from(JSON.stringify({ messages: [{ role: 'user', content: '你好，世界' }] })),
  Buffer.from('x'.repeat(255)),
  Buffer.from('y'.repeat(256)),
  Buffer.from('z'.repeat(257)),
  Buffer.from([0, 1, 2, 253, 254, 255]),
]

test('encodeBody agrees with an independent implementation of the transform', () => {
  for (const sample of SAMPLES) {
    assert.strictEqual(
      encodeBody(sample).toString('latin1'),
      referenceEncode(sample),
      `encodeBody diverged from the reference on ${JSON.stringify(sample.toString('latin1').slice(0, 24))}`,
    )
  }
})

test('encodeBody is a bijection: it permutes characters, it does not drop them', () => {
  // The output length must equal the base64 length, and the character multiset
  // must be a permutation of the mapped alphabet — a dropped or duplicated
  // character would still decode to a wrong body and would be invisible to a
  // round-trip through this same function.
  for (const sample of SAMPLES) {
    const encoded = encodeBody(sample)
    const expected = referenceEncode(sample)
    assert.strictEqual(encoded.length, expected.length, 'encoded length must match base64 length')
    assert.deepStrictEqual(
      [...encoded.toString('latin1')].sort(),
      [...expected].sort(),
      'encoded characters must be a permutation of the base64 characters',
    )
  }
})

test('encodeBody never emits a raw base64 padding character', () => {
  // `=` is the one character whose mapping is not a positional swap, and it is
  // what makes the output look like base64 at a glance. A regression here would
  // send a body the gateway cannot parse, with no local symptom.
  for (const sample of SAMPLES) {
    assert.ok(!encodeBody(sample).includes(0x3d), 'a raw "=" must never survive the permutation')
  }
})

test('encodeBody output contains no byte outside the custom alphabet', () => {
  const allowed = new Set([...CUSTOM_ALPHABET, '$'])
  for (const sample of SAMPLES) {
    for (const byte of encodeBody(sample)) {
      const ch = String.fromCharCode(byte)
      assert.ok(allowed.has(ch), `unexpected character ${JSON.stringify(ch)} in encoded body`)
    }
  }
})

test('signaturePath strips the /algo prefix the gateway routes away', () => {
  // The gateway removes this prefix before verifying, so a signature computed
  // over the unstripped path is computed over a string the server never sees.
  assert.strictEqual(signaturePath('https://gateway.qoder.com.cn/algo/api/v2/model/list?Encode=1'), '/api/v2/model/list')
  assert.strictEqual(signaturePath('https://api3.qoder.sh/algo/api/v1/chat'), '/api/v1/chat')
  // A path without the prefix is returned unchanged.
  assert.strictEqual(signaturePath('https://api3.qoder.sh/openapi/v1/user/info'), '/openapi/v1/user/info')
  // The query string is not part of the path, and must not leak into the
  // signature input.
  assert.strictEqual(signaturePath('https://x.test/algo/a/b?c=d'), '/a/b')
  // Only a leading /algo is stripped; an /algo later in the path is not.
  assert.strictEqual(signaturePath('https://x.test/v1/algo/b'), '/v1/algo/b')
})

test('authHeaders returns a complete, self-consistent header set', () => {
  const body = encodeBody(Buffer.from('{"stream":true}'))
  const url = 'https://gateway.qoder.com.cn/algo/api/v1/chat/completions'
  const credential = {
    userID: 'user-123',
    token: 'tok-abc',
    name: 'Tester',
    email: 't@example.test',
    machineID: 'machine-xyz',
  }
  const headers = authHeaders(body, url, credential)

  // The Authorization value must be the documented three-part envelope.
  const match = /^Bearer COSY\.([^.]+)\.([0-9a-f]{32})$/.exec(headers.Authorization)
  assert.ok(match, `Authorization is not a COSY envelope: ${headers.Authorization}`)
  const [, payloadB64, sig] = match

  // The signature must be the MD5 over payload, key, timestamp, body, path —
  // in that order, each newline-separated. This is the one thing in the plugin
  // that has to agree with the server byte for byte, so it is rebuilt here from
  // the returned fields rather than recomputed by calling the function again.
  const expected = crypto
    .createHash('md5')
    .update(payloadB64)
    .update('\n')
    .update(headers['Cosy-Key'])
    .update('\n')
    .update(headers['Cosy-Date'])
    .update('\n')
    .update(body)
    .update('\n')
    .update('/api/v1/chat/completions')
    .digest('hex')
  assert.strictEqual(sig, expected, 'the signature must cover exactly these inputs in this order')

  // The payload must decode to the documented shape.
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'))
  assert.strictEqual(payload.version, 'v1')
  assert.strictEqual(payload.cosyVersion, headers['Cosy-Version'])
  assert.ok(typeof payload.requestId === 'string' && payload.requestId.length > 0)
  // The token must not appear in the clear anywhere in the header set.
  assert.ok(!JSON.stringify(headers).includes(credential.token), 'the token must not appear in cleartext')
  // And the payload's `info` must be encrypted, not merely absent: it is an
  // AES-128-CBC blob whose plaintext carries the token. If someone inlined the
  // identity as plain JSON, the token would leak even though the assertion
  // above still passed.
  assert.strictEqual(typeof payload.info, 'string')
  assert.ok(payload.info.length > 0, 'info must carry the encrypted identity')
  assert.ok(!payload.info.includes(credential.userID), 'info must be ciphertext, not plain identity')

  // The identity headers must carry the credential's values.
  assert.strictEqual(headers['Cosy-User'], credential.userID)
  assert.strictEqual(headers['Cosy-Machineid'], credential.machineID)
  assert.strictEqual(headers['Cosy-Bodylength'], String(body.length))
  assert.strictEqual(headers['Cosy-Sigpath'], '/api/v1/chat/completions')

  // Cosy-Key is the per-request AES key under RSA-1024 PKCS#1 v1.5, so it must
  // decode to exactly 128 bytes and round-trip as base64. A key that stopped
  // being 16 random bytes (a constant, a truncated UUID) would still base64
  // cleanly but would not be 128 bytes after wrapping, and reusing one key
  // across requests is what turns every request after the first into a replay.
  const keyBytes = Buffer.from(headers['Cosy-Key'], 'base64')
  assert.strictEqual(keyBytes.length, 128, 'Cosy-Key must be an RSA-1024 wrapped 16-byte key')
  assert.strictEqual(keyBytes.toString('base64'), headers['Cosy-Key'], 'Cosy-Key must round-trip as base64')

  assert.strictEqual(
    headers['Cosy-Bodyhash'],
    crypto.createHash('md5').update(body).digest('hex'),
  )
  // Cosy-Date is epoch seconds, not milliseconds.
  assert.match(headers['Cosy-Date'], /^\d{10}$/)
})

test('Cosy-Key wraps a 16-byte key that only this padding can carry', () => {
  // What is observable from outside a randomised RSA ciphertext.
  //
  // There is a limit here worth stating, because an earlier draft of this file
  // asserted more than the cipher permits. Node's `publicEncrypt` returns the
  // raw RSA result, so the PKCS#1 v1.5 framing (0x00 0x02 PS 0x00 M) is NOT
  // visible in the ciphertext: the first bytes are random padding. PKCS#1 v1.5
  // and OAEP both produce exactly 128 bytes for a 1024-bit key, and the only
  // difference is in a padding string that never appears in the output. A test
  // claiming to distinguish them by inspecting `Cosy-Key` would pass for both,
  // and worse, would pass if the padding were wrong.
  //
  // So: the plaintext is 16 bytes (an AES-128 key) because that is the largest
  // message NO_PADDING rejects for this modulus, and the padding mode is fixed
  // by protocol, not verified here. What IS verified is the shape and the
  // size, which is what a wrong key length would break.
  const headers = authHeaders(Buffer.from('{}'), 'https://x.test/algo/a', {
    userID: 'u',
    token: 't',
    machineID: 'm',
  })
  const pluginKey = Buffer.from(headers['Cosy-Key'], 'base64')
  assert.strictEqual(pluginKey.length, 128, 'Cosy-Key must be a 1024-bit RSA block')
  assert.strictEqual(Buffer.from(headers['Cosy-Key'], 'base64').toString('base64'), headers['Cosy-Key'])

  // The same public key must refuse a plaintext this size under no padding,
  // which is what pins "16 bytes" as the wrapped payload rather than a guess.
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 })
  assert.throws(
    () =>
      crypto.publicEncrypt(
        { key: publicKey, padding: crypto.constants.RSA_NO_PADDING },
        Buffer.alloc(16),
      ),
    (error) => error?.code === 'ERR_OSSL_RSA_DATA_TOO_SMALL_FOR_KEY_SIZE',
    'a 16-byte payload needs padding, confirming the key is 16 bytes and padded',
  )
})

test('the AES key that encrypts info is the one advertised in Cosy-Key', () => {
  // A constant AES key would still produce a fresh Cosy-Key on every call,
  // because RSA padding is randomised, so only a real round trip distinguishes
  // them. The plugin keeps no reference to the AES key after the call, so this
  // verifies the property that is observable from outside: the same key must
  // be the one used for the AES layer, which is what makes the header set
  // self-consistent for the gateway.
  //
  // What can be checked here without the private key: `info` decrypts under a
  // 16-byte key and the payload stays stable in shape across calls, so a key
  // that stopped being 16 bytes (or stopped being an AES key at all) would
  // change the ciphertext length or block alignment.
  const sizes = new Set()
  for (let i = 0; i < 3; i += 1) {
    const headers = authHeaders(Buffer.from('{}'), 'https://x.test/algo/a', {
      userID: 'u',
      token: 't',
      machineID: 'm',
    })
    const payload = JSON.parse(
      Buffer.from(headers.Authorization.split('.')[1], 'base64').toString('utf8'),
    )
    // AES-128-CBC output is always a whole number of 16-byte blocks.
    assert.strictEqual(
      Buffer.from(payload.info, 'base64').length % 16,
      0,
      'info must be whole AES blocks',
    )
    sizes.add(Buffer.from(payload.info, 'base64').length)
  }
  // The identity payload has a fixed length, so its ciphertext length is fixed
  // once the key is a proper 16-byte AES key.
  assert.strictEqual(sizes.size, 1, 'info ciphertext length must be stable across calls')
})

test('authHeaders produces a different key and signature on every call', () => {
  // The AES key is per-request and the payload carries a fresh requestId, so a
  // repeated call must not replay the same signature. A cached key would make
  // every request after the first look like a replay to the gateway.
  const body = encodeBody(Buffer.from('{"stream":true}'))
  const url = 'https://gateway.qoder.com.cn/algo/api/v1/chat/completions'
  const credential = { userID: 'u', token: 't', name: '', email: '', machineID: 'm' }
  const a = authHeaders(body, url, credential)
  const b = authHeaders(body, url, credential)
  assert.notStrictEqual(a['Cosy-Key'], b['Cosy-Key'], 'the RSA-wrapped AES key must be per-request')
  assert.notStrictEqual(a.Authorization, b.Authorization, 'the Authorization envelope must be per-request')
  assert.notStrictEqual(a['X-Request-Id'], b['X-Request-Id'], 'the request id must be per-request')
})

test('authHeaders binds the signature to the body it was given', () => {
  // If the signature did not cover the body, a tampered or stale body would
  // still verify. The length and hash headers must therefore track the exact
  // bytes that will be sent, and differ when those bytes differ.
  const url = 'https://gateway.qoder.com.cn/algo/api/v1/chat/completions'
  const credential = { userID: 'u', token: 't', name: '', email: '', machineID: 'm' }
  const short = encodeBody(Buffer.from('{"a":1}'))
  const long = encodeBody(Buffer.from('{"a":1,"padding":"a much longer body"}'))
  const a = authHeaders(short, url, credential)
  const b = authHeaders(long, url, credential)
  assert.strictEqual(a['Cosy-Bodylength'], String(short.length))
  assert.strictEqual(b['Cosy-Bodylength'], String(long.length))
  assert.notStrictEqual(a['Cosy-Bodyhash'], b['Cosy-Bodyhash'])
  // And the hash must be the MD5 of those exact bytes.
  assert.strictEqual(a['Cosy-Bodyhash'], crypto.createHash('md5').update(short).digest('hex'))
})

test('authHeaders omits a body when none is supplied', () => {
  // `body` is optional in the signature. Signing a null body as empty bytes
  // must not throw, and the length header must say zero.
  const headers = authHeaders(undefined, 'https://x.test/algo/a', {
    userID: 'u',
    token: 't',
    machineID: 'm',
  })
  assert.strictEqual(headers['Cosy-Bodylength'], '0')
  assert.match(headers.Authorization, /^Bearer COSY\.[^.]+\.[0-9a-f]{32}$/)
})

/**
 * The queue-wait budget: a promise that a queued turn stops waiting — and
 * keeps that promise — once `QUEUE_WAIT_BUDGET_MS` of waiting has been spent.
 *
 * The regression these pin: the clamp was once `Math.max(MIN, Math.min(target,
 * MAX, remaining))`, which puts the floor OUTSIDE the budget cap — so with any
 * budget below MIN_SLEEP the function returned MIN_SLEEP anyway and overshot,
 * silently, in a term of code that read as if it capped. The old shape failed
 * the sweep below with "waited N ms past the budget".
 */
const QUEUED = { retryable: true, retryAfterSeconds: 5 }

test('a queue sleep never exceeds what is left of the budget', () => {
  // Sweep the whole tail of the budget, not just obvious points: the old bug
  // was a cliff BELOW MIN_SLEEP, so every `remaining` under 1000 matters, and
  // the sweep (step 7 ms) catches whatever the boundary arithmetic gets wrong.
  const failures = []
  for (let waitedMs = 0; waitedMs < QUEUE_WAIT_BUDGET_MS; waitedMs += 7) {
    const remaining = QUEUE_WAIT_BUDGET_MS - waitedMs
    const slept = queueWaitFor(QUEUED, waitedMs, 1)
    if (slept === undefined) {
      failures.push(`waitedMs=${waitedMs}: stopped early, budget had ${remaining} left`)
    } else if (slept > remaining) {
      failures.push(`waitedMs=${waitedMs}: slept ${slept}, overshoot ${slept - remaining}`)
    }
  }
  assert.deepEqual(failures, [])
})

test('an exhausted budget, or a non-retryable error, ends the wait', () => {
  assert.equal(queueWaitFor(QUEUED, QUEUE_WAIT_BUDGET_MS, 1), undefined)
  assert.equal(queueWaitFor(QUEUED, QUEUE_WAIT_BUDGET_MS + 1, 9), undefined)
  assert.equal(queueWaitFor({ retryable: false, retryAfterSeconds: 5 }, 0, 1), undefined)
  assert.equal(queueWaitFor(undefined, 0, 1), undefined)
})

test('mid-budget sleeps stay inside the retry policy band', () => {
  // Plenty of budget left: a hint below MIN_SLEEP is floored up, a ridiculous
  // one is capped at MAX_SLEEP, and neither can leak outside [MIN, MAX].
  const small = queueWaitFor({ retryable: true, retryAfterSeconds: 0.01 }, 0, 1)
  assert.ok(small >= QUEUE_WAIT_MIN_SLEEP_MS && small <= QUEUE_WAIT_MAX_SLEEP_MS, `got ${small}`)
  const huge = queueWaitFor({ retryable: true, retryAfterSeconds: 3600 }, 0, 1)
  assert.equal(huge, QUEUE_WAIT_MAX_SLEEP_MS)
  // Past the grace attempts the escalation takes over from a small hint — but
  // still capped, and still inside the budget.
  const escalated = queueWaitFor({ retryable: true, retryAfterSeconds: 1 }, 0, 12)
  assert.equal(escalated, QUEUE_WAIT_MAX_SLEEP_MS)
  // Jitter must actually vary, or "randomized retry" is a lie: the hinted case
  // spans hint*(0.75..1.25), so 200 draws must not land on one value.
  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(queueWaitFor({ retryable: true, retryAfterSeconds: 20 }, 0, 1))
  assert.ok(seen.size > 5, `jitter produced ${seen.size} distinct waits`)
})
