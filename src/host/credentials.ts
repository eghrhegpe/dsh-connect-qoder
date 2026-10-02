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
import { execFileSync, execFile } from 'node:child_process'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, basename } from 'node:path'
import { createDecipheriv } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Region } from './domain.ts'
import { describeThrown } from './errors.ts'

/**
 * One entry of the OSCrypt key cache: the key plus the identity of the
 * `Local State` file it was unwrapped from.
 *
 * `identity` is `undefined` for an entry written before that rule existed — a
 * hot reload of an older module can leave one in the map — and that is exactly
 * why `cachedKeyFor` refuses it rather than treating "both undefined" as a
 * match. The pair is declared here rather than inline so the two readers
 * (`cachedKeyFor`, the exit-time wipe) cannot drift apart.
 */
export interface CachedOscryptKey {
  key?: Buffer
  identity?: string
}

/** A recorded unwrap failure, and the `Local State` version it describes. */
export interface UnwrapFailure {
  reason: string
  at: number
  identity?: string
}

/**
 * Where a diagnostic message goes: the plugin entry's logger, once it has
 * installed one. Everything this module reports is one string, so a sink that
 * takes two arguments is accepted but never given a second one.
 */
export type DiagnosticSink = (message: string) => void

/** The knobs both unwrap entry points take. `force` is the only one today. */
export interface UnwrapOptions {
  /**
   * Ignore the failure window and unwrap again. Reserved for the explicit user
   * action ("重读登录"), where suppressing the attempt would make the button a
   * no-op; every automatic caller leaves it unset.
   */
  force?: boolean
}

/**
 * What one child-process run answers with.
 *
 * The sync runner returns `undefined`; the async one returns a promise of it.
 * `runUnwrap` distinguishes them at runtime with a `typeof … .then` probe, so
 * the union has to admit both rather than being narrowed to the promise.
 */
export type UnwrapSpawn = (
  powershell: string,
  args: string[],
  options: Parameters<typeof execFileSync>[2],
) => Promise<unknown> | unknown

/** The outcome of reading the hand-off file: a key, or why there is none. */
interface UnwrappedKeyRead {
  key?: Buffer
  failure?: string
}

/**
 * One credential as read from a Qoder app, or minted from an environment PAT.
 *
 * This is the record `index.ts` caches per region and the shim is handed. Every
 * field is PRESENT rather than optional — the readers below fill in `''`/`0`
 * for what a given layout does not publish, because the account panel renders
 * these directly and an `undefined` would surface as "undefined" on screen.
 *
 * `source` distinguishes the two clocks {@link isCredentialUsable} treats
 * differently: an app credential carries `expired` computed at read time, while
 * an `env-pat` is exchanged upstream and expires on `expiresAt` instead.
 */
export interface LoadedCredential {
  region: string
  appName: string
  userID: string
  name: string
  email: string
  token: string
  refreshToken: string
  refreshTokenExpiresAt: number
  expiresAt: number
  expired: boolean
  userType: string
  userTag: string
  machineID: string
  source: 'app' | 'env-pat'
  /** The plan summary row, decoded but unvalidated — display only. */
  plan: unknown
  /** The credit/quota snapshot row, decoded but unvalidated — display only. */
  usage: unknown
}

/**
 * How a key is obtained for one app directory.
 *
 * May answer with a key, `undefined`, or a PROMISE of either — `loadCredential`
 * passes the synchronous readers and `loadCredentialAsync` the asynchronous
 * ones, and `loadCredentialWith` probes for the thenable at runtime rather than
 * being told which mode it is in. That probe is what lets the two public
 * entries keep one copy of the layout order instead of two that must be kept in
 * step by hand.
 */
export type KeyProvider = (appDir: string) => Buffer | undefined | PromiseLike<Buffer | undefined>

/** Either a credential or a promise of one, decided by the {@link KeyProvider}. */
type MaybeCredential = LoadedCredential | undefined | PromiseLike<LoadedCredential | undefined>

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
 *
 * Typed as `Region[]` (from `domain.ts`) rather than left to infer: these two
 * entries ARE the only instances of that interface in the whole plugin, so
 * naming the type here is what makes a missing or misspelled URL family a
 * compile error at the definition instead of `undefined` at the request.
 */
export const REGIONS: Region[] = [
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
    downloadUrl: 'https://qoder.com.cn/download',
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
    downloadUrl: 'https://qoder.com/download',
    patEnvNames: ['QODER_API_KEY', 'QODER_PERSONAL_ACCESS_TOKEN', 'QODER_PAT'],
  },
]

