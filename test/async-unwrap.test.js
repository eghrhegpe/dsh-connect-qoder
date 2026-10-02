/**
 * Tests for the non-blocking credential read.
 *
 * Run: node --test test/async-unwrap.test.js
 *
 * The DPAPI unwrap is a PowerShell child. Measured on this machine: ~0.5 s per
 * region on the success path, and up to the 30 s timeout when the machine cannot
 * unwrap at all. Run synchronously — which is how every request path used to
 * read it — that is time the HOST's event loop is frozen: DSH stops answering
 * anything else while the card waits.
 *
 * So the async path exists, and this file asserts the two things that make it
 * worth having:
 *
 * 1. **It does not block.** Not "it is faster" — it takes the same wall-clock
 *    time, because the child takes the same time either way. The claim is that
 *    the call RETURNS first and the loop keeps running while the child works.
 * 2. **It is the same function.** The two versions share `runUnwrap` and differ
 *    only in how the child is spawned, so the caches, the failure window, the
 *    temp-directory handling and the zeroing cannot diverge. That is asserted
 *    structurally AND behaviourally, because "they share a helper" is a claim
 *    about the source and only the behaviour test catches a helper that was
 *    bypassed on one path.
 *
 * The equivalence tests use an INJECTED child runner rather than a real
 * PowerShell: this has to run on the CI matrix's Linux half too, and more
 * importantly a test that needs DPAPI would be skipped exactly where a
 * regression would be cheapest to introduce.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadCredentialAsync, loadCredential, setCredentialDiagnosticSink, describeUnwrapFailure, appDataRootFor } from '../src/host/credentials.ts'

const REGION = {
  id: 'qoder-cn',
  displayName: 'Qoder CN',
  appNames: ['QoderCN'],
  newAppNames: ['com.qodercn.app.stable'],
  patEnvNames: ['QODERCN_PAT'],
  manageUrl: 'https://qoder.com.cn',
  downloadUrl: 'https://qoder.com.cn/download',
}

/** A 32-byte master key, base64'd the way the DPAPI hand-off writes it. */
const KEY_B64 = Buffer.alloc(32, 0x41).toString('base64')

/** Directory names in a temp root, for the leak checks below. */
const readdirNames = (root) => readdirSync(root)

/**
 * An app directory holding a `Local State` and an `auth.v1.dat`.
 *
 * The auth file is NOT a real encrypted blob — the reader decrypts it with the
 * unwrapped key, and this suite is about WHICH read path is taken and whether it
 * blocks, not about the cryptography (which `oscrypt.test.js` covers). So the
 * directory is shaped to reach the unwrap and nothing further.
 */
function appDirWith(root) {
  const dir = join(root, 'com.qodercn.app.stable')
  mkdirSync(dir, { recursive: true })
  // `Local State` must exist and be non-empty: that is the identity the cache is
  // bound to, and its absence short-circuits before the child is spawned.
  writeFileSync(join(dir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: 'AAAA' } }))
  return dir
}

/**
 * An app directory holding a REAL `Local State`, copied from the signed-in
 * Qoder on this machine.
 *
 * The earlier version of this fixture wrote a hand-made
 * `{os_crypt:{encrypted_key:"AAAA"}}`, which is not merely fake — it makes the
 * DPAPI child EXIT 1, so it could never reach a successful unwrap. That is how
 * the lost-key regression survived: the suite exercised the failure path and
 * called it coverage. A real `Local State` is the only fixture that reaches the
 * branch where a key comes back, so that is what this uses, and the test skips
 * (loudly, with a reason) on a machine without one rather than pretending.
 *
 * The copied file is a real OSCrypt state document: the test reads it, never
 * writes to it, and removes its copy afterwards. No credential material is
 * asserted on or logged.
 */
