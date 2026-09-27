/**
 * Tests for the credential temp-file cleanup.
 *
 * Run: node --test test/credential-cleanup.test.js
 *
 * The unwrap hands the app's 32-byte master key to JavaScript through a
 * `%TEMP%` file, and that file is the one place in this plugin where a secret
 * exists outside the process. Its removal is a security property, not
 * housekeeping — the README promises the plugin "stores no credentials", and a
 * leftover `key.b64` breaks that promise for every same-user process on the box
 * until something reclaims it.
 *
 * The failure this file guards was a silent one. When the PowerShell child is
 * killed by the unwrap timeout, its exclusive (`FileShare.None`) handle on
 * `key.b64` is closed by the kernel asynchronously — a killed process runs no
 * `finally` — and until that teardown finishes, `zeroOutFile` fails its open
 * and `rmSync` fails too. `zeroOutFile` used to swallow every error, so the key
 * sat in TEMP as plain base64 with no report, and the next reclaim was a plugin
 * start away (the entry sweeps once at activation, not on a timer). The fix is
 * a short retry that waits out the teardown, and a report when the hazard
 * survives anyway. This file asserts both.
 *
 * PLATFORM: the hand-off only exists on Windows (DPAPI), so the locked-file
 * assertions are gated to `win32`; the reclaim and age-guard behaviour is
 * asserted everywhere. The lock is taken by a real PowerShell child, not by a
 * second Node handle — libuv opens files with `FILE_SHARE_READ|WRITE|DELETE`,
 * so a Node-side "lock" blocks nothing and the branch under test never runs.
 * (An earlier revision of this file made exactly that mistake; and an earlier
 * probe compared a file the holder never touched and drew the opposite
 * conclusion. Both are recorded here so neither is re-derived by feel.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sweepStaleOscryptDirs, setCredentialDiagnosticSink } from '../lib/credentials.js'

/** A fixed, obviously-fake 32-byte key body, base64'd — the sweep's content
 *  check demands exactly a master key's size, so a wrong-length body would be
 *  skipped as foreign rather than reclaimed. */
const KEY_BODY = Buffer.alloc(32, 0x41).toString('base64')
/** The identity marker the production unwrap writes; the sweep only reclaims
 *  directories carrying it, so every "ours" fixture must too. */
const MARKER = '.dsh-oscrypt'

/** Older than any sweep guard used here, so the sweep treats it as orphaned. */
const STALE_MS = 10 * 60 * 1000

/**
 * A scratch `qoder-oscrypt-*` directory holding an aged key file.
 *
 * Named to match the prefix the sweep looks for AND carries the identity
 * marker the production unwrap writes, so the sweep is exercised against the
 * real shape of our own residue rather than a directory it must now refuse to
 * touch. The directory is aged AFTER the files are written: writing them
 * touches the parent's mtime, and the sweep's guard is the directory's own
 * clock. Pass `marker: false` to build the foreign-look-alike case.
 */
function makeKeyDir(ageMs = STALE_MS, { marker = true, body = KEY_BODY, files } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qoder-oscrypt-'))
  const file = join(dir, 'key.b64')
  writeFileSync(file, body, 'utf8')
  if (marker) writeFileSync(join(dir, MARKER), '')
  for (const [name, content] of Object.entries(files ?? {})) writeFileSync(join(dir, name), content)
  const old = new Date(Date.now() - ageMs)
  utimesSync(dir, old, old)
  return { dir, file }
}

/** Capture what the module reports, for the duration of one test. */
function captureDiagnostics() {
  const messages = []
  setCredentialDiagnosticSink((message) => messages.push(String(message)))
  return messages
}

test('a stale key directory is reclaimed', () => {
  const { dir, file } = makeKeyDir()
  const messages = captureDiagnostics()
  try {
    const reclaimed = sweepStaleOscryptDirs(0)
    assert.ok(reclaimed >= 1, 'the aged directory must be reclaimed')
    assert.equal(existsSync(file), false, 'the key file must not survive the sweep')
    assert.deepEqual(messages, [], 'an ordinary reclaim is not a problem to report')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    setCredentialDiagnosticSink(undefined)
  }
})

test('a fresh directory is left alone, because another instance may be using it', () => {
  // The sweep's age guard is what makes it safe to call while a concurrent DSH
  // is unwrapping. Removing it would let one process delete a key file out from
  // under another that is still reading it.
  const { dir, file } = makeKeyDir(0)
  const messages = captureDiagnostics()
  try {
    const reclaimed = sweepStaleOscryptDirs(5 * 60 * 1000)
    assert.equal(reclaimed, 0, 'a directory younger than the guard must not be touched')
    assert.deepEqual(messages, [], 'and it must not be reported as a problem')
    assert.equal(readFileSync(file, 'utf8'), KEY_BODY, 'its key file must still be intact')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    setCredentialDiagnosticSink(undefined)
  }
})

/**
 * Spawn PowerShell to hold `file` with FileShare.None — exactly the shape of
 * the handle a mid-teardown killed child still has open. Resolves only after
 * the holder confirms it owns the handle, so no assertion below can run
 * against an unlocked file.
 */