/**
 * The per-user application-data root that Qoder's Electron apps live under.
 *
 * Every platform names it differently, and reading `process.env.APPDATA`
 * directly is why this plugin has never worked off Windows: on macOS that
 * variable does not exist, so the code probed `''`, found no app directory, and
 * reported "not signed in" for a user who plainly was. The path itself was never
 * the hard part — the fallback to the documented per-platform location is.
 *
 * The UNWRAP is still Windows-only (see `oscryptKeyFor`), so resolving the
 * directory on macOS or Linux does not make a sign-in readable yet. It is fixed
 * first because it is the half that is unambiguously correct, it is what lets
 * the account panel say "the app is installed here, but this build cannot read
 * its key" instead of "you are not signed in", and it removes the first thing
 * that has to be right when the keystore side lands.
 *
 * The order is the documented one per platform:
 * - Windows: `%APPDATA%` (roaming — Electron's `userData` default).
 * - macOS: `~/Library/Application Support`.
 * - Linux/other: `$XDG_CONFIG_HOME`, else `~/.config` (Electron's default there).
 *
 * @param platform - the Node platform string, injectable for tests.
 * @param env - the environment, injectable for tests.
 * @param home - the home directory, injectable for tests.
 * @returns an absolute path, or `''` when it cannot be determined — which every
 *   reader already treats as "no app here".
 */
export function appDataRootFor(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'win32') return env.APPDATA ?? ''
  if (platform === 'darwin') return join(home, 'Library', 'Application Support')
  // Electron follows the XDG spec on Linux and other unix-likes.
  const xdg = env.XDG_CONFIG_HOME
  if (typeof xdg === 'string' && xdg.length > 0) return xdg
  return join(home, '.config')
}

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
 *
 * WHAT THE KEY IS AND WHAT INVALIDATES IT
 *
 * The entry is keyed by app directory and remembers the identity of the
 * `Local State` it was unwrapped from, so a key is only ever reused while that
 * file is unchanged. This is the fix for a permanent, self-inflicted `needs-app`
 * (issue 08): the cache was keyed by directory alone, so a Qoder reinstall or a
 * profile reset — which rewrites `Local State` with a fresh
 * `os_crypt.encrypted_key` — left the process decrypting with the OLD key. Every
 * subsequent read failed, no code path could ever retry, and the region stayed
 * "unreadable" until DSH was restarted. Binding the cache to the file's identity
 * turns that into an ordinary cache miss.
 *
 * The identity is `mtimeMs` + `size` rather than a hash of the contents, which
 * is a deliberate trade: hashing means reading the whole file (tens of KB) on
 * every credential resolution, and `Local State` is written atomically by a
 * replace, so any content change lands with a new mtime. A same-millisecond
 * rewrite of identical size is the one case this cannot see, and it is also the
 * one case where the old key is still correct.
 */
const keyCache = new Map<string, CachedOscryptKey>()

/**
 * The reason the most recent unwrap of one app directory failed, and when.
 *
 * The diagnostic sink is a one-way street to a logger; the card's account
 * route (see `lib/account-state.js`) also needs to READ the cause back so a
 * region stuck at "encrypted but unreadable" can say *why*. The reason is
 * remembered per directory here, and cleared whenever that directory next
 * unwraps successfully — the recorded value always describes the present,
 * not a past incident.
 *
 * The timestamp is what makes a remembered failure safe to ACT on (issue 07).
 * The original rule was "a failure is never cached", chosen so a transient
 * fault could not pin a region as unusable for the life of the process. But the
 * unwrap is `execFileSync` with a 30 s timeout, reached from the card's account
 * route on every render, so the same choice made an un-unwrappable app cost a
 * blocking subprocess every single time the panel was opened — exactly the
 * state the panel exists to explain. The TTL keeps the original intent (a
 * transient fault is retried, not remembered forever) while capping the cost at
 * one attempt per window. A user who fixes the machine and immediately retries
 * waits at most {@link UNWRAP_FAILURE_TTL_MS}.
 */
const lastUnwrapFailure = new Map<string, UnwrapFailure>()

/**
 * How long a failed unwrap is remembered before another is attempted.
 *
 * 60 s: long enough that opening, switching and re-opening the card panel costs
 * one subprocess rather than one per render, short enough that a user who
 * re-signed-in-and-retried is not told "unreadable" for a minute.
 */
export const UNWRAP_FAILURE_TTL_MS = 60 * 1000

/**
 * The last unwrap failure recorded for one app directory, or `undefined`.
 *
 * `undefined` covers two cases and they are not distinguished: the directory
 * never attempted an unwrap, and it last succeeded. Both mean "no reason to
 * show" from the card's side.
 *
 * A failure is still returned while it is fresh, so the card keeps saying *why*
 * between retries; only the *attempt* is suppressed.
 *
 * @param appDir - the app's user-data directory.
 * @param now - the current instant, injectable for tests.
 * @returns the recorded reason, or `undefined`.
 */