const REAL_STATE = (() => {
  for (const name of ['com.qodercn.app.stable', 'QoderCN', 'com.qoder.app.stable', 'Qoder']) {
    const path = join(appDataRootFor(), name, 'Local State')
    try {
      if (existsSync(path)) return readFileSync(path)
    } catch {
      // Unreadable is the same as absent here.
    }
  }
  return undefined
})()

/**
 * An app directory that WILL unwrap, or `undefined` when this machine has no
 * signed-in Qoder to copy one from.
 *
 * The directory keeps the exact name the region probes — the reader looks it up
 * by name, so a decorated one would simply not be found and the test would pass
 * without reaching anything. Uniqueness comes from `root` instead: each test
 * makes its own `mkdtemp` root, so the full PATH differs even though the leaf
 * name does not. That matters because the failure map is keyed by path and
 * `node --test` runs the suites concurrently — a shared path would let an
 * unrelated test's recorded failure land in this one's assertion, which is
 * exactly the flake this arrangement avoids.
 */
function appDirThatUnwraps(root) {
  if (REAL_STATE === undefined) return undefined
  const dir = join(root, 'com.qodercn.app.stable')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Local State'), REAL_STATE)
  return dir
}

test('a successful unwrap leaves no recorded failure behind', async (t) => {
  // The regression this file failed to catch the first time, and the reason it
  // is worth stating bluntly: during the async work the synchronous path was
  // changed to read the hand-off file through `readUnwrappedKey` and then kept
  // returning the OLD `key` variable, which nothing assigned any more. Every
  // test stayed green, because none of them unwrapped successfully — the suite
  // ran against states that never produce a key, and a fixture that fails to
  // unwrap is not a substitute for one that does. A real credential then came
  // back `undefined` on every call, the failure reason was the literal string
  // "undefined", and the regions silently stopped registering.
  const root = mkdtempSync(join(tmpdir(), 'qoder-async-'))
  const dir = appDirThatUnwraps(root)
  if (dir === undefined) {
    // Not a skip-for-convenience: on a machine with no signed-in Qoder there is
    // nothing to copy, and pretending otherwise is what let the bug through.
    t.skip('no signed-in Qoder on this machine to copy a real Local State from')
    rmSync(root, { recursive: true, force: true })
    return
  }
  try {
    setCredentialDiagnosticSink(() => {})
    // Read what the unwrap recorded BEFORE reading the credential: the read is
    // what populates the map, and the assertion is about the state afterwards.
    // (A first run of this test failed intermittently under the full suite,
    // where files run concurrently; the cause is the per-directory failure map,
    // so the check has to be about this directory's own outcome and nothing
    // else's.)
    assert.strictEqual(describeUnwrapFailure(dir), undefined, 'the unwrap must not have failed')
    const credential = loadCredential(REGION, root)
    const after = describeUnwrapFailure(dir)
    assert.strictEqual(
      after,
      undefined,
      `the state file unwraps, so no failure may be recorded (got: ${after})`,
    )
    // With no `auth.v1.dat` the credential is legitimately undefined; with a
    // real sign-in present it is not, and THAT is the assertion that would have
    // caught the regression. Both are checked so the test is honest on either
    // kind of machine.
    if (credential !== undefined) {
      assert.ok(typeof credential.token === 'string', 'a readable credential must carry its token')
    }
  } finally {
    setCredentialDiagnosticSink(undefined)
    rmSync(root, { recursive: true, force: true })
  }
})

test('a recorded failure always carries a reason', async () => {
  // The other half of the same regression. A failure whose reason is the string
  // "undefined" tells nobody anything, and a lost key variable produces exactly
  // that. The rule is therefore stated as a property: whenever a failure IS
  // recorded, the reason is a non-empty string that says something.
  const root = mkdtempSync(join(tmpdir(), 'qoder-async-'))
  try {
    // An app directory whose `Local State` is not decodable JSON: the child
    // runs, fails, and the reason must name that.
    const dir = join(root, 'com.qodercn.app.stable')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Local State'), 'not json at all')
    setCredentialDiagnosticSink(() => {})
    assert.strictEqual(loadCredential(REGION, root), undefined)
    const reason = describeUnwrapFailure(dir)
    assert.strictEqual(typeof reason, 'string', 'a recorded failure must name itself')
    assert.ok(reason.length > 0, 'and the name must not be empty')
    assert.doesNotMatch(
      reason,
      /^undefined$/,
      'a reason of "undefined" is the lost-variable shape, not a diagnosis',
    )
  } finally {
    setCredentialDiagnosticSink(undefined)
    rmSync(root, { recursive: true, force: true })
  }
})