function lockViaPowerShell(file, holdMs = 5000) {
  const child = spawn(
    join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "$h=[System.IO.File]::Open($env:QODER_LOCK_FILE,'Open','ReadWrite','None');" +
        "[Console]::Out.WriteLine('holder: opened');[Console]::Out.Flush();" +
        `Start-Sleep -Milliseconds ${holdMs};$h.Dispose()`,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, QODER_LOCK_FILE: file },
    },
  )
  const ready = new Promise((resolve, reject) => {
    let text = ''
    const timer = setTimeout(
      () => reject(new Error(`PowerShell never reported the handle held; output: ${text}`)),
      20000,
    )
    child.stdout.on('data', (data) => {
      text += data.toString()
      if (text.includes('holder: opened')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  return {
    async stop() {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    },
    ready,
  }
}

test(
  'a key file locked by the killed child is reported, and a sibling is still reclaimed',
  { skip: process.platform === 'win32' ? false : 'the DPAPI hand-off exists only on Windows' },
  async () => {
  // Two aged directories, and a REAL exclusive lock on the first one's file —
  // this asserts both halves of the fix at once:
  //
  //   1. the locked file produces a report (`could not zero` / `could not
  //      reclaim`) naming what survived — the regression, invisible before the
  //      fix because every cleanup error was swallowed;
  //   2. the sweep does not abort on it — the unlocked sibling must still be
  //      reclaimed, since the sweep's whole job is to clear EVERY orphan out
  //      of TEMP, not just the first one it reaches.
  const locked = makeKeyDir()
  const sibling = makeKeyDir()
  const messages = captureDiagnostics()
  const holder = lockViaPowerShell(locked.file)
  try {
    await holder.ready
    // Prove the lock is live by hitting it, not by reading through it:
    // FileShare.None blocks READING too (measured: readFileSync fails EBUSY
    // while held), so the ordinary "still there, still intact" check is
    // exactly what this lock forbids. The failing open is both the precondition
    // of everything below and the same wall `zeroOutFile` is about to hit.
    assert.equal(canOpenReadWrite(locked.file), false, 'the handle must block Node opens before the sweep runs')

    const reclaimed = sweepStaleOscryptDirs(0)

    assert.ok(
      messages.some((m) => /could not zero|could not reclaim/.test(m)),
      `the surviving key file must be reported; got: ${JSON.stringify(messages)}`,
    )
    assert.ok(
      messages.some((m) => m.includes(locked.file) || m.includes(locked.dir)),
      'the report must name the file or directory it could not clear',
    )
    assert.equal(existsSync(sibling.file), false, 'the unlocked sibling must still be reclaimed')
    assert.ok(reclaimed >= 1)
  } finally {
    await holder.stop()
    // A failed cleanup must never mask or replace an error already thrown in
    // the try — the same finally-shadowing rule asserted in `oscryptKeyFor`.
    // The kill is asynchronous teardown, so the retries wait it out; anything
    // still left becomes the next startup sweep's problem, as in production.
    try {
      rmSync(locked.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    } catch {
      // The live-process contract says it must never outlive this file's run;
      // the sweep reclaims it next start. Left on purpose.
    }
    try {
      rmSync(sibling.dir, { recursive: true, force: true })
    } catch {
      // Same.
    }
    setCredentialDiagnosticSink(undefined)
  }
})

/** Whether the file can be opened read-write right now (false = a lock holds it). */
function canOpenReadWrite(file) {
  try {
    closeSync(openSync(file, 'r+'))
    return true
  } catch {
    return false
  }
}

/**
 * Point `linkPath` at `targetDir` in the way the OS reports to Node's `lstat`
 * as a symbolic link: a junction on Windows (creatable without admin), a plain
 * symlink elsewhere. Both are the shape the sweep must refuse to follow.
 */
function makeDirLink(linkPath, targetDir) {
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/c', 'mklink', '/J', linkPath, targetDir], { stdio: 'ignore' })
  } else {
    symlinkSync(targetDir, linkPath, 'dir')
  }
}

test(
  'a junction wearing our name is refused and its victim is left byte-for-byte intact',
  () => {
    // This is issue 01's exact repro: `%TEMP%\qoder-oscrypt-*` linked to a
    // directory we do not own. The old sweep followed the link with `statSync`
    // and NUL-filled the target. Now `lstat` reports a symbolic link, we
    // report the collision, and touch nothing past it.
    const victim = mkdtempSync(join(tmpdir(), 'dsh-victim-'))
    const victimFile = join(victim, 'victim.txt')
    writeFileSync(victimFile, 'do not destroy me')
    const before = readFileSync(victimFile)
    const linkDir = join(tmpdir(), 'qoder-oscrypt-planted')
    rmSync(linkDir, { recursive: true, force: true })
    const messages = captureDiagnostics()
    try {
      makeDirLink(linkDir, victim)
      const reclaimed = sweepStaleOscryptDirs(0)
      assert.equal(reclaimed, 0, 'a planted link is never counted as reclaimed')
      assert.equal(
        Buffer.compare(readFileSync(victimFile), before),
        0,
        'the victim directory’s files must be byte-for-byte unchanged',
      )
      assert.ok(existsSync(linkDir), 'the link itself must survive (not followed, not removed)')
      assert.ok(
        messages.some((m) => /symbolic link|not a credential temp dir/.test(m)),
        `the link collision must be reported; got ${JSON.stringify(messages)}`,
      )
    } finally {
      // Remove the link without following, then the victim it pointed at.
      try {
        if (process.platform === 'win32') {
          rmSync(linkDir, { force: true })
        } else {
          unlinkSync(linkDir)
        }
      } catch {
        /* best effort */
      }
      rmSync(victim, { recursive: true, force: true })
      setCredentialDiagnosticSink(undefined)
    }
  },
)

test('a prefix collision WITHOUT our marker is a foreign directory: skipped silently', () => {
  // Another tool leaves `%TEMP%\qoder-oscrypt-junk\whatever`. Right name, not
  // ours. The sweep must not zero it, not delete it, and not warn about it —
  // a plugin that never owned it gets no claim and raises no alarm.
  const { dir, file } = makeKeyDir(STALE_MS, { marker: false })
  const messages = captureDiagnostics()
  try {
    const reclaimed = sweepStaleOscryptDirs(0)
    assert.equal(reclaimed, 0)
    assert.equal(existsSync(file), true, 'the foreign key file must survive untouched')
    assert.equal(readFileSync(file, 'utf8'), KEY_BODY, 'and must be unchanged')
    assert.deepEqual(messages, [], 'a foreign look-alike earns no warning')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    setCredentialDiagnosticSink(undefined)
  }
})

test('our marker plus a foreign extra file is reported and left alone, not zeroed', () => {
  // A directory that IS ours (has the marker) but whose contents are not the
  // exact `key.b64` + marker shape — something wrote beside our residue. The
  // safe move is to freeze it and say so, never to sweep "everything in the
  // dir" the way the old code did.
  const dir = mkdtempSync(join(tmpdir(), 'qoder-oscrypt-'))
  const stranger = join(dir, 'someone-elses-data.bin')
  writeFileSync(join(dir, 'key.b64'), KEY_BODY, 'utf8')
  writeFileSync(join(dir, MARKER), '')
  writeFileSync(stranger, 'important foreign bytes')
  const before = readFileSync(stranger)
  const old = new Date(Date.now() - STALE_MS)
  utimesSync(dir, old, old)
  const messages = captureDiagnostics()
  try {
    const reclaimed = sweepStaleOscryptDirs(0)
    assert.equal(reclaimed, 0, 'a directory with unexpected contents is not reclaimed')
    assert.equal(Buffer.compare(readFileSync(stranger), before), 0, 'the foreign file is not zeroed')
    assert.ok(existsSync(stranger), 'nor is it deleted')
    assert.ok(
      messages.some((m) => /carries our marker but its contents/.test(m)),
      `the anomaly is reported; got ${JSON.stringify(messages)}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    setCredentialDiagnosticSink(undefined)
  }
})

test('our marker with a non-32-byte key file is reported and left alone', () => {
  // Readable content that does not decode to a real master key is foreign-by-
  // size: refuse to delete it even though it carries our name and marker.
  const { dir, file } = makeKeyDir(STALE_MS, { body: 'bm90LWEta2V5' /* short */ })
  const messages = captureDiagnostics()
  try {
    const reclaimed = sweepStaleOscryptDirs(0)
    assert.equal(reclaimed, 0)
    assert.equal(existsSync(file), true, 'a wrong-size key file is not reclaimed')
    assert.ok(
      messages.some((m) => /not a 32-byte master key/.test(m)),
      `the size mismatch is reported; got ${JSON.stringify(messages)}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    setCredentialDiagnosticSink(undefined)
  }
})

test('a well-formed stale dir with marker and 32-byte key is reclaimed', () => {
  // The positive control after the guards: exactly `key.b64` + marker, aged,
  // right size — reclaimed, silently, and counted.
  const { dir, file } = makeKeyDir(STALE_MS)
  const messages = captureDiagnostics()
  try {
    const reclaimed = sweepStaleOscryptDirs(0)
    assert.ok(reclaimed >= 1)
    assert.equal(existsSync(file), false)
    assert.deepEqual(messages, [], 'an ordinary reclaim is silent')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    setCredentialDiagnosticSink(undefined)
  }
})

test('the sweep is inert when the temp root cannot be read', () => {
  // A failing readdirSync must return 0, not throw — the plugin entry calls
  // this at startup, and housekeeping must never stop the plugin from starting.
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP }
  try {
    const missing = join(tmpdir(), `no-such-dir-dsh-qoder-${process.pid}`)
    process.env.TMPDIR = missing
    process.env.TEMP = missing
    process.env.TMP = missing
    assert.equal(sweepStaleOscryptDirs(0), 0, 'an unreadable temp root is zero, never an exception')
  } finally {
    Object.assign(process.env, saved)
  }
})