export function describeUnwrapFailure(appDir: string, now = Date.now()): string | undefined {
  const entry = lastUnwrapFailure.get(appDir)
  if (entry === undefined) return undefined
  if (now - entry.at >= UNWRAP_FAILURE_TTL_MS) return undefined
  return entry.reason
}

/**
 * Where an unwrap failure is reported, set by the plugin entry at activation.
 *
 * This module has no Cordis context of its own, so it cannot reach a logger
 * directly. Without somewhere to send it, a failed unwrap is the silent failure
 * the plugin used to have; the entry installs the host logger here so the cause
 * lands in the same stream as every other plugin message.
 */
let diagnosticSink: DiagnosticSink | undefined
export function setCredentialDiagnosticSink(sink: unknown): void {
  diagnosticSink = typeof sink === 'function' ? (sink as DiagnosticSink) : undefined
}

/**
 * Block for a few milliseconds without spinning.
 *
 * `oscryptKeyFor` is synchronous (it wraps `execFileSync`), so it cannot await a
 * backoff. `Atomics.wait` on a shared int is the one way to sleep on the main
 * thread without a busy loop; the wait is in microseconds and the timeout is in
 * milliseconds, so the value itself is irrelevant.
 */
function sleepSync(ms: number): void {
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
function reportCleanupFailure(message: string): void {
  const where: DiagnosticSink = diagnosticSink ?? ((text: string) => process.emitWarning(text))
  where(`dsh-connect-qoder: ${message}`)
}

// The cached values are 32-byte Buffers that outlive every request, and
// nothing in this module zeroes them: a core dump or a same-process hook can
// read the heap for the process's whole life. Wipe the slots when the host
// exits, where no reader can be in flight — best-effort hygiene, not a
// guarantee.
process.on('exit', () => {
  for (const cached of keyCache.values()) cached?.key?.fill(0)
})

/**
 * Identify the `Local State` file a cached key was unwrapped from.
 *
 * Returns `undefined` when the file is absent, and that `undefined` is itself a
 * valid identity: "there is no file" is also how the cache must read when the
 * file is deleted, so a cached key is correctly retired in that case too (an app
 * being uninstalled under a running host is rare, but the old key would then
 * outlive the store it decrypts).
 *
 * @param statePath - absolute path to the app's `Local State`.
 * @returns `"<mtimeMs>:<size>"`, or `undefined` when the file cannot be stat'd.
 */
function localStateIdentity(statePath: string): string | undefined {
  try {
    const stats = statSync(statePath)
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    return undefined
  }
}

/**
 * Whether a cached key may be reused for a given `Local State` identity.
 *
 * Extracted so the rule can be tested without a PowerShell child: the unwrap
 * itself needs DPAPI and a live app, but "is this cache entry still about the
 * file on disk" is a pure question, and it is the question issue 08 turns on.
 * A test that had to launch the real unwrap to check it would either be skipped
 * on CI or be too slow to run often, which is how the original unbounded cache
 * survived this long.
 *
 * The strict comparison is deliberate: an entry recorded before this rule
 * existed (a bare Buffer, or a `{ key }` with no identity) fails it, so a hot
 * reload of an older module cannot leave a key in use with no provenance. For
 * the same reason a missing file (`identity === undefined`) is never a hit —
 * `undefined === undefined` would otherwise trust such a legacy entry — which is
 * also the right answer on its own terms: an app uninstalled under a running
 * host leaves a cached key that can decrypt nothing.
 *
 * @param cached - the cache entry, `{ key, identity }`, or `undefined`.
 * @param identity - the current file identity, or `undefined` when absent.
 * @returns the reusable key, or `undefined` when a fresh unwrap is required.
 */
export function cachedKeyFor(cached: unknown, identity: string | undefined): Buffer | undefined {
  if (cached === undefined || cached === null) return undefined
  // Narrowed rather than assumed: the caller passes whatever the cache holds,
  // and on a hot reload that can be the bare Buffer an older module cached
  // before this shape existed — the doc comment below relies on that.
  const entry = cached as CachedOscryptKey
  if (entry.key === undefined || entry.key === null) return undefined
  // Both sides must be PRESENT and equal. Comparing `undefined === undefined`
  // would otherwise pass for an entry with no recorded identity against a
  // missing file, handing out a key whose provenance is unknown — the test
  // `a legacy entry is never trusted` pins exactly that.
  if (entry.identity === undefined || identity === undefined) return undefined
  if (entry.identity !== identity) return undefined
  return entry.key
}

/**
 * Whether a recent failure should suppress another unwrap attempt (issue 07).
 *
 * Pure and exported so the window can be tested without a PowerShell child: the
 * subprocess is the expensive, blocking thing, and the question "is the last
 * failure still inside its window" is what decides whether to spawn it.
 *
 * The check is on the failure's OWN `Local State` identity as well as its age,
 * so a user who re-signed-in and the app rewrote its state file is retried
 * immediately instead of waiting out the window — the two conditions together
 * mean "this failure describes the file as it is now".
 *
 * @param entry - the recorded `{ reason, at, identity }`, or `undefined`.
 * @param identity - the current `Local State` identity.
 * @param now - the current instant, injectable for tests.
 * @returns true when the attempt should be skipped.
 */
export function failureStillBlocks(
  entry: UnwrapFailure | undefined | null,
  identity: string | undefined,
  now = Date.now(),
): boolean {
  if (entry === undefined || entry === null) return false
  if (now - entry.at >= UNWRAP_FAILURE_TTL_MS) return false
  // A rewritten `Local State` ends the window early: the failure described a
  // file that no longer exists, and the user re-signing in is exactly the
  // moment they expect the retry to happen. This is the same "bind the answer
  // to the file it came from" rule as the key cache, applied to the failure.
  if (entry.identity !== undefined && entry.identity !== identity) return false
  return true
}

/**
 * Unwrap one app's OSCrypt key.
 *
 * The cache hit is conditional on `Local State` being byte-for-byte the same
 * file the cached key came from (see `keyCache`); anything else is a miss and
 * re-unwraps.
 *
 * SYNCHRONOUS, and that is a documented cost rather than an oversight: the
 * PowerShell child blocks the host's event loop for as long as it runs
 * (measured: ~0.5 s per region on the success path, and up to the 30 s timeout
 * when it cannot succeed). `oscryptKeyForAsync` is the version every request
 * path should use; this one is kept for the callers that genuinely cannot await
 * — the process-startup sweep and the `probe/` scripts — and for the rare
 * `cachedOnly` read, which by construction answers from the cache and never
 * spawns the child at all.
 *
 * @param appDir - absolute Electron user-data directory for the app.
 * @param options.force - ignore the failure window and unwrap again. Reserved
 *   for the explicit user action ("重读登录"), where suppressing the attempt
 *   would make the button a no-op; every automatic caller leaves it unset.
 * @returns the 32-byte AES key, or `undefined` when it cannot be obtained.
 */
export function oscryptKeyFor(appDir: string, options: UnwrapOptions = {}): Buffer | undefined {
  // The sync runner never returns a thenable, so this is a key or nothing. The
  // cast states that instead of widening the caller's return type to a promise
  // it can never receive.
  return runUnwrap(appDir, options, spawnUnwrapSync) as Buffer | undefined
}

/**
 * Unwrap one app's OSCrypt key without blocking the event loop.
 *
 * Same rules, same caches, same failure classification as
 * {@link oscryptKeyFor} — the two share `runUnwrap` and differ ONLY in how the
 * child process is spawned, which is what makes that claim checkable rather
 * than a promise: there is one implementation of the temp-dir handling, the
 * zeroing, the identity binding and the failure recording, so an async version
 * that diverged would have to diverge by re-implementing one of them.
 *
 * @param appDir - absolute Electron user-data directory for the app.
 * @param options.force - see {@link oscryptKeyFor}.
 * @returns a promise of the 32-byte AES key, or `undefined` when it cannot be
 *   obtained.
 */
export async function oscryptKeyForAsync(
  appDir: string,
  options: UnwrapOptions = {},
): Promise<Buffer | undefined> {
  // Async runner, so the thenable branch is the one that runs; the cast keeps
  // the union out of every call site.
  return runUnwrap(appDir, options, spawnUnwrapAsync) as Promise<Buffer | undefined>
}

/**
 * The shared body of both unwrap paths.
 *
 * `spawn` receives `(powershell, args, options)` and either returns (sync) or
 * returns a promise of it (async); everything around it — the cache lookup, the
 * failure window, the temp directory, the marker, the zeroing, the reporting —
 * is identical by construction.
 *
 * @param appDir - the app's user-data directory.
 * @param options - `{ force }`.
 * @param spawn - the child-process runner.
 * @returns the key, or a promise of it, depending on `spawn`.
 */
function runUnwrap(
  appDir: string,
  options: UnwrapOptions,
  spawn: UnwrapSpawn,
): Buffer | undefined | PromiseLike<Buffer | undefined> {
  const statePath = join(appDir, 'Local State')
  // Read before the cache lookup, not after: a stat is a few microseconds and
  // it is the only thing standing between a reinstall and a permanent
  // "unreadable" verdict, so it is not worth deferring to the miss path.
  const identity = localStateIdentity(statePath)
  const cached = cachedKeyFor(keyCache.get(appDir), identity)
  if (cached !== undefined) return cached
  // Inside the failure window, do not spawn the child again (issue 07): on a
  // machine that cannot unwrap, retrying on every request would pay the cost
  // over and over for a known answer. The recorded reason is still served to
  // the card, so the panel keeps saying WHY rather than being blanked.
  if (options.force !== true && failureStillBlocks(lastUnwrapFailure.get(appDir), identity)) {
    return undefined
  }
  if (identity === undefined) {
    // No `Local State`: the app is not installed under this name. Reported
    // below like any other failure, minus the diagnostic, because this is the
    // normal outcome of probing the several names a region knows.
    return recordUnwrapFailure(appDir, 'no Local State file', identity)
  }
  // `dir` and `lastFailure` are assigned inside `settle`, which runs AFTER the
  // child exits on the async path — so they cannot be `const`, and both need
  // their types stated for the same reason: no initializer to infer from.
  let dir: string | undefined
  let key: Buffer | undefined
  let lastFailure: string | undefined
  /**
   * Zero the hand-off file and remove the directory, then hand back the key.
   *
   * Takes the key as an argument rather than closing over it, because the
   * async path discovers the key AFTER the child exits: a closure would capture
   * `undefined` and the cleanup would return the wrong answer.
   */
  const settle = (found: Buffer | undefined): Buffer | undefined => {
    key = found
    if (dir !== undefined) {
      // Zero the key bytes before unlink: removing the file does not clear
      // the sectors, so a spinning disk (or an AV quarantine snapshot) would
      // keep them recoverable.
      zeroOutFile(join(dir, 'key.b64'))
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch (error) {
        // Blocked only while some handle on the file is still open — in
        // practice a killed child whose kernel teardown has not caught up
        // (see `zeroOutFile`). Reported rather than thrown, so a surviving
        // directory is a logged hazard whose remaining owner is the next
        // startup sweep — which is a plugin start away, not a timer.
        reportCleanupFailure(
          `could not remove the credential temp dir ${dir}: ${describeThrown(error)}`,
        )
      }
    }
    return key
  }
  try {
    dir = mkdtempSync(join(tmpdir(), 'qoder-oscrypt-'))
    // Identity marker: the startup sweep only reclaims a directory that
    // carries this file, so name-prefix collisions (another tool's
    // `qoder-oscrypt-*`, or a junction wearing that name) are never touched.
    // Written before the child starts — and before any secret byte exists —
    // so the ordering rule from the ACL comment holds. If this write fails,
    // the whole unwrap aborts through the same catch: a directory that cannot
    // be marked must not leak un-marked, because then it could never be swept.
    writeFileSync(join(dir, OSCRYPT_MARKER), '')
    const outFile = join(dir, 'key.b64')
    const spawned = spawn(systemPowershell(), ['-NoProfile', '-NonInteractive', '-Command', DPAPI_SCRIPT], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 30000,
      env: unwrapEnv(appDir, outFile),
    })
    // The sync runner answers `undefined` and the async one a promise, so the
    // branch is decided on the VALUE. `PromiseLike<unknown>` rather than a bare
    // `unknown` because `.then` is called on it two lines down — the probe is
    // what makes the cast safe, not a wish.
    if (
      spawned !== undefined &&
      typeof (spawned as PromiseLike<unknown>).then === 'function'
    ) {
      // The async path. The cleanup cannot run until the child is done, or the
      // temp directory would be removed underneath a live process — so it runs
      // in the promise chain rather than in a `finally`, and the whole tail of
      // the synchronous function is mirrored by the two handlers below.
      return (spawned as PromiseLike<unknown>).then(
        () => {
          const read = readUnwrappedKey(outFile)
          if (read.failure !== undefined) lastFailure = read.failure
          return finishUnwrap(appDir, settle(read.key), lastFailure, identity)
        },
        (error) => {
          // The child failed or timed out. `settle(undefined)` still zeroes and
          // removes the directory, so a failed unwrap leaves no key behind.
          return finishUnwrap(appDir, settle(undefined), describeUnwrapError(error), identity)
        },
      )
    }
    // `read.key` is what the child actually produced; `key` the outer variable is
    // the SETTLED value, which is why it is assigned here rather than read.
    const read = readUnwrappedKey(outFile)
    if (read.failure !== undefined) lastFailure = read.failure
    return finishUnwrap(appDir, settle(read.key), lastFailure, identity)
  } catch (error) {
    // Keep enough of the cause to be diagnosable. This used to be a bare
    // `catch {}`, which made a missing app, a DPAPI failure, an absent
    // PowerShell and a changed `Local State` format all look identical from
    // the outside: the region simply never appeared, with nothing logged.
    //
    // Reached when the setup itself failed — `mkdtempSync`, the marker write, or
    // the child spawn throwing. In that case there is no key, and `key` is
    // still `undefined` because only `settle` assigns it.
    lastFailure = describeUnwrapError(error)
  }
  return finishUnwrap(appDir, settle(key), lastFailure, identity)
}