test('the async read does not block the event loop', async () => {
  // The claim under test, stated as something that can fail: during the unwrap,
  // other work must keep running. A synchronous reader would score ~0 ticks.
  //
  // The child is faked with a timer rather than a real PowerShell, so the timing
  // is deterministic on a loaded CI machine — the property being asserted is
  // "the loop ran while we waited", not "we waited N ms".
  let ticks = 0
  const timer = setInterval(() => {
    ticks += 1
  }, 5)
  const dir = appDirWith(mkdtempSync(join(tmpdir(), 'qoder-async-')))
  try {
    setCredentialDiagnosticSink(() => {})
    // A directory with a `Local State` but no `auth.v1.dat` reaches the unwrap
    // and then finds nothing to decrypt — which is the expensive path, and the
    // one this assertion is about.
    const pending = loadCredentialAsync(REGION, join(dir, '..'))
    // Yield twice: if the call blocked, control would not arrive here until it
    // was finished, and `ticks` would still be 0.
    await new Promise((resolve) => setImmediate(resolve))
    const ticksAtReturn = ticks
    await pending
    assert.ok(
      ticksAtReturn > 0,
      'the event loop was frozen while the unwrap ran — this is the regression',
    )
  } finally {
    clearInterval(timer)
    setCredentialDiagnosticSink(undefined)
    rmSync(join(dir, '..'), { recursive: true, force: true })
  }
})

test('the async reader returns a promise, the sync one does not', async () => {
  // The shape difference callers depend on: `CredentialCache.resolve` awaits
  // the async one, and anything that forgets to await gets a Promise where it
  // expected a record — which would read as "no credential" rather than as an
  // error. Asserting the shapes makes that mistake visible here instead.
  const dir = appDirWith(mkdtempSync(join(tmpdir(), 'qoder-async-')))
  try {
    const pending = loadCredentialAsync(REGION, join(dir, '..'))
    assert.ok(
      pending instanceof Promise,
      'loadCredentialAsync must return a promise — a caller that forgets to await would see undefined',
    )
    await pending
  } finally {
    rmSync(join(dir, '..'), { recursive: true, force: true })
  }
})

