/**
 * Qoder credential acquisition.
 *
 * The Qoder desktop apps (Qoder CN, Qoder, QoderWork CN) keep their sign-in in
 * a VS Code style SQLite store (`state.vscdb`) whose secret rows are Chromium
 * OSCrypt blobs: `"v10" || nonce(12) || ciphertext || tag(16)`, encrypted with
 * an AES-256-GCM key that is itself wrapped by the OS keystore and kept in the
 * app's `Local State` under `os_crypt.encrypted_key`.
 *
 * On Windows that wrapper is DPAPI scoped to the current user, which is why any
 * process running as the same user can unwrap it — that is the property this
 * module relies on. The unwrap is delegated to PowerShell because Node has no
 * built-in DPAPI binding, and the result is exchanged through a temp file
 * rather than a pipe so the call also works under a sandbox that forbids
 * piped stdio.
 *
 * That temp file is the weakest link of the design, so it is hardened: the
 * key is written through an exclusive handle whose ACL is restricted to the
 * current user, the interpreter is invoked by absolute system path with a
 * minimal whitelisted environment (a user-supplied `QODER_PAT` never reaches
 * the child), the file is zeroed before unlink on the normal path, and
 * {@link sweepStaleOscryptDirs} reclaims the orphans a crashed or killed run
 * leaves behind at the next startup. Each temp dir carries an identity marker
 * file so the sweep never acts on a name-prefix collision with someone else's
 * directory (issue 01).
 *
 * Nothing here writes to the Qoder apps' files: the store is opened read-only.
 *
 * @module dsh-connect-qoder/credentials
 */
import { execFileSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { createDecipheriv } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

/** SQLite key holding the sign-in identity, including its access token. */
const USER_INFO_KEY = 'secret://aicoding.auth.userInfo'
/** SQLite key holding the plan summary (tier, validity window). */
const USER_PLAN_KEY = 'secret://aicoding.auth.userPlan'
/** SQLite key holding the credit/quota snapshot. */
const CREDIT_USAGE_KEY = 'secret://aicoding.auth.creditUsage'

/** Chunk size for zeroing a file: large enough to be quick, small enough to be cheap to allocate. */
const ZERO_BLOCK_BYTES = 64 * 1024
/** Base delay between zeroing retries; attempt N waits N × this. */
const ZERO_RETRY_BACKOFF_MS = 50
/** Name of the identity marker file written into every unwrap temp dir. */
const OSCRYPT_MARKER = '.dsh-oscrypt'

/**
 * One Qoder region.
 *
 * `providerId` is the DSH provider route this region registers. The CN and
 * global regions are separate providers so both can be online at once, exactly
 * as the Trae bundle does for its two editions.
 *
 * `appDirs` is the ordered list of Electron user-data directory names that may
 * hold this region's sign-in; the first one that yields a readable credential
 * wins. `appNames` is the matching list of `%APPDATA%` roots.
 */
export const REGIONS = [
  {
    id: 'qoder-cn',
    mode: 'cn',
    displayName: 'Qoder CN',
    appNames: ['QoderCN', 'Qoder CN', 'QoderWork CN'],
    // Qoder 0.3.x moved its user data to a `com.<vendor>.app.<channel>` Electron
    // directory and replaced the VS Code `state.vscdb` store with `auth.v1.dat`.
    // Both layouts are listed so a user who upgrades keeps working; the newer
    // one is tried first because that is where a freshly installed app writes.
    newAppNames: ['com.qodercn.app.stable'],
    baseUrl: 'https://gateway.qoder.com.cn/',
    openApiUrl: 'https://openapi.qoder.com.cn',
    centerUrl: 'https://gateway.qoder.com.cn',
    manageUrl: 'https://qoder.com.cn',
    patEnvNames: ['QODERCN_API_KEY', 'QODERCN_PERSONAL_ACCESS_TOKEN', 'QODERCN_PAT'],
  },
  {
    id: 'qoder',
    mode: 'global',
    displayName: 'Qoder',
    appNames: ['Qoder', 'QoderWork'],
    newAppNames: ['com.qoder.app.stable'],
    baseUrl: 'https://api3.qoder.sh/',
    openApiUrl: 'https://openapi.qoder.sh',
    centerUrl: 'https://center.qoder.sh',
    manageUrl: 'https://qoder.com',
    patEnvNames: ['QODER_API_KEY', 'QODER_PERSONAL_ACCESS_TOKEN', 'QODER_PAT'],
  },
]

/** PowerShell that unwraps the OSCrypt key and writes it to `$env:QODER_KEY_OUT`. */
const DPAPI_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QoderDpapi {
  [StructLayout(LayoutKind.Sequential)] public struct B { public int cbData; public IntPtr pbData; }
  [DllImport("Crypt32.dll", SetLastError=true)]
  static extern bool CryptUnprotectData(ref B i, IntPtr d, IntPtr e, IntPtr r, IntPtr p, int f, ref B o);
  [DllImport("Kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
  public static byte[] U(byte[] data) {
    B i = new B(); i.cbData = data.Length; i.pbData = Marshal.AllocHGlobal(data.Length);
    Marshal.Copy(data, 0, i.pbData, data.Length);
    B o = new B();
    try {
      if (!CryptUnprotectData(ref i, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref o))
        throw new Exception("DPAPI error " + Marshal.GetLastWin32Error());
      byte[] r = new byte[o.cbData]; Marshal.Copy(o.pbData, r, 0, o.cbData); return r;
    } finally { Marshal.FreeHGlobal(i.pbData); if (o.pbData != IntPtr.Zero) LocalFree(o.pbData); }
  }
}
'@
$statePath = Join-Path $env:QODER_APP_DIR 'Local State'
$json = Get-Content $statePath -Raw | ConvertFrom-Json
$raw = [Convert]::FromBase64String($json.os_crypt.encrypted_key)
if ($raw.Length -le 5) { throw 'encrypted_key too short' }
$key = [QoderDpapi]::U($raw[5..($raw.Length - 1)])
# Hand the key off through an exclusive handle (no other process on the box
# can read it while it is on disk) and, before any secret byte touches the
# file, restrict its ACL to the current user: the default inherited ACL of
# the temp directory follows the machine's policy, shared-drive TEMP included.
#
# The ACL is applied with the static File.SetAccessControl after the handle
# that created the file is closed. Applying it THROUGH the open handle (the
# previous shape) always fails: that handle was opened ReadWrite, which does
# not carry WRITE_DAC, so the driver answers ACCESS_DENIED — and widening the
# handle's access would let another process open the file in the gap anyway.
# The file is still EMPTY when the ACL lands, so no key byte exists before
# the restriction is in force; the handle is then reopened exclusive for the
# write. The type is FileSystemAccessRule — there is no "FileAccessRule" in
# .NET, and resolving a non-existent type aborts the script before the unwrap.
$fs = New-Object System.IO.FileStream($env:QODER_KEY_OUT, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
$fs.Dispose()
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
  [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
  [System.Security.AccessControl.FileSystemRights]::FullControl,
  [System.Security.AccessControl.InheritanceFlags]::None,
  [System.Security.AccessControl.PropagationFlags]::None,
  [System.Security.AccessControl.AccessControlType]::Allow)))
[System.IO.File]::SetAccessControl($env:QODER_KEY_OUT, $acl)
$fs = New-Object System.IO.FileStream($env:QODER_KEY_OUT, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  $payload = [System.Text.Encoding]::ASCII.GetBytes([Convert]::ToBase64String($key))
  $fs.Write($payload, 0, $payload.Length)
  $fs.Flush()
} finally {
  $fs.Dispose()
}
`

/**
 * Per-app OSCrypt key cache; the DPAPI unwrap is not free, so do it once.
 *
 * Only a **successful** unwrap is remembered. A failure is transient far more
 * often than it is permanent — a cold PowerShell that blows the 30 s timeout, an
 * antivirus that swallows the `Add-Type` compile, a `%TEMP%` on a network share
 * — and caching the `undefined` would pin that one failure for the life of the
 * process: `has()` would hit, the unwrap would never be attempted again, and the
 * user would see "not signed in" (or a provider that silently never appears) with
 * nothing to explain it. A missed unwrap costs one subprocess, so retrying is
 * the cheap side of the trade.
 */
const keyCache = new Map()

/**
 * The reason the most recent unwrap of one app directory failed.
 *
 * The diagnostic sink is a one-way street to a logger; the card's account
 * route (see `lib/account-state.js`) also needs to READ the cause back so a
 * region stuck at "encrypted but unreadable" can say *why*. The reason is
 * remembered per directory here, and cleared whenever that directory next
 * unwraps successfully — the recorded value always describes the present,
 * not a past incident.
 */
const lastUnwrapFailure = new Map()

/**
 * The last unwrap failure recorded for one app directory, or `undefined`.
 *
 * `undefined` covers two cases and they are not distinguished: the directory
 * never attempted an unwrap, and it last succeeded. Both mean "no reason to
 * show" from the card's side.
 */
export function describeUnwrapFailure(appDir) {
  return lastUnwrapFailure.get(appDir)
}

/**
 * Where an unwrap failure is reported, set by the plugin entry at activation.
 *
 * This module has no Cordis context of its own, so it cannot reach a logger
 * directly. Without somewhere to send it, a failed unwrap is the silent failure
 * the plugin used to have; the entry installs the host logger here so the cause
 * lands in the same stream as every other plugin message.
 */
let diagnosticSink
export function setCredentialDiagnosticSink(sink) {
  diagnosticSink = typeof sink === 'function' ? sink : undefined
}

/**
 * Block for a few milliseconds without spinning.
 *
 * `oscryptKeyFor` is synchronous (it wraps `execFileSync`), so it cannot await a
 * backoff. `Atomics.wait` on a shared int is the one way to sleep on the main
 * thread without a busy loop; the wait is in microseconds and the timeout is in
 * milliseconds, so the value itself is irrelevant.
 */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // A host without shared memory available (a locked-down sandbox) simply
    // does not back off; the retry then happens immediately.
  }
}

/**
 * Report a cleanup that could not be completed.
 *
 * A temp file left holding the unwrapped key is the one failure in this module
 * that outlives the process, so it must not be silent even though cleanup is
 * best-effort by design. The diagnostic sink is the same channel used for
 * unwrap failures, which the plugin entry installs at activation; before that,
 * and when nobody is listening, it falls back to a process warning so the
 * condition is still observable.
 */
function reportCleanupFailure(message) {
  const where = diagnosticSink ?? ((text) => process.emitWarning(text))
  where(`dsh-connect-qoder: ${message}`)
}

// The cached values are 32-byte Buffers that outlive every request, and
// nothing in this module zeroes them: a core dump or a same-process hook can
// read the heap for the process's whole life. Wipe the slots when the host
// exits, where no reader can be in flight — best-effort hygiene, not a
// guarantee.
process.on('exit', () => {
  for (const cached of keyCache.values()) cached?.fill(0)
})

/**
 * Unwrap one app's OSCrypt key.
 *
 * @param appDir - absolute Electron user-data directory for the app.
 * @returns the 32-byte AES key, or `undefined` when it cannot be obtained.
 */
export function oscryptKeyFor(appDir) {
  if (keyCache.has(appDir)) return keyCache.get(appDir)
  let key
  let lastFailure
  const statePath = join(appDir, 'Local State')
  if (!existsSync(statePath)) {
    lastFailure = 'no Local State file'
  } else {
    let dir
    try {
      dir = mkdtempSync(join(tmpdir(), 'qoder-oscrypt-'))
      // Identity marker: the startup sweep only reclaims a directory that
      // carries this file, so name-prefix collisions (another tool's
      // `qoder-oscrypt-*`, or a junction wearing that name) are never touched.
      // Written before the child starts — and before any secret byte exists —
      // so the ordering rule from the ACL comment holds. If this write fails,
      // the whole unwrap aborts through the same catch: a directory that
      // cannot be marked must not leak un-marked, because then it could never
      // be swept.
      writeFileSync(join(dir, OSCRYPT_MARKER), '')
      const outFile = join(dir, 'key.b64')
      execFileSync(
        systemPowershell(),
        ['-NoProfile', '-NonInteractive', '-Command', DPAPI_SCRIPT],
        {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 30000,
          env: unwrapEnv(appDir, outFile),
        },
      )
      const text = readFileSync(outFile, 'utf8').trim()
      if (text.length > 0) {
        const candidate = Buffer.from(text, 'base64')
        if (candidate.length === 32) key = candidate
        else lastFailure = `Local State unwrapped to ${candidate.length} bytes, expected 32`
      } else {
        lastFailure = 'the unwrap produced an empty key file'
      }
    } catch (error) {
      // Keep enough of the cause to be diagnosable. This used to be a bare
      // `catch {}`, which made a missing app, a DPAPI failure, an absent
      // PowerShell and a changed `Local State` format all look identical from
      // the outside: the region simply never appeared, with nothing logged.
      lastFailure =
        error?.status !== undefined
          ? `PowerShell exited ${error.status}${error.signal ? ` (${error.signal})` : ''}`
          : (error?.message ?? String(error))
    } finally {
      if (dir !== undefined) {
        // Zero the key bytes before unlink: removing the file does not clear
        // the sectors, so a spinning disk (or an AV quarantine snapshot)
        // would keep them recoverable.
        //
        // Neither step may throw out of this `finally`: doing so would replace
        // the original failure (or the successful return) with a cleanup error,
        // and the caller would see the wrong cause. `zeroOutFile` now reports
        // its own failures instead, so a surviving key file is a logged hazard
        // rather than a silent one.
        zeroOutFile(join(dir, 'key.b64'))
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch (error) {
          // Blocked only while some handle on the file is still open — in
          // practice a killed child whose kernel teardown has not caught up
          // (see `zeroOutFile`). Both steps report rather than throw, so a
          // surviving directory is a logged hazard whose remaining owner is
          // the next startup sweep — which is a plugin start away, not a timer.
          reportCleanupFailure(
            `could not remove the credential temp dir ${dir}: ${error?.message ?? error}`,
          )
        }
      }
    }
  }
  // A failure is deliberately NOT cached — see `keyCache`. It is reported so
  // "the region never showed up" has a trail to follow, but only a *real*
  // failure: a directory that simply has no `Local State` is an app that is not
  // installed, which is the normal case for one of the several names a region
  // probes and must not be reported as a problem.
  if (key === undefined) {
    lastUnwrapFailure.set(appDir, lastFailure)
    if (lastFailure !== 'no Local State file') {
      const where = diagnosticSink ?? ((message) => process.emitWarning(message))
      where(`dsh-connect-qoder: could not unwrap the OSCrypt key for ${appDir}: ${lastFailure}`)
    }
    return undefined
  }
  lastUnwrapFailure.delete(appDir)
  keyCache.set(appDir, key)
  return key
}

/**
 * The system Windows PowerShell, by absolute path.
 *
 * A bare `powershell.exe` resolves through CWD/PATH, so a same-user program
 * could plant a fake interpreter in the working directory or ahead on PATH
 * and hijack the entire unwrap — running with the hand-off environment in
 * hand. Pinning the system binary closes that; on a machine without it the
 * call fails and the unwrap degrades to "key unavailable" like any other.
 */
function systemPowershell() {
  return join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
}

/**
 * The environment of the unwrap child process: a minimal whitelist plus the
 * two hand-off variables.
 *
 * Expanding the whole `process.env` (the old behaviour) carried every
 * user-supplied secret — a `QODER_PAT` fallback token among them — into the
 * child's environment block, readable by every same-user process; next to
 * the fake-`powershell.exe` vector that was a free credential hand-off. The
 * DPAPI script itself consults only `QODER_APP_DIR`, `QODER_KEY_OUT` and the
 * system variables PowerShell and its C# compiler need.
 */
const PS_ENV_ALLOWLIST = [
  'SYSTEMDRIVE',
  'SystemRoot',
  'WINDIR',
  'TEMP',
  'TMP',
  'COMSPEC',
  'PATHEXT',
  'PATH',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'NUMBER_OF_PROCESSORS',
  'USERNAME',
  'USERPROFILE',
  'LOGONSERVER',
]

function unwrapEnv(appDir, outFile) {
  const allowed = new Set(PS_ENV_ALLOWLIST.map((name) => name.toLowerCase()))
  const env = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (allowed.has(name.toLowerCase())) env[name] = value
  }
  env.QODER_APP_DIR = appDir
  env.QODER_KEY_OUT = outFile
  return env
}

/**
 * Overwrite a file's bytes with zeros, best-effort, with a short retry.
 *
 * A failed overwrite used to be swallowed outright, which turned a real hazard
 * into a silent one. The caller that can hit a lock is {@link oscryptKeyFor}
 * running right after a timeout killed the PowerShell child. A killed process
 * never runs its `finally` — its handles are closed by the kernel tearing the
 * process object down, and that teardown is asynchronous. So the `finally` can
 * arrive while the child's exclusive (`FileShare.None`) handle on `key.b64` is
 * still open: on Windows the open then fails with EBUSY, and so does the
 * unlink that follows. Zeroing used to drop that error, the `rmSync` used to
 * throw into a bare catch, and the app's 32-byte master key sat in `%TEMP%` as
 * plain base64 — readable by any same-user process — with no report, until the
 * next plugin start, because `sweepStaleOscryptDirs` runs once at startup, not
 * on a timer.
 *
 * The retry waits out the kernel teardown, which normally finishes within a
 * few hundred milliseconds; what remains is reported rather than dropped, so a
 * surviving key file is a logged hazard, never an inferred one.
 *
 * @param file - the path to overwrite.
 * @param attempts - how many times to try; each retry waits a little longer,
 *   since the usual cause is a killed child whose teardown has not finished.
 * @returns `true` when the file is gone or was fully zeroed, `false` when it
 *   still exists with its bytes intact, or is not a plain file to begin with.
 */
function zeroOutFile(file, attempts = 4) {
  let stat
  try {
    stat = lstatSync(file)
  } catch {
    // Never existed, or already removed. Nothing to clear.
    return true
  }
  if (!stat.isFile()) {
    // An `r+` open FOLLOWS a symlink, so zeroing "our" file would overwrite
    // whatever the link points at — a same-user attacker who can swap a file
    // in a stale temp dir gets to destroy anything the account can read.
    // Refuse links and irregular entries outright; `rmSync` removes a link
    // without following, so callers still reclaim the directory.
    reportCleanupFailure(
      `refused to zero ${file}: not a plain file (mode ${(stat.mode & 0o7777).toString(8)})`,
    )
    return false
  }
  if (stat.size <= 0) return true
  const size = stat.size
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) sleepSync(ZERO_RETRY_BACKOFF_MS * attempt)
    let fd
    try {
      fd = openSync(file, 'r+')
    } catch (error) {
      // A file that vanished between the stat and the open is a success, not a
      // failure; anything else is a lock we may be able to win on the retry.
      if (!existsSync(file)) return true
      lastError = error
      continue
    }
    try {
      const block = Buffer.alloc(Math.min(ZERO_BLOCK_BYTES, size))
      let offset = 0
      while (offset < size) {
        const length = Math.min(block.length, size - offset)
        writeSync(fd, block, 0, length, offset)
        offset += length
      }
      return true
    } catch (error) {
      lastError = error
    } finally {
      try {
        closeSync(fd)
      } catch {
        // The descriptor is already gone; the unlink below is the fallback.
      }
    }
  }
  // The bytes are still on disk. Before giving up, one last resort: truncate
  // to zero, so a surviving file holds no plaintext even if it cannot be
  // removed. On Windows this usually also fails for the same reason the write
  // did — the killed child's exclusive (`FileShare.None`) handle blocks open
  // for write, and Node's `truncate` opens for write (measured: EBUSY on
  // truncate, unlink, and rm alike while the handle is live) — so this is
  // best-effort, worth it on POSIX where the block is the directory unlink
  // rather than the file open. It never throws past here.
  //
  // The real mitigation for the Windows case is the retry window above, which
  // waits out the asynchronous kernel teardown, plus the startup sweep: what
  // survives this call is a *logged* hazard whose owner is the next sweep.
  try {
    truncateSync(file, 0)
  } catch {
    // Still locked; nothing more to do but report it below.
  }
  // Say so, loudly, unless the truncate above won the race and cleared it.
  if (existsSync(file) && currentSize(file) > 0) {
    reportCleanupFailure(
      `could not zero ${file} after ${attempts} attempts (${lastError?.message ?? 'unknown'})`,
    )
    return false
  }
  return true
}

/** The current byte length of a file, or 0 when it cannot be stat'd (gone). */
function currentSize(file) {
  try {
    return lstatSync(file).size
  } catch {
    return 0
  }
}

/**
 * Decrypt one Chromium OSCrypt blob.
 *
 * @param blob - the raw stored bytes, including the `v10` prefix.
 * @param key - the 32-byte AES key from {@link oscryptKeyFor}.
 * @returns the plaintext, or `undefined` when authentication fails.
 */
export function decryptOscrypt(blob, key) {
  if (blob.length < 3 + 12 + 16) return undefined
  if (blob.subarray(0, 3).toString('latin1') !== 'v10') return undefined
  const body = blob.subarray(3)
  const nonce = body.subarray(0, 12)
  const tag = body.subarray(body.length - 16)
  const ciphertext = body.subarray(12, body.length - 16)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return undefined
  }
}

/**
 * Read one secret row from a VS Code style `state.vscdb`.
 *
 * The value column is a JSON envelope (`{"type":"Buffer","data":[...]}`) for
 * secret rows; anything else is returned as-is.
 *
 * @returns the raw bytes for a Buffer row, a string for a plain row, or
 *   `undefined` when the key is absent.
 */
function readItem(dbPath, key) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key)
    if (row === undefined || row.value === null || row.value === undefined) return undefined
    const value = row.value
    const text = value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : String(value)
    if (text.startsWith('{') && text.includes('"type":"Buffer"')) {
      try {
        return Buffer.from(JSON.parse(text).data)
      } catch {
        return text
      }
    }
    return text
  } finally {
    db.close()
  }
}

/** Decode one JSON secret row, or `undefined` when absent/undecryptable. */
function readJsonSecret(dbPath, key, oscryptKey) {
  const raw = readItem(dbPath, key)
  if (raw === undefined || typeof raw === 'string') return undefined
  const plain = decryptOscrypt(raw, oscryptKey)
  if (plain === undefined) return undefined
  try {
    return JSON.parse(plain)
  } catch {
    return undefined
  }
}

/** Candidate `state.vscdb` paths for one app's Electron user-data directory. */
function stateDbCandidates(appDir) {
  return [
    join(appDir, 'User', 'globalStorage', 'state.vscdb'),
    join(appDir, 'User', 'globalStorage', 'state.vscdb.backup'),
  ]
}

/**
 * The machine id Qoder binds its session to.
 *
 * The legacy layout keeps it in `machineid`; 0.3.x renamed the file to
 * `auth.machine-id`. Both are checked because the id is sent to the gateway
 * alongside the token, and a wrong one is indistinguishable from a hijacked
 * session. When neither exists a stable value is derived from the app directory
 * so repeated runs still agree with each other.
 */
function machineIdFor(appDir, fallback) {
  for (const name of ['auth.machine-id', 'machineid', 'machineId']) {
    const p = join(appDir, name)
    if (!existsSync(p)) continue
    const value = readFileSync(p, 'utf8').trim()
    if (value.length > 0) return value
  }
  return fallback
}

/**
 * Read the 0.3.x credential file.
 *
 * From 0.3.x the apps keep their sign-in in
 * `<userData>/auth.v1.dat` — a Chromium OSCrypt blob whose plaintext is the
 * session JSON directly, rather than a row inside a VS Code `state.vscdb`:
 *
 * ```json
 * { "schemaVersion": 1, "token": "dt-…", "refreshToken": "drt-…",
 *   "expiresAt": "2026-10-19T07:44:22Z", "refreshTokenExpiresAt": "…",
 *   "user": { "id": "…", "name": "…", "email": "…" } }
 * ```
 *
 * The envelope is unchanged (`v10` + AES-256-GCM under the DPAPI-wrapped key),
 * so {@link oscryptKeyFor} and {@link decryptOscrypt} are reused as they are.
 *
 * @returns a credential record, or `undefined` when the file is absent or
 *   cannot be decoded.
 */
function loadNewCredential(region, appDir, oscryptKey) {
  const file = join(appDir, 'auth.v1.dat')
  if (!existsSync(file)) return undefined
  const plain = decryptOscrypt(readFileSync(file), oscryptKey)
  if (plain === undefined) return undefined
  let session
  try {
    session = JSON.parse(plain)
  } catch {
    return undefined
  }
  if (session === null || typeof session !== 'object') return undefined
  if (typeof session.token !== 'string' || session.token.length === 0) return undefined
  const user = session.user !== null && typeof session.user === 'object' ? session.user : {}
  const userID = typeof user.id === 'string' ? user.id : ''
  if (userID.length === 0) return undefined
  // The new file carries ISO timestamps rather than epoch millis.
  const expiresAt = Date.parse(session.expiresAt)
  const refreshExpiresAt = Date.parse(session.refreshTokenExpiresAt)
  return {
    region: region.id,
    appName: basename(appDir),
    userID,
    name: typeof user.name === 'string' ? user.name : '',
    email: typeof user.email === 'string' ? user.email : '',
    token: session.token,
    refreshToken: typeof session.refreshToken === 'string' ? session.refreshToken : '',
    refreshTokenExpiresAt: Number.isFinite(refreshExpiresAt) ? refreshExpiresAt : 0,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    expired: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt <= Date.now() : false,
    // The new layout does not publish these; they were only ever used for
    // display, and the catalog call supplies what routing actually needs.
    userType: '',
    userTag: '',
    machineID: machineIdFor(appDir, `dsh-connect-qoder-${region.id}`),
    source: 'app',
    plan: undefined,
    usage: undefined,
  }
}

/**
 * Load one region's credential from the local Qoder apps.
 *
 * The 0.3.x layout is tried before the legacy one, because that is where a
 * freshly installed app writes; a user who upgrades therefore keeps working
 * without a reinstall, and a user who has not upgraded is unaffected.
 *
 * Every candidate app is tried in order; the first that yields a decryptable
 * credential wins. A credential whose access token has expired is still
 * returned — the caller decides whether to refresh it — but `expired` says so.
 *
 * @returns a credential record, or `undefined` when no app holds a usable one.
 */
export function loadCredential(region, appDataRoot) {
  // 0.3.x: `com.<vendor>.app.stable/auth.v1.dat`.
  for (const appName of region.newAppNames ?? []) {
    const appDir = join(appDataRoot, appName)
    if (!existsSync(appDir)) continue
    const oscryptKey = oscryptKeyFor(appDir)
    if (oscryptKey === undefined) continue
    const credential = safeRead(() => loadNewCredential(region, appDir, oscryptKey))
    if (credential !== undefined) return credential
  }

  // Legacy: `<AppName>/User/globalStorage/state.vscdb`.
  for (const appName of region.appNames) {
    const appDir = join(appDataRoot, appName)
    if (!existsSync(appDir)) continue
    const oscryptKey = oscryptKeyFor(appDir)
    if (oscryptKey === undefined) continue
    for (const dbPath of stateDbCandidates(appDir)) {
      if (!existsSync(dbPath)) continue
      let userInfo
      try {
        userInfo = readJsonSecret(dbPath, USER_INFO_KEY, oscryptKey)
      } catch {
        continue
      }
      if (userInfo === undefined || typeof userInfo.token !== 'string' || userInfo.token.length === 0) continue
      if (typeof userInfo.id !== 'string' || userInfo.id.length === 0) continue
      const expiresAt = Number(userInfo.expireTime)
      return {
        region: region.id,
        appName,
        userID: userInfo.id,
        name: typeof userInfo.name === 'string' ? userInfo.name : '',
        email: typeof userInfo.email === 'string' ? userInfo.email : '',
        token: userInfo.token,
        refreshToken: typeof userInfo.refreshToken === 'string' ? userInfo.refreshToken : '',
        refreshTokenExpiresAt: Number(userInfo.refreshTokenExpireTime) || 0,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
        expired: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt <= Date.now() : false,
        userType: typeof userInfo.userType === 'string' ? userInfo.userType : '',
        userTag: typeof userInfo.userTag === 'string' ? userInfo.userTag : '',
        machineID: machineIdFor(appDir, `dsh-connect-qoder-${region.id}`),
        source: 'app',
        plan: safeRead(() => readJsonSecret(dbPath, USER_PLAN_KEY, oscryptKey)),
        usage: safeRead(() => readJsonSecret(dbPath, CREDIT_USAGE_KEY, oscryptKey)),
      }
    }
  }
  return undefined
}

/** Run a reader, mapping any failure to `undefined`. */
function safeRead(fn) {
  try {
    return fn()
  } catch {
    return undefined
  }
}

/**
 * A credential supplied through the environment instead of the desktop app.
 *
 * The Qoder personal access token is the officially documented integration
 * path, so it is honoured as a fallback when no app sign-in is present. The
 * token is exchanged for a job token by {@link module:dsh-connect-qoder/upstream}.
 */
export function loadEnvCredential(region, env = process.env) {
  for (const name of region.patEnvNames) {
    const value = env[name]
    if (typeof value === 'string' && value.trim().length > 0) {
      return {
        region: region.id,
        appName: name,
        userID: '',
        name: '',
        email: '',
        token: value.trim(),
        refreshToken: '',
        refreshTokenExpiresAt: 0,
        expiresAt: 0,
        expired: false,
        userType: '',
        userTag: '',
        machineID: `dsh-connect-qoder-${region.id}`,
        source: 'env-pat',
        plan: undefined,
        usage: undefined,
      }
    }
  }
  return undefined
}

/**
 * Whether a cached credential may still be served, or must be re-read.
 *
 * The two sources expire on different clocks, and conflating them is what made
 * this worth extracting:
 *
 * - An **app** credential carries an `expired` flag computed when it was read
 *   from disk. The Qoder app refreshes the token in its own store, so once this
 *   says expired the only way to learn about a re-sign-in is to read again.
 * - An **env PAT** is exchanged for a job token with its own `expiresAt`; the
 *   raw PAT never expires, so the exchange result does, and it is a wall-clock
 *   comparison rather than a stored flag.
 *
 * @param cached - the cached record, or `undefined` when nothing is cached.
 * @param now - current epoch milliseconds.
 * @returns true when the cached value may be reused.
 */
export function isCredentialUsable(cached, now = Date.now()) {
  if (cached === undefined || cached === null) return false
  if (cached.source === 'env-pat') return Number(cached.expiresAt) > now
  return cached.expired !== true
}

/**
 * Reclaim the `qoder-oscrypt-*` directories a crash left in the temp dir.
 *
 * The unlink in {@link oscryptKeyFor} runs in a `finally`, so it catches only
 * faults at the JS level: a killed process, a power loss, or a crashed host
 * leaves `%TEMP%\qoder-oscrypt-*\key.b64` behind — the app's 32-byte master
 * key as plain base64, readable by anyone who can read the temp directory.
 * Call this at startup to reclaim it.
 *
 * Only directories whose last write is at least `maxAgeMs` old are touched: a
 * fresh one may belong to another DSH instance unwrapping right now, and its
 * key file is held open (exclusive) for the duration of the call. The default
 * 5 minutes is safe because a live unwrap finishes within the 30 second call
 * timeout — anything older is surely orphaned.
 *
 * The name prefix only picks *candidates*; a directory is touched only after it
 * proves its identity (issue 01). A prefix collision — another tool's residue,
 * or a junction someone planted at `qoder-oscrypt-*` — must never end with this
 * module's startup code zeroing files that are not ours. Three checks, all on
 * `lstat`/`readdir`, none following links into the directory's contents:
 *
 *   1. the entry is a real directory, not a symlink or junction (Node reports
 *      Windows reparse points — junctions included — as symbolic links from
 *      `lstat`, so one check covers both platforms);
 *   2. it carries the {@link OSCRYPT_MARKER} file our unwrap writes, and
 *      contains nothing except `key.b64` beside it;
 *   3. `key.b64` decodes as base64 to exactly 32 bytes — the size of a real
 *      OSCrypt master key (a wrong-size file is reported and left alone: it is
 *      not ours to delete, whatever its name says).
 *
 * A directory that fails check 1 is reported (planted links around a
 * credential-sweep name are worth knowing about); one that fails 2 or 3 is
 * passed over silently as a foreign object — the third-party tool that owns
 * it must get no "could not reclaim" warning from a plugin that never had a
 * claim on it.
 *
 * @returns the number of directories reclaimed.
 */
export function sweepStaleOscryptDirs(maxAgeMs = 5 * 60 * 1000) {
  let names
  try {
    names = readdirSync(tmpdir())
  } catch {
    return 0
  }
  const cutoff = Date.now() - maxAgeMs
  let reclaimed = 0
  for (const name of names) {
    if (!name.startsWith('qoder-oscrypt-')) continue
    const dir = join(tmpdir(), name)
    let link
    try {
      link = lstatSync(dir)
    } catch {
      continue
    }
    // Check 1: never follow a link out of the temp dir. `lstat` on a Windows
    // junction reports isSymbolicLink(); a plain file or a vanished entry is
    // equally not-ours.
    if (link.isSymbolicLink()) {
      reportCleanupFailure(
        `refused to sweep ${dir}: it is a symbolic link, not a credential temp dir`,
      )
      continue
    }
    if (!link.isDirectory() || link.mtimeMs > cutoff) continue
    // Check 2: identity by marker, and nothing foreign riding along.
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    if (!entries.includes(OSCRYPT_MARKER)) continue
    if (entries.length !== 2 || !entries.includes('key.b64')) {
      reportCleanupFailure(
        `left ${dir} alone: it carries our marker but its contents are ${JSON.stringify(entries)}`,
      )
      continue
    }
    // Check 3: the key file must look like a master key, not arbitrary bytes —
    // but only when it can be READ. A `key.b64` we cannot open is the exact
    // locked-by-a-live-handle shape this sweep exists to report and retry, so
    // read failure falls through to the reclaim attempt below rather than
    // silently skipping. The size check refuses to delete *readable* content
    // that does not match a 32-byte key: foreign bytes wearing our name.
    const keyFile = join(dir, 'key.b64')
    let unlockedBytes
    try {
      unlockedBytes = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64').length
    } catch {
      unlockedBytes = 32 // unreadable: ours-but-locked, handled below
    }
    if (unlockedBytes !== 32) {
      reportCleanupFailure(
        `left ${keyFile} alone: it decodes to ${unlockedBytes} bytes, not a 32-byte master key`,
      )
      continue
    }
    try {
      zeroOutFile(keyFile)
      zeroOutFile(join(dir, OSCRYPT_MARKER))
      rmSync(dir, { recursive: true, force: true })
      reclaimed += 1
    } catch (error) {
      // Still held by a live process, or the dir vanished under us; its own
      // cleanup (or the next sweep) takes it. Reported, because this directory
      // holds a master key in plain text and the next sweep is a plugin start
      // away — possibly days.
      reportCleanupFailure(
        `could not reclaim the stale credential temp dir ${dir}: ${error?.message ?? error}`,
      )
    }
  }
  return reclaimed
}