/**
 * Read the hand-off file the child wrote.
 *
 * @param outFile - where the child wrote the base64 key.
 * @returns `{ key }` when it decoded to a real 32-byte master key, or
 *   `{ failure }` naming why it did not. The two are separate fields rather
 *   than one value because a wrong-size key is a DIFFERENT failure from an
 *   empty file, and both are reported.
 */
function readUnwrappedKey(outFile: string): UnwrappedKeyRead {
  const text = readFileSync(outFile, 'utf8').trim()
  if (text.length === 0) return { failure: 'the unwrap produced an empty key file' }
  const candidate = Buffer.from(text, 'base64')
  if (candidate.length !== 32) {
    return { failure: `Local State unwrapped to ${candidate.length} bytes, expected 32` }
  }
  return { key: candidate }
}

/**
 * Record a failure, emit the diagnostic, and answer `undefined`.
 *
 * Split out so the "no `Local State`" early return and the post-spawn failure
 * path cannot drift on when they report: the first is the normal outcome of
 * probing several app names and stays out of the log, everything else is a real
 * problem the user has to see.
 */
function recordUnwrapFailure(
  appDir: string,
  reason: string | undefined,
  identity: string | undefined,
): undefined {
  lastUnwrapFailure.set(appDir, { reason: String(reason), at: Date.now(), identity })
  if (reason !== 'no Local State file') {
    const where: DiagnosticSink = diagnosticSink ?? ((message: string) => process.emitWarning(message))
    where(`dsh-connect-qoder: could not unwrap the OSCrypt key for ${appDir}: ${reason}`)
  }
  return undefined
}