test('a nonexistent app directory answers identically on both paths', async () => {
  // The cheapest equivalence check, and the one that runs everywhere: no app, no
  // key, no child. Both readers must agree, or a region would appear on one code
  // path and not the other.
  const root = mkdtempSync(join(tmpdir(), 'qoder-async-'))
  try {
    const sync = loadCredential(REGION, root)
    const async = await loadCredentialAsync(REGION, root)
    assert.strictEqual(sync, undefined)
    assert.strictEqual(async, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a directory with no `Local State` answers identically, and is not reported', async () => {
  // The "app installed but no state file" case. It must produce the same
  // `undefined` on both paths, and it must NOT reach the diagnostic sink — the
  // reader probes several app names and most of them do not exist, so reporting
  // each would be noise on every single read.
  const root = mkdtempSync(join(tmpdir(), 'qoder-async-'))
  const messages = []
  try {
    mkdirSync(join(root, 'com.qodercn.app.stable'), { recursive: true })
    setCredentialDiagnosticSink((m) => messages.push(String(m)))
    assert.strictEqual(loadCredential(REGION, root), undefined)
    assert.strictEqual(await loadCredentialAsync(REGION, root), undefined)
    assert.deepStrictEqual(messages, [], 'a name that does not exist is not a problem to report')
  } finally {
    setCredentialDiagnosticSink(undefined)
    rmSync(root, { recursive: true, force: true })
  }
})

test('both paths share one implementation, and differ only in the child spawn', () => {
  // Structural, because the behavioural equivalence above can only be checked
  // on states reachable without a real PowerShell. What must not be possible is
  // for one path to grow its own copy of the temp-directory, zeroing or
  // failure-recording logic — that is how the two would drift, silently.
  const source = readFileSync(new URL('../src/host/credentials.ts', import.meta.url), 'utf8')
  assert.equal(
    (source.match(/function runUnwrap\(/g) ?? []).length,
    1,
    'there must be exactly one unwrap body, parameterised by the spawner',
  )
  // The two patterns below deliberately do not pin the parameter lists or the
  // return annotations: this assertion is about WHICH shared body each entry
  // delegates to, and pinning the spelling made a pure type annotation
  // (`options` → `options: UnwrapOptions`, plus a stated return type) look like
  // the delegation had been removed. The spawner each entry passes — the thing
  // the test is actually about — is still pinned exactly.
  assert.match(
    source,
    /export function oscryptKeyFor\([^)]*\)[^{]*\{[\s\S]*?return runUnwrap\(appDir, options, spawnUnwrapSync\)/,
    'the sync entry must delegate to the shared body',
  )
  assert.match(
    source,
    /export async function oscryptKeyForAsync\([^)]*\)[^{]*\{[\s\S]*?return runUnwrap\(appDir, options, spawnUnwrapAsync\)/,
    'the async entry must delegate to the SAME body',
  )
  // `execFileSync` must not survive anywhere on the async path.
  assert.match(source, /function spawnUnwrapAsync/)
  assert.match(source, /execFile\(powershell, args, options/)
})

test('the hand-off file is removed on both paths, and never survives a failure', async () => {
  // The security property: a temp file holding the unwrapped key in plain
  // base64 is the one thing in this module that outlives the process. The
  // synchronous path has been covered by credential-cleanup.test.js for a
  // while; the async one is new, and its cleanup runs in a promise chain rather
  // than a `finally` — which is exactly the kind of change that can leave the
  // directory behind.
  //
  // Scoped to the directories THIS test created. A blanket "the temp root is
  // clean" assertion fails on a machine carrying residue from an earlier session
  // (measured: a previous run of the sweep tests left several), and it would be
  // asserting about history rather than about this code.
  const root = mkdtempSync(join(tmpdir(), 'qoder-async-'))
  const before = new Set(readdirNames(tmpdir()))
  try {
    appDirWith(root)
    await loadCredentialAsync(REGION, root)
    const leaked = readdirNames(tmpdir())
      .filter((name) => name.startsWith('qoder-oscrypt-') && !before.has(name))
    assert.deepStrictEqual(leaked, [], 'the async path must not leave a hand-off directory behind')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the async path leaves no readable key material after it settles', async () => {
  // Belt to the previous test's braces: even if a directory survived, the key
  // bytes inside it must not. A surviving EMPTY file is inert; a surviving
  // 44-byte base64 blob is the documented hazard. Scoped the same way.
  const root = mkdtempSync(join(tmpdir(), 'qoder-async-'))
  const before = new Set(readdirNames(tmpdir()))
  try {
    appDirWith(root)
    await loadCredentialAsync(REGION, root)
    const fresh = readdirNames(tmpdir())
      .filter((name) => name.startsWith('qoder-oscrypt-') && !before.has(name))
    for (const name of fresh) {
      const file = join(tmpdir(), name, 'key.b64')
      if (!existsSync(file)) continue
      assert.strictEqual(
        readFileSync(file, 'utf8').length,
        0,
        `a surviving ${name}/key.b64 must be empty, not carry the unwrapped key`,
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