/** The one place a fresh key replaces a remembered failure, and vice versa. */
function finishUnwrap(
  appDir: string,
  key: Buffer | undefined,
  lastFailure: string | undefined,
  identity: string | undefined,
): Buffer | undefined {
  if (key === undefined) return recordUnwrapFailure(appDir, lastFailure, identity)
  lastUnwrapFailure.delete(appDir)
  keyCache.set(appDir, { key, identity })
  return key
}

/** Name the cause of a failed child, keeping enough to diagnose it. */
function describeUnwrapError(error: unknown): string {
  const failure = error as { status?: unknown; signal?: unknown; message?: unknown } | undefined
  return failure?.status !== undefined
    ? `PowerShell exited ${String(failure.status)}${failure.signal ? ` (${String(failure.signal)})` : ''}`
    : String(failure?.message ?? error)
}

/** Run the DPAPI child, blocking. */
function spawnUnwrapSync(
  powershell: string,
  args: string[],
  options: Parameters<typeof execFileSync>[2],
): undefined {
  execFileSync(powershell, args, options)
  return undefined
}

/** Run the DPAPI child without blocking the event loop. */
function spawnUnwrapAsync(
  powershell: string,
  args: string[],
  options: Parameters<typeof execFileSync>[2],
): Promise<undefined> {
  return new Promise((resolve, reject) => {
    execFile(powershell, args, options, (error) => {
      if (error) reject(error)
      else resolve(undefined)
    })
  })
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

function unwrapEnv(appDir: string, outFile: string): Record<string, string | undefined> {
  const allowed = new Set(PS_ENV_ALLOWLIST.map((name) => name.toLowerCase()))
  const env: Record<string, string | undefined> = {}
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
function zeroOutFile(file: string, attempts = 4): boolean {
  let stat: ReturnType<typeof lstatSync>
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
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) sleepSync(ZERO_RETRY_BACKOFF_MS * attempt)
    let fd: number
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
      `could not zero ${file} after ${attempts} attempts (${(lastError as { message?: string } | undefined)?.message ?? 'unknown'})`,
    )
    return false
  }
  return true
}

/** The current byte length of a file, or 0 when it cannot be stat'd (gone). */
function currentSize(file: string): number {
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
export function decryptOscrypt(blob: Buffer, key: Buffer): string | undefined {
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
function readItem(dbPath: string, key: string): Buffer | string | undefined {
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
function readJsonSecret(dbPath: string, key: string, oscryptKey: Buffer): unknown {
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
function stateDbCandidates(appDir: string): string[] {
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
function machineIdFor(appDir: string, fallback: string): string {
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
function loadNewCredential(region: Region, appDir: string, oscryptKey: Buffer): LoadedCredential | undefined {
  const file = join(appDir, 'auth.v1.dat')
  if (!existsSync(file)) return undefined
  const plain = decryptOscrypt(readFileSync(file), oscryptKey)
  if (plain === undefined) return undefined
  // `JSON.parse` answers `any`, so this is the one place the shape of the
  // decrypted session is guaranteed rather than checked — hence the narrowing
  // immediately below, before any field is read.
  let session: unknown
  try {
    session = JSON.parse(plain)
  } catch {
    return undefined
  }
  if (session === null || typeof session !== 'object') return undefined
  const record = session as Record<string, unknown>
  if (typeof record.token !== 'string' || record.token.length === 0) return undefined
  const user =
    record.user !== null && typeof record.user === 'object'
      ? (record.user as Record<string, unknown>)
      : {}
  const userID = typeof user.id === 'string' ? user.id : ''
  if (userID.length === 0) return undefined
  // The new file carries ISO timestamps rather than epoch millis. `Date.parse`
  // on a non-string answers NaN rather than throwing, and NaN is what the
  // `Number.isFinite` guards below exist to catch — so the cast is confined to
  // this line instead of being spread over four.
  const expiresAt = Date.parse(String(record.expiresAt))
  const refreshExpiresAt = Date.parse(String(record.refreshTokenExpiresAt))
  return {
    region: region.id,
    appName: basename(appDir),
    userID,
    name: typeof user.name === 'string' ? user.name : '',
    email: typeof user.email === 'string' ? user.email : '',
    token: record.token,
    refreshToken: typeof record.refreshToken === 'string' ? record.refreshToken : '',
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
 * The key already unwrapped for an app directory, without unwrapping one.
 *
 * The card's account route reads every region's state on every render, and
 * that read is synchronous. When the key is not cached this would fall through
 * to `oscryptKeyFor`, which spawns PowerShell with a 30 s timeout and blocks
 * the host's event loop for the duration — the panel would freeze rather than
 * render the "unreadable" state it exists to explain (issue 07).
 *
 * So this variant is honest about what it knows: it answers from the cache or
 * not at all. The caller then reports `needs-app` with whatever reason the
 * unwrap layer already recorded, which is the same thing the user needs to see,
 * and the next scheduled refresh retries the unwrap on its own schedule rather
 * than on a card render.
 *
 * @param appDir - absolute Electron user-data directory for the app.
 * @returns the 32-byte AES key if one is already cached and current, else
 *   `undefined`.
 */
export function cachedOscryptKeyFor(appDir: string): Buffer | undefined {
  return cachedKeyFor(keyCache.get(appDir), localStateIdentity(join(appDir, 'Local State')))
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
 * SYNCHRONOUS, and on a cache miss that means a blocking PowerShell child
 * (~0.5 s measured, up to 30 s on failure). Every request path should call
 * {@link loadCredentialAsync} instead; this one is kept for the startup sweep
 * and the `probe/` scripts, and for `cachedOnly`, which by construction never
 * reaches the unwrap.
 *
 * @returns a credential record, or `undefined` when no app holds a usable one.
 */
export interface LoadCredentialOptions {
  cachedOnly?: boolean
  force?: boolean
}

export function loadCredential(
  region: Region,
  appDataRoot?: string,
  options: LoadCredentialOptions = {},
): LoadedCredential | undefined {
  // `cachedOnly` is how the account route reads: it answers from the key cache
  // and never spawns the unwrap. See `cachedOscryptKeyFor` for why that matters.
  // `force` is the opposite end, for the explicit user-driven re-read.
  const keyFor: KeyProvider =
    options.cachedOnly === true
      ? cachedOscryptKeyFor
      : options.force === true
        ? (appDir: string) => oscryptKeyFor(appDir, { force: true })
        : oscryptKeyFor
  return loadCredentialWith(region, appDataRoot, keyFor) as LoadedCredential | undefined
}

/**
 * Load one region's credential without blocking the event loop.
 *
 * Identical in every rule to {@link loadCredential} — same layouts probed in
 * the same order, same "first that decrypts wins", same `expired` semantics —
 * because both delegate to `loadCredentialWith` and differ only in which unwrap
 * they await. `cachedOnly` is honoured here too, and stays synchronous in
 * effect: it answers from the cache and never spawns anything.
 *
 * @returns a promise of a credential record, or `undefined`.
 */
export async function loadCredentialAsync(
  region: Region,
  appDataRoot?: string,
  options: LoadCredentialOptions = {},
): Promise<LoadedCredential | undefined> {
  const keyFor: KeyProvider =
    options.cachedOnly === true
      ? cachedOscryptKeyFor
      : options.force === true
        ? (appDir: string) => oscryptKeyForAsync(appDir, { force: true })
        : oscryptKeyForAsync
  return loadCredentialWith(region, appDataRoot, keyFor) as Promise<LoadedCredential | undefined>
}

/**
 * The shared probe loop, parameterised by how a key is obtained.
 *
 * `keyFor` may return a key or a promise of one, and this awaits either — which
 * is what lets the two public entries share one implementation instead of
 * keeping two copies of the layout order in step by hand.
 *
 * @param region - the region descriptor.
 * @param appDataRoot - the application-data root to probe.
 * @param keyFor - `(appDir) => key | Promise<key | undefined>`.
 * @returns a credential record or `undefined`, or a promise of one when
 *   `keyFor` is asynchronous.
 */
function loadCredentialWith(
  region: Region,
  appDataRoot: string | undefined,
  keyFor: KeyProvider,
): MaybeCredential {
  // 0.3.x: `com.<vendor>.app.stable/auth.v1.dat`.
  for (const appName of region.newAppNames ?? []) {
    const appDir = join(appDataRoot ?? '', appName)
    if (!existsSync(appDir)) continue
    const pending = keyFor(appDir)
    if (pending !== undefined && typeof (pending as PromiseLike<Buffer | undefined>).then === 'function') {
      // The first candidate that exists may still be the one that blocks, so the
      // loop has to become a chain from here on. The remaining layouts are
      // handled by the same function, which is why the order is expressed once.
      return (pending as PromiseLike<Buffer | undefined>).then((key) =>
        finishCandidate(region, appDataRoot, keyFor, appDir, key),
      )
    }
    const credential = finishCandidate(region, appDataRoot, keyFor, appDir, pending as Buffer | undefined)
    if (credential !== undefined) return credential
  }
  return credentialFromLegacyLayouts(region, appDataRoot, keyFor)
}

/**
 * Use one app directory's key, falling through to the remaining layouts.
 *
 * @returns a credential record, or a promise of one when the key was a promise.
 */
function finishCandidate(
  region: Region,
  appDataRoot: string | undefined,
  keyFor: KeyProvider,
  appDir: string,
  key: Buffer | undefined,
): MaybeCredential {
  if (key === undefined) return credentialFromLegacyLayouts(region, appDataRoot, keyFor)
  const credential = safeRead(() => loadNewCredential(region, appDir, key))
  if (credential !== undefined) return credential
  return credentialFromLegacyLayouts(region, appDataRoot, keyFor)
}

/**
 * The legacy `<AppName>/User/globalStorage/state.vscdb` layouts.
 */
function credentialFromLegacyLayouts(
  region: Region,
  appDataRoot: string | undefined,
  keyFor: KeyProvider,
): MaybeCredential {
  for (const appName of region.appNames) {
    const appDir = join(appDataRoot ?? '', appName)
    if (!existsSync(appDir)) continue
    const pending = keyFor(appDir)
    if (pending !== undefined && typeof (pending as PromiseLike<Buffer | undefined>).then === 'function') {
      return (pending as PromiseLike<Buffer | undefined>).then((key) =>
        readLegacyCredential(region, appDir, appName, key),
      )
    }
    const credential = readLegacyCredential(region, appDir, appName, pending as Buffer | undefined)
    if (credential !== undefined) return credential
  }
  return undefined
}

/**
 * Read one legacy store, or `undefined` when this app holds nothing usable.
 */
function readLegacyCredential(
  region: Region,
  appDir: string,
  appName: string,
  oscryptKey: Buffer | undefined,
): LoadedCredential | undefined {
  if (oscryptKey === undefined) return undefined
  for (const dbPath of stateDbCandidates(appDir)) {
    if (!existsSync(dbPath)) continue
    let userInfo: Record<string, unknown> | undefined
    try {
      const decoded = readJsonSecret(dbPath, USER_INFO_KEY, oscryptKey)
      // `readJsonSecret` answers `unknown` because the row is unvalidated JSON.
      // The field checks below are the validation; they need a record to read.
      userInfo =
        decoded !== null && typeof decoded === 'object' ? (decoded as Record<string, unknown>) : undefined
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
  return undefined
}

/** Run a reader, mapping any failure to `undefined`. */
function safeRead<T>(fn: () => T): T | undefined {
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
export function loadEnvCredential(
  region: Region,
  env: NodeJS.ProcessEnv = process.env,
): LoadedCredential | undefined {
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
export function isCredentialUsable(
  cached: LoadedCredential | undefined | null,
  now = Date.now(),
): boolean {
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
        `could not reclaim the stale credential temp dir ${dir}: ${describeThrown(error)}`,
      )
    }
  }
  return reclaimed
}
