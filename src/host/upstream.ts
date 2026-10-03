/**
 * The Qoder wire protocol.
 *
 * Qoder is not an OpenAI-compatible endpoint, so three separate mechanisms have
 * to be reproduced to talk to it:
 *
 * 1. **COSY signed headers.** Every gateway request carries a set of `Cosy-*`
 *    headers plus an `Authorization: Bearer COSY.<payload>.<sig>` value. The
 *    signature is an MD5 over the base64 payload, the RSA-wrapped AES key, the
 *    timestamp, the request body, and the signature path.
 * 2. **A permuted base64 body.** The `Encode=1` query flag means the JSON body
 *    is base64-encoded, its alphabet is permuted, and the resulting string's
 *    characters are rotated by thirds.
 * 3. **Doubly-wrapped SSE.** Each `data:` frame is an envelope object whose
 *    `body` field is *itself* a JSON string holding an OpenAI-style chunk.
 *
 * The constants below are protocol facts recovered from the client; they are
 * not configuration.
 *
 * @module dsh-connect-qoder/upstream
 */
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { classifyUpstreamError, describeThrown, errorMessage, parseRetryAfterSeconds, ProtocolShapeChangedError, SignInExpiredError, thrownFlag } from './errors.ts'
import { windowIsOpen } from './offpeak.ts'
import { toEpochMs } from './time.ts'
import { checkinStateFrom } from './claim.ts'
import type { ChatTurnRequest, QoderCredential, Region, UpstreamChunk } from './domain.ts'

/** Public key the gateway expects the per-request AES key to be wrapped with. */
const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`

/** COSY protocol revision the gateway is currently serving. */
const COSY_VERSION = '1.1.38'
/** Client type magic the gateway expects from a CLI client. */
const CLIENT_TYPE = '5'
/** Machine type magic the gateway expects. */
const MACHINE_TYPE = '5'
/** Data-policy value a non-consenting client sends. */
const DATA_POLICY = 'disagree'

/**
 * How long one turn may spend waiting out Qoder's queue, in total.
 *
 * The gateway answers a queued request with `10605` plus a `retryAfterSeconds`
 * hint, and the official client simply waits and tries again. Handing that wait
 * to DSH instead does not work: DSH's retry policy is fixed (5 attempts, 500 ms
 * doubling to a 10 s ceiling, ~40 s of total budget) and ignores the hint, so a
 * queue that clears in 60 s exhausts the budget and the turn fails — after
 * which the user has to send the message again, which restarts the turn from
 * scratch rather than resuming the wait.
 *
 * This module therefore owns the wait. The budget stays well under the 300 s
 * idle ceiling the adapter declares, so a queued turn is never killed by the
 * stream watchdog while it waits.
 */
export const QUEUE_WAIT_BUDGET_MS = 120000

/** Longest single sleep, so one absurd hint cannot stall a turn indefinitely. */
export const QUEUE_WAIT_MAX_SLEEP_MS = 30000

/** Sleep before the first retry when the gateway gives no hint at all. */
export const QUEUE_WAIT_MIN_SLEEP_MS = 1000

/**
 * How long ONE attempt may take before it is treated as a failed try.
 *
 * Without a per-attempt deadline the queue budget below is fiction: it counts
 * only the sleeps between attempts, so a gateway that accepts the connection
 * and then never returns response headers hangs `fetch` forever while
 * `waitedMs` stays at zero. The loop, the budget check, and the adapter's idle
 * watchdog are all bypassed, and the turn never produces a byte of output.
 *
 * This is sized for the slow-but-progressing case the queue legitimately
 * produces, not for a healthy response: the first token of a queued turn can
 * take a while to appear, and killing that would throw away real work. It only
 * has to be short enough that a *stuck* attempt is charged to the budget and
 * retried instead of pinning the turn forever.
 */
const ATTEMPT_TIMEOUT_MS = 60000

/** Abortable sleep; resolves early (without throwing) when the signal aborts. */
function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(finish, Math.max(0, ms))
    function finish() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Timestamps come in seconds, milliseconds, and RFC 3339 strings across the
 * upstream's routes. The single coercion used everywhere is `toEpochMs` in
 * `time.js`; this module re-exports nothing of its own.
 */

/**
 * Classify one error frame into `{ kind, retryAfterSeconds, code, detail }`.
 *
 * Shared by the HTTP-status path and the in-band frame path so both agree on
 * what a given payload means. A frame that carries no failure at all — no error
 * code and no explicit `success: false` — returns `undefined`, which is how the
 * frame reader tells a status frame apart from a chunk.
 *
 * @param chunk - one decoded frame, or a synthetic `{ code, message }` built
 *   from a non-2xx HTTP reply.
 * @param fallbackCode - code to assume when the payload names none (the HTTP
 *   status, on the transport path).
 */
function readFailure(chunk: unknown, fallbackCode = ''):
  | { kind: string; retryAfterSeconds: number; code: string; detail: string }
  | undefined {
  if (chunk === null || typeof chunk !== 'object' || Array.isArray(chunk)) return undefined
  // A frame is only a failure if it carries identifying detail. Bare status or
  // keepalive frames (`{ success: true }`, `{ success: false }` with no code
  // and no message, plain arrays, etc.) must not kill the stream.
  const frame = chunk as Record<string, unknown>
  const hasCode = frame.code != null || frame.errorCode != null
  const hasMessage =
    (typeof frame.message === 'string' && frame.message.length > 0) ||
    (typeof frame.errorMessage === 'string' && frame.errorMessage.length > 0)
  if (!hasCode && !hasMessage) {
    // No identifying fields at all. A `fallbackCode` (HTTP status) still
    // identifies the failure on the transport path; without it, this is not
    // an error frame.
    if (fallbackCode === '') return undefined
  }
  const { code, detail } = unwrapFailure(frame)
  const effective = code !== '' ? code : fallbackCode
  const kind = classifyUpstreamError(chunk, effective, detail)
  return { kind: kind.kind, retryAfterSeconds: kind.retryAfterSeconds ?? 0, code: effective, detail }
}
/** Login protocol revision. */
const LOGIN_VERSION = 'v2'

/**
 * Machine OS string, spelled the way the gateway expects.
 *
 * The darwin arm was the one PLAN P1-4 (protocol drift) wanted: the whole
 * suite had zero references to this constant, so a macOS host silently
 * announced itself as `x86_64_linux` and nobody could tell whether the gateway
 * cared. Measured, not assumed: `probe/machineos-probe.mjs` sends this exact
 * request with only `Cosy-Machineos` varied, and the gateway answers 200 with a
 * byte-identical `chat` group for `x86_64_linux`, `aarch64_linux`,
 * `x86_64_darwin` and `aarch64_darwin` on both regions — so naming the real
 * platform is safe, and a macOS user no longer lies to the gateway about it.
 *
 * Note the cost of that answer: the gateway does not gate on this field, so it
 * cannot be used to detect a wrong-platform bug. It stays a correctness
 * statement about what this host is, not a lever.
 */
export const MACHINE_OS =
  process.platform === 'win32'
    ? process.arch === 'arm64'
      ? 'aarch64_windows'
      : 'x86_64_windows'
    : process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'aarch64_darwin'
        : 'x86_64_darwin'
      : process.arch === 'arm64'
        ? 'aarch64_linux'
        : 'x86_64_linux'

/** Permuted base64 alphabet used when `Encode=1` is in effect. */
export const CUSTOM_ALPHABET = '_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!'
/** Standard base64 alphabet, positionally mapped onto the custom one. */
export const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// The alphabets are exported so a test can rebuild the permutation itself and
// check `encodeBody` against an independent implementation of the documented
// transform. A test that copied the lookup table would only prove the copy
// agrees with itself.

/**
 * Positional translation table from standard to custom alphabet.
 *
 * A `Uint8Array` of exactly 256 entries, so every read below is in bounds by
 * construction — but the TYPE cannot know that (`noUncheckedIndexedAccess` is
 * on, which is why the reads go through `encodeByteAt` below rather than
 * straight at the table). The table maps a character code to its replacement
 * code, which is what makes a byte-for-byte translation of the base64 string
 * possible without building a new string character by character.
 */
const ENCODE_TABLE = (() => {
  const table = new Uint8Array(256)
  for (let i = 0; i < table.length; i++) table[i] = i
  for (let i = 0; i < STD_ALPHABET.length; i++) {
    table[STD_ALPHABET.charCodeAt(i)] = CUSTOM_ALPHABET.charCodeAt(i)
  }
  table['='.charCodeAt(0)] = '$'.charCodeAt(0)
  return table
})()

/**
 * The translation for one already-validated byte.
 *
 * The `?? byte` is unreachable given a 256-entry table and a byte in 0..255,
 * and it is spelled as a fallback rather than a `!` so that the TOTAL
 * behaviour is defined: an identity translation is the correct answer for a
 * byte the table does not name, whereas a non-null assertion would be a
 * promise this function cannot keep if the table ever shrank.
 */
function encodeByteAt(byte: number): number {
  return ENCODE_TABLE[byte] ?? byte
}

/**
 * Encode a request body the way the `Encode=1` flag requires.
 *
 * The transform is: base64 the bytes, translate each character through the
 * permuted alphabet, then rotate the string so the last third comes first and
 * the first third goes last.
 *
 * @param plaintext - the JSON body bytes.
 * @returns the encoded bytes to send as the request body.
 */
export function encodeBody(plaintext: Buffer | string): Buffer {
  const bytes = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)
  const std = bytes.toString('base64')
  const n = std.length
  const third = Math.floor(n / 3)
  const out = Buffer.allocUnsafe(n)
  let dst = 0
  for (let i = n - third; i < n; i++) out[dst++] = encodeByteAt(std.charCodeAt(i))
  for (let i = third; i < n - third; i++) out[dst++] = encodeByteAt(std.charCodeAt(i))
  for (let i = 0; i < third; i++) out[dst++] = encodeByteAt(std.charCodeAt(i))
  return out
}

/** AES-128-CBC encrypt with the key doubling as the IV, base64-encoded. */
function aesEncryptCBCBase64(plaintext: string, keyString: string): string {
  const key = Buffer.from(keyString)
  const cipher = crypto.createCipheriv('aes-128-cbc', key, key)
  return cipher.update(plaintext, 'utf8', 'base64') + cipher.final('base64')
}

/**
 * The path the signature covers: the request path with a leading `/algo`
 * stripped, because the gateway routes that prefix away before verifying.
 */
export function signaturePath(url: string): string {
  let path = new URL(url).pathname
  if (path.startsWith('/algo')) path = path.slice('/algo'.length)
  return path
}

/**
 * Build the full authenticated header set for one gateway request.
 *
 * @param body - the exact bytes that will be sent (already encoded).
 * @param url - the absolute request URL.
 * @param credential - `{ userID, token, name, email, machineID }`.
 * @returns the headers to merge into the request.
 */
export function authHeaders(
  body: Buffer,
  url: string,
  credential: QoderCredential,
): Record<string, string> {
  const aesKey = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const infoB64 = aesEncryptCBCBase64(
    JSON.stringify({
      uid: credential.userID,
      security_oauth_token: credential.token,
      name: credential.name ?? '',
      aid: '',
      email: credential.email ?? '',
    }),
    aesKey,
  )
  const cosyKey = crypto
    .publicEncrypt(
      { key: QODER_RSA_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(aesKey),
    )
    .toString('base64')

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const payloadB64 = Buffer.from(
    JSON.stringify({
      version: 'v1',
      requestId: crypto.randomUUID(),
      info: infoB64,
      cosyVersion: COSY_VERSION,
      ideVersion: '',
    }),
  ).toString('base64')

  const path = signaturePath(url)
  const bodyBytes = body ?? Buffer.alloc(0)
  const sig = crypto
    .createHash('md5')
    .update(payloadB64)
    .update('\n')
    .update(cosyKey)
    .update('\n')
    .update(timestamp)
    .update('\n')
    .update(bodyBytes)
    .update('\n')
    .update(path)
    .digest('hex')

  // Sent as the empty string when absent, which is what `QoderCredential`
  // documents: the machine fingerprint is not a thing to fail a request over.
  // (Before this was spelled out, an absent fingerprint reached `fetch` as
  // `undefined`, and the header came out as the literal text "undefined".)
  const machineID = credential.machineID ?? ''
  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    'Cosy-Key': cosyKey,
    'Cosy-User': credential.userID,
    'Cosy-Date': timestamp,
    'Cosy-Version': COSY_VERSION,
    'Cosy-Machineid': machineID,
    'Cosy-Machinetoken': machineID,
    'Cosy-Machinetype': MACHINE_TYPE,
    'Cosy-Machineos': MACHINE_OS,
    'Cosy-Clienttype': CLIENT_TYPE,
    'Cosy-Clientip': '127.0.0.1',
    'Cosy-Bodyhash': crypto.createHash('md5').update(bodyBytes).digest('hex'),
    'Cosy-Bodylength': String(bodyBytes.length),
    'Cosy-Sigpath': path,
    'Cosy-Data-Policy': DATA_POLICY,
    'Cosy-Organization-Id': '',
    'Cosy-Organization-Tags': '',
    'Login-Version': LOGIN_VERSION,
    'X-Request-Id': crypto.randomUUID(),
  }
}

/** URL listing the models this account may use. */
export function modelListUrl(region: Region): string {
  return `${region.baseUrl}algo/api/v2/model/list?Encode=1`
}

/** URL of the streaming chat endpoint. */
export function chatUrl(region: Region): string {
  return `${region.baseUrl}algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`
}

/** URL exchanging a personal access token for a job token. */
export function exchangeUrl(region: Region): string {
  return `${region.openApiUrl}/api/v1/jobToken/exchange`
}

/** URL returning the signed-in account's profile. */
export function userInfoUrl(region: Region): string {
  return `${region.openApiUrl}/api/v1/userinfo`
}

/** URL returning the account's quota usage. */
export function usageUrl(region: Region): string {
  return `${region.openApiUrl}/api/v2/quota/usage`
}

/**
 * URL the Qoder IDE's own "我的用量" panel reads.
 *
 * The `sash` route is the presentation layer: it answers with a `displayMode`
 * wrapper and carries `dedicatedResourcePackages`, the per-model promotional
 * allowances the panel lists beside the plan and add-on quotas. The plain
 * `quota/usage` route returns only the plan and add-on halves, so this is the
 * one to prefer and the other is the fallback.
 */
export function usagePresentationUrl(region: Region): string {
  return `${region.openApiUrl}/sash/api/v2/me/usage`
}

/**
 * URL listing the account's active campaigns.
 *
 * The IDE's usage panel renders a campaign's `USAGE` placement as the extra
 * promotional row under the quotas — the one carrying a "限时特惠" badge and an
 * end date. The quota routes do not carry that text, so it is read separately
 * and merged in.
 */
export function campaignsUrl(region: Region): string {
  return `${region.openApiUrl}/sash/api/v1/me/campaigns`
}

/**
 * Headers the Qoder IDE itself sends to the OpenAPI host.
 *
 * `Cosy-ClientType: 10` identifies the desktop app. The quota and campaign
 * routes answer without it, but sending what the real client sends keeps this
 * from depending on a default the server may tighten later.
 *
 * The international campaigns endpoint additionally gates the daily
 * `CLAIM_BENEFIT` round on the request carrying the app's umid machine
 * identity (`Cosy-MachineToken/Code/Type`) — verified 2026-09-27 against the
 * live endpoint: a plain-bearer GET lists the evergreen `VIEW_DETAILS`
 * banner only, the same GET with the real umid block lists the daily round.
 * The block's values come from {@link umidHeadersFor}: the app's embedded
 * `runtime-info.exe` mints them, and the app's own `auth.machine-id` value is
 * NOT what the endpoint accepts (substituting it silently degrades the
 * list back to the banner). CN needs no umid block: its campaigns are
 * served complete to a plain-bearer GET.
 */
export function openApiHeaders(credential: QoderCredential, region: Region): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${credential.token}`,
    'Cosy-ClientType': '10',
    'User-Agent': 'Qoder',
    ...umidHeadersFor(region),
  }
}

/** The validated umid block, or `null` when the binary is absent or uncooperative. */
interface UmidBlock {
  machineToken: string
  machineCode: string
  machineType: string
}

/** One cached umid read per process: the binary is slow enough to matter, cheap enough to run once. */
let umidInfo: UmidBlock | null | undefined

/**
 * Test seam: a global function, when present, replaces the binary read
 * (`execFileSync` + `existsSync` + `JSON.parse`) and the per-process cache.
 * Production never sets it; the unit test sets it so every branch of the
 * umid path is reachable without a real install. The probe returns the
 * parsed block, `null`, `undefined`, a partial object, or throws — the
 * header builder must treat all of those as "no block" rather than crash.
 */

/**
 * The app's umid machine-identity header block, or `{}` when it cannot be
 * read. See {@link openApiHeaders} for why the block exists.
 *
 * The block is read from the install root, not the credential: the values
 * are machine-scoped, the same for both regions, and the CN region's
 * campaigns never needed them — but reading them when absent (CN-only
 * installs) must stay a no-op, never a failure.
 *
 * @param {object|undefined} region - the region descriptor.
 * @returns `{ 'Cosy-MachineToken', 'Cosy-MachineCode', 'Cosy-MachineType' }` or `{}`.
 */
/**
 * Test-only seam: reset the per-process umid cache so the next call to
 * `openApiHeaders` re-resolves. Production never calls this; the unit test
 * invokes it between cases because the cache lives in module scope.
 */
export function __dshQoderUmidCacheReset() {
  umidInfo = undefined
}

/**
 * Observability seam: whether the umid machine identity is available to this
 * process, forcing the same lazy per-process resolution `openApiHeaders`
 * performs when the read has not happened yet.
 *
 * The activation warn in `index.ts` uses it to name the one degradation the
 * international edition's check-in depends on — no machine identity, no daily
 * round — without waiting for the first OpenAPI call. The test seam
 * `__dshQoderUmidProbe` still stands in for the binary read, so the answer is
 * deterministic on any machine; the cache stays machine-scoped, region
 * independent, exactly like the header builder's.
 */
export function __dshQoderUmidState(): { available: boolean; reason?: string } {
  if (umidInfo === undefined) umidInfo = readUmidInfo(undefined)
  if (umidInfo !== null) return { available: true }
  return {
    available: false,
    reason:
      'the desktop app machine identity (umid) could not be read ' +
      '(no install, no matching version root, or a silent binary failure)',
  }
}

/**
 * The app's umid machine-identity header block, or `{}` when it cannot be
 * read. See {@link openApiHeaders} for why the block exists.
 *
 * The block is read from the install root, not the credential: the values
 * are machine-scoped, the same for both regions, and the CN region's
 * campaigns never needed them — but reading them when absent (CN-only
 * installs) must stay a no-op, never a failure.
 *
 * The resolution is cached per process in `umidInfo`; the test seam
 * `__dshQoderUmidProbe` and the reset hook `__dshQoderUmidCacheReset` let
 * the unit tests drive every branch without a real install.
 *
 * @param {object|undefined} region - the region descriptor.
 * @returns `{ 'Cosy-MachineToken', 'Cosy-MachineCode', 'Cosy-MachineType' }` or `{}`.
 */
function umidHeadersFor(region: Region): Record<string, string> {
  if (umidInfo === undefined) umidInfo = readUmidInfo(region)
  if (umidInfo === null) return {}
  return {
    'Cosy-MachineToken': umidInfo.machineToken,
    'Cosy-MachineCode': umidInfo.machineCode,
    'Cosy-MachineType': umidInfo.machineType,
  }
}

/**
 * Validate a candidate umid block; return `null` when any field is missing,
 * non-string, or empty. A partial block must not surface partially — the
 * header set is all-or-nothing.
 */
function normalizeUmidBlock(answer: unknown): UmidBlock | null {
  const block = answer as Partial<UmidBlock> | null | undefined
  if (typeof block?.machineToken !== 'string' || block.machineToken.length === 0) return null
  if (typeof block?.machineType !== 'string' || block.machineType.length === 0) return null
  if (typeof block?.machineCode !== 'string' || block.machineCode.length === 0) return null
  return { machineToken: block.machineToken, machineType: block.machineType, machineCode: block.machineCode }
}

/**
 * Run the app's umid binary and parse its `{ machineToken, machineType,
 * machineCode }` answer, or `null` when the binary is absent or uncooperative.
 *
 * The binary ships at `<install>/resources\umid\runtime-info.exe` — the
 * launcher's directory, one level above the versioned resources — and
 * answers with no arguments in well under a second. It is run with a 5 s
 * timeout and a pipe, never a shell: a hung or missing binary degrades to
 * "no machine identity", which on CN is the full answer anyway and on the
 * international edition costs only the daily check-in row.
 *
 * @param {object|undefined} region - the region descriptor; its `id` selects
 *   the install root.
 * @returns the parsed block or `null`.
 */
function readUmidInfo(region?: Region): UmidBlock | null {
  // The test seam stands in for the whole binary read: a probe that answers
  // `null` models "the binary is absent on this machine", which is the
  // production behaviour on a CN-only install or a CI runner.
  const probe = (globalThis as { __dshQoderUmidProbe?: () => unknown }).__dshQoderUmidProbe
  if (typeof probe === 'function') {
    try {
      return normalizeUmidBlock(probe())
    } catch {
      return null
    }
  }
  if (process.platform !== 'win32') return null
  const roots = umidRootsFor(region)
  for (const root of roots) {
    const binary = join(root, 'resources', 'umid', 'runtime-info.exe')
    if (!existsSync(binary)) continue
    let output
    try {
      output = execFileSync(binary, [], { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    } catch {
      continue
    }
    try {
      const info = JSON.parse(output) as Partial<UmidBlock>
      if (typeof info?.machineToken !== 'string' || info.machineToken.length === 0) continue
      if (typeof info?.machineType !== 'string' || typeof info?.machineCode !== 'string') continue
      return { machineToken: info.machineToken, machineType: info.machineType, machineCode: info.machineCode }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Candidate install roots, newest layout first.
 *
 * The 0.4.x launcher splits each version into `Programs\Qoder\.qoder-versions\<v>\resources`,
 * leaving a thin launcher tree at `Programs\Qoder\resources` that carries
 * the shared `umid` binary; the CN app keeps its own `Programs\QoderCN` tree.
 *
 * The version directories are ENUMERATED rather than pinned: the old list
 * hard-coded `0.4.3` (the measured value of the day it was written), and a
 * pinned list stops matching the moment upstream ships the next desktop
 * version — which is exactly when the shared binary may have moved into the
 * new version root. Measured 2026-10-03, the `.qoder-versions` directory also
 * carries sibling MARKER FILES next to the version directories (`0.4.3.qoder-update-ready.json`
 * on this machine), so only directory entries become candidates. Enumeration
 * failing (no `.qoder-versions`, a locked directory) answers an empty list —
 * not a failure: the launcher-tree root below it remains the fallback, and
 * each candidate is still verified with `existsSync` before the binary runs.
 *
 * The CN tree is enumerated by the same rule by symmetry with the global one.
 * It is unmeasured here (no CN install on this machine); the no-op behaviour
 * when the directory is absent is what makes the symmetry safe.
 */
export function umidRootsFor(region?: Region): string[] {
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData === undefined) return []
  const programs = join(localAppData, 'Programs')
  const roots = [
    ...versionedUmidRoots(join(programs, 'Qoder')),
    join(programs, 'Qoder'),
  ]
  if (region?.id === 'qoder-cn') {
    roots.push(...versionedUmidRoots(join(programs, 'QoderCN')), join(programs, 'QoderCN'))
  }
  return roots
}

/**
 * The version-split install roots under one launcher tree, newest version first.
 *
 * Newest-first matters: when two version roots both carry the binary, the
 * newer one is the one the app runs against, and its umid values are the
 * current machine identity.
 */
function versionedUmidRoots(tree: string): string[] {
  let names: string[]
  try {
    names = readdirSync(join(tree, '.qoder-versions'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    // Absent or unreadable directory: no version-split candidates. The caller's
    // launcher-tree root is the fallback; this is not a failure worth naming.
    return []
  }
  // Newest first, numerically: `0.4.10` must beat `0.4.9`, and a
  // lexicographic sort is exactly the bug the enumeration exists to avoid.
  // A non-numeric part falls to the end, last among equals.
  names.sort((a, b) => versionCompare(b, a))
  return names.map((name) => join(tree, '.qoder-versions', name))
}

/** Compare two dot-separated version strings numerically per part. */
function versionCompare(a: string, b: string): number {
  const partsA = a.split('.')
  const partsB = b.split('.')
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const na = Number(partsA[i] ?? 0)
    const nb = Number(partsB[i] ?? 0)
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na - nb
      continue
    }
    const ca = String(partsA[i] ?? '')
    const cb = String(partsB[i] ?? '')
    if (ca !== cb) return ca < cb ? -1 : 1
  }
  return 0
}

/**
 * Parse a JSON body, reporting the content-type when parsing fails.
 *
 * A 200 reply whose body is not JSON (an HTML login page from a SSO gateway,
 * a chunked-proxy error document) would otherwise surface as a cryptic
 * `SyntaxError: Unexpected token '<'`. The body is read once and parsed
 * directly — so a parseable body passes regardless of how the gateway labelled
 * it — and only a genuine parse failure produces the richer message.
 *
 * @param response - the successful (2xx) response to read.
 * @param context - short label for the error message (e.g. "Qoder model list").
 * @returns the parsed JSON value.
 */
async function readJson(response: Response, context: string): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    const ct = response.headers.get('content-type') ?? 'no content-type'
    throw new Error(`${context}: response is not valid JSON (${ct}) — ${text.slice(0, 300)}`)
  }
}

/**
 * Read the account's active promotional campaigns, keeping only the parts the
 * usage panel can render.
 *
 * A campaign contributes a row only through its `USAGE` placement, and only the
 * copy is taken — the amounts it may carry describe what was granted, not what
 * is left, so they are not shown as a balance.
 *
 * @returns `[{ key, title, description, detailUrl, endsAt }]`, newest end first.
 */
/**
 * Read the raw campaigns payload once.
 *
 * Split from {@link fetchCampaigns} so one round trip can serve both things the
 * campaign list answers: the promotional copy the usage panel renders, and the
 * `actionType` / `claimStatus` pair that decides whether there is a daily
 * check-in to claim today. Sending two requests for those would be one more
 * way for the panel and the button to disagree.
 *
 * @returns the parsed campaigns document, unvalidated — `readJson` proves only
 *   that the body parsed as JSON, so the shape is left `unknown` and
 *   {@link projectCampaignRows} is what narrows it. The previous signature
 *   claimed `{ campaigns?: Campaign[] }`, which no code had ever checked; it
 *   compiled only because the field reads went through an `any`.
 */
export async function readCampaigns(
  region: Region,
  credential: QoderCredential,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(campaignsUrl(region), {
    method: 'GET',
    headers: openApiHeaders(credential, region),
    redirect: 'error',
    signal,
  })
  if (!response.ok) throw new Error(`Qoder campaigns failed: HTTP ${response.status}`)
  return readJson(response, 'Qoder campaigns')
}

/**
 * Project the campaigns payload onto the rows the usage panel renders.
 *
 * @param {unknown} payload - the raw campaigns document.
 * @returns `[{ key, title, description, detailUrl, endsAt }]`.
 */
export function projectCampaignRows(payload: unknown): Array<{
  key: string
  title: string
  description: string
  detailUrl: string
  endsAt?: number
}> {
  const list = Array.isArray((payload as { campaigns?: unknown } | null | undefined)?.campaigns)
    ? (payload as { campaigns: unknown[] }).campaigns
    : []
  const rows: Array<{ key: string; title: string; description: string; detailUrl: string; endsAt?: number }> = []
  for (const raw of list) {
    if (raw === null || typeof raw !== 'object') continue
    const campaign = raw as {
      placements?: unknown
      endAt?: unknown
      campaignKey?: unknown
      campaignId?: unknown
    }
    const placements = Array.isArray(campaign.placements) ? campaign.placements : []
    const usage = placements.find(
      (entry) => (entry as { type?: unknown } | null | undefined)?.type === 'USAGE',
    ) as { content?: Record<string, unknown> } | undefined
    if (usage === undefined) continue
    // The panel is bilingual; prefer the Simplified Chinese copy to match the
    // rest of this card, and fall back to English when only that exists.
    const content = (usage.content?.zh ?? usage.content?.['zh-CN'] ?? usage.content?.en ?? {}) as Record<string, unknown>
    const endsAt = toEpochMs(campaign.endAt)
    rows.push({
      key: String(campaign.campaignKey ?? campaign.campaignId ?? ''),
      title: typeof content.title === 'string' ? content.title : '',
      description: typeof content.description === 'string' ? content.description : '',
      detailUrl: typeof content.detailUrl === 'string' ? content.detailUrl : '',
      ...(endsAt !== undefined ? { endsAt } : {}),
    })
  }
  return rows
}

export async function fetchCampaigns(
  region: Region,
  credential: QoderCredential,
  signal?: AbortSignal,
): Promise<Array<{ key: string; title: string; description: string; detailUrl: string; endsAt?: number }>> {
  return projectCampaignRows(await readCampaigns(region, credential, signal))
}

/**
 * URL that claims one campaign's benefit.
 *
 * The OpenAPI host, not the gateway: this side authenticates with the plain
 * bearer token and needs none of the COSY signing or body encoding the model
 * routes require.
 *
 * The id belongs to a round that is live now, which is why the caller reads the
 * campaign list immediately before claiming: the daily round is re-issued with
 * a new id each day, so an id remembered from an earlier read is a stale one.
 */
export function claimCampaignUrl(region: Region, campaignId: string): string {
  return `${region.openApiUrl}/sash/api/v1/me/campaigns/${encodeURIComponent(campaignId)}/claim`
}

/**
 * Claim one campaign's benefit, returning the raw answer.
 *
 * The upstream answers a repeat claim idempotently — `replayed: true`, nothing
 * granted — rather than failing it, so calling this twice costs no Credits.
 * Shape normalisation is a separate pure function (`normalizeClaimResult`) so
 * the interesting part is asserted without a network.
 *
 * @returns the parsed claim response, unvalidated — {@link normalizeClaimResult}
 *   is what narrows it, so the shape stays `unknown` here.
 */
export async function claimCampaign(
  region: Region,
  credential: QoderCredential,
  campaignId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (typeof campaignId !== 'string' || campaignId.length === 0) {
    throw new Error('Qoder check-in failed: no campaign id to claim')
  }
  const response = await fetch(claimCampaignUrl(region, campaignId), {
    method: 'POST',
    headers: { ...openApiHeaders(credential, region), 'Content-Type': 'application/json' },
    body: '{}',
    redirect: 'error',
    signal,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Qoder check-in failed: HTTP ${response.status} ${text.slice(0, 200)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    const ct = response.headers.get('content-type') ?? 'no content-type'
    throw new Error(`Qoder check-in: response is not valid JSON (${ct}) — ${text.slice(0, 300)}`)
  }
}

/** One quota bucket as the usage panel renders it. */
interface QuotaBucket {
  total: number
  used: number
  remaining: number
  percentage: number
  unit?: string
}

/**
 * The `used` / `remaining` / `percentage` / `unit` four-tuple, from a raw bucket.
 *
 * Shared by {@link normalizeQuotaBucket} and {@link normalizeDedicatedPackage}
 * because the two used to carry this block verbatim — the same guess about
 * percentages, the same clamp, the same default unit — and a heuristic that
 * exists twice is a heuristic that can be corrected once. That is not
 * hypothetical here: this plugin has already been bitten by two copies of a
 * time comparison drifting apart, and the fix then was to merge them into one
 * function (`time.ts`). Same shape, same fix.
 *
 * The `> 1 means percent` rule is a GUESS about an undeclared upstream field.
 * It is kept as-is (it is what the IDE panel agrees with) but it is stated in
 * one place now, so if the upstream ever starts sending `0.5` to mean 50% there
 * is one line to change and one comment to correct.
 *
 * @param source - the raw bucket or package object.
 * @param total - the already-validated total (> 0), used for the fallbacks.
 * @returns the four display fields.
 */
function quotaAmountsOf(source: Record<string, unknown>, total: number): {
  used: number
  remaining: number
  percentage: number
  unit: string
} {
  const used = Number(source.used)
  const safeUsed = Number.isFinite(used) ? Math.max(0, used) : 0
  const remainingRaw = Number(source.remaining)
  const remaining = Number.isFinite(remainingRaw) ? Math.max(0, remainingRaw) : Math.max(0, total - safeUsed)
  const percentageRaw = Number(source.percentage)
  const percentage = Number.isFinite(percentageRaw)
    ? percentageRaw > 1
      ? percentageRaw / 100
      : percentageRaw
    : safeUsed / total
  return {
    used: safeUsed,
    remaining,
    percentage: Math.min(1, Math.max(0, percentage)),
    unit: typeof source.unit === 'string' && source.unit.length > 0 ? source.unit : 'credits',
  }
}

/** Coerce one quota bucket into `{ total, used, remaining, percentage, unit }`. */
function normalizeQuotaBucket(value: unknown): QuotaBucket | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const bucket = value as Record<string, unknown>
  const total = Number(bucket.total)
  if (!Number.isFinite(total) || total <= 0) return undefined
  return { total, ...quotaAmountsOf(bucket, total) }
}

/**
 * Normalize one dedicated (per-model) resource package.
 *
 * These are the promotional allowances the IDE panel shows as e.g.
 * "Qwen3.8-Max 免费额度 1402 / 2000 次" — a package bound to a set of models
 * rather than to the account as a whole. Packages that declare no usable total
 * are dropped, matching the client's own filtering.
 */
/** One dedicated (per-model) resource package, as the IDE panel renders it. */
interface DedicatedPackage {
  id: string
  name: string
  description: string
  total: number
  used: number
  remaining: number
  percentage: number
  unit: string
  expiresAt?: number
  /**
   * Whether the package may still be used. Carried from the upstream rather
   * than recomputed: an allowance the gateway has already switched off is not
   * the same as one whose quota is spent, and the panel renders them
   * differently.
   */
  available: boolean
}

function normalizeDedicatedPackage(value: unknown): DedicatedPackage | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const pkg = value as Record<string, unknown>
  const id = typeof pkg.id === 'string' ? pkg.id.trim() : ''
  const total = Number(pkg.total)
  if (id === '' || !Number.isFinite(total) || total <= 0) return undefined
  const expiresAt = toEpochMs(pkg.expiresAt)
  return {
    id,
    name: typeof pkg.name === 'string' ? pkg.name : '',
    description: typeof pkg.description === 'string' ? pkg.description : '',
    total,
    // The same four fields `normalizeQuotaBucket` produces, from the same
    // helper — these two had already been copied once, and the percentage
    // heuristic in particular is a guess that must not diverge between them.
    ...quotaAmountsOf(pkg, total),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    available: pkg.available !== false,
  }
}

/**
 * The account's usage, shaped the way the IDE's panel presents it.
 *
 * Fields the plugin does not itself merge into a card are typed `unknown`
 * rather than dropped: the payload is handed to the client card largely as-is,
 * so a closed interface here would mean a field the upstream adds is silently
 * invisible to the type. What IS declared are the keys the host reads before
 * spreading — `displayMode`, `isQuotaExceeded`, the quota halves — because
 * those are the ones a typo would turn into a missing panel row.
 */
export interface UsageSnapshot {
  displayMode?: unknown
  userType?: unknown
  expiresAt?: number
  upgradeUrl?: unknown
  userQuota?: QuotaBucket
  addOnQuota?: QuotaBucket
  dedicatedPackages?: DedicatedPackage[]
  campaigns?: Array<{ key: string; title: string; description: string; detailUrl: string; endsAt?: number }>
  checkin?: unknown
  isQuotaExceeded?: boolean
  source?: string
  [field: string]: unknown
}

/**
 * Read the account's usage, shaped the way the IDE's panel presents it.
 *
 * Two routes are tried because they carry different halves of the picture: the
 * `sash` presentation route includes the per-model dedicated packages, while
 * `quota/usage` is the older, narrower shape. Either alone is enough to render
 * something useful, so a failure of the first falls back to the second rather
 * than failing the whole read.
 *
 * @returns `{ displayMode, userType, expiresAt, upgradeUrl, userQuota, addOnQuota,
 *   dedicatedPackages, campaigns, checkin, isQuotaExceeded, source }`, or
 *   `undefined` when neither route answered.
 */
export async function fetchUsage(
  region: Region,
  credential: QoderCredential,
  signal?: AbortSignal,
): Promise<UsageSnapshot | undefined> {
  const headers = openApiHeaders(credential, region)

  const read = async (url: string): Promise<unknown> => {
    const response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return readJson(response, 'Qoder usage')
  }

  let payload: unknown
  let source = 'presentation'
  try {
    payload = await read(usagePresentationUrl(region))
  } catch (error) {
    if (signal?.aborted) throw error
    source = 'quota'
    payload = await read(usageUrl(region))
  }

  // The presentation route wraps the same body under `qoderUsage`; the plain
  // route returns it directly. Both spellings of each field are accepted.
  //
  // Read through one record, so the unwrap is checked rather than assumed: a
  // response that is neither object (a bare string, an array) answers the raw
  // payload and falls through the object test below to `undefined`, which is
  // the same "no usage to report" outcome the `?.` chain produced.
  const envelope = payload === null || typeof payload !== 'object' ? {} : (payload as Record<string, unknown>)
  const usage = envelope.qoderUsage ?? envelope.data ?? payload
  if (usage === null || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>

  const userQuota = normalizeQuotaBucket(record.user_quota ?? record.userQuota)
  const addOnQuota = normalizeQuotaBucket(record.add_on_quota ?? record.addOnQuota)
  const rawPackages = record.dedicated_resource_packages ?? record.dedicatedResourcePackages
  const dedicatedPackages = Array.isArray(rawPackages)
    ? rawPackages.map(normalizeDedicatedPackage).filter((entry) => entry !== undefined)
    : []

  // Campaigns are supplementary: the panel is still useful without them, so a
  // failure here must not cost the user their quota numbers. The same payload
  // answers whether there is a daily check-in to claim, so both are read from
  // this one round trip rather than two that could disagree.
  let campaigns: ReturnType<typeof projectCampaignRows> = []
  let checkin: ReturnType<typeof checkinStateFrom> | undefined
  try {
    const raw = await readCampaigns(region, credential, signal)
    campaigns = projectCampaignRows(raw)
    checkin = checkinStateFrom(raw)
  } catch (error) {
    if (signal?.aborted) throw error
  }

  const expiresAt = toEpochMs(record.expires_at ?? record.expiresAt)
  const isQuotaExceeded = record.is_quota_exceeded ?? record.isQuotaExceeded

  // Nothing usable at all is reported as "no data" so the card can say so
  // instead of rendering an empty panel.
  if (userQuota === undefined && addOnQuota === undefined && dedicatedPackages.length === 0) return undefined

  return {
    displayMode: typeof envelope.displayMode === 'string' ? envelope.displayMode : 'qoder',
    userType: String(record.user_type ?? record.userType ?? ''),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    upgradeUrl: String(record.upgrade_url ?? record.upgradeUrl ?? ''),
    ...(userQuota !== undefined ? { userQuota } : {}),
    ...(addOnQuota !== undefined ? { addOnQuota } : {}),
    dedicatedPackages,
    campaigns,
    ...(checkin !== undefined ? { checkin } : {}),
    isQuotaExceeded: isQuotaExceeded === true,
    source,
  }
}

/**
 * Read the model list's product-surface groups and return the `chat` one.
 *
 * WHY THIS EXISTS — measured, not inferred
 *
 * The model list is the plugin's cheapest, most frequent request, so it is also
 * the one that reports protocol drift. Its real envelope was probed on both
 * regions (`probe/model-shape.mjs`): a top-level object keyed by product
 * surface, each value an **array** of model rows. CN answers with 11 groups
 * (`chat` 14 rows, `developer` 14, `byok_teams` 0); the global edition answers
 * with 10 and has **no `developer` group at all**. Two facts from that probe
 * decide this function:
 *
 * 1. **A missing sibling group is normal.** Keying the shape on "all the groups
 *    I saw on CN" would classify every global-edition reply as drift.
 * 2. **An empty group is expressed as `[]`, not as an absent key** — the
 *    `byok_teams` / `byok_enterprise` groups came back with length 0. So
 *    `chat: []` is the genuine, trustworthy answer "this account has no models
 *    on this surface", and it must NOT be confused with drift.
 *
 * Before this, both cases collapsed into `return []`: a renamed group, a new
 * wrapper object, or an HTML SSO page answered 200 and were read as "no models".
 * That is the failure this plugin is worst at — the user is shown an empty
 * picker, the last good catalog is kept forever (issue 04's freeze), and nothing
 * says the plugin itself is out of date. The three states this returns are kept
 * apart on purpose:
 *
 * - an array (possibly empty) → the `chat` group, meaning what it says;
 * - a plain object → a wrapper this code has never seen → drift;
 * - `chat` absent → the group was renamed or the envelope regrouped → drift.
 *
 * @param data - the parsed 200 body.
 * @param region - the region descriptor, for the error message only.
 * @returns the `chat` array of raw rows.
 * @throws {ProtocolShapeChangedError} for either drift shape.
 */
export function readModelCatalogShape(
  data: unknown,
  _region: { displayName: string } = { displayName: 'Qoder' },
): unknown[] {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ProtocolShapeChangedError(
      `top level is ${Array.isArray(data) ? 'an array' : typeof data}, not a group envelope`,
    )
  }
  const envelope = data as Record<string, unknown>
  if (!('chat' in envelope)) {
    // The useful part of the message is what DID arrive: a renamed group reads
    // instantly ("it is called `models` now"), where "no chat" alone would
    // leave the maintainer guessing.
    throw new ProtocolShapeChangedError(
      `no \`chat\` group; groups present: ${Object.keys(envelope).slice(0, 12).join(', ') || '(none)'}`,
    )
  }
  const chat = envelope.chat
  if (!Array.isArray(chat)) {
    throw new ProtocolShapeChangedError(`\`chat\` is ${chat === null ? 'null' : typeof chat}, not an array`)
  }
  return chat
}

/**
 * Fetch and normalize the account's model catalog.
 *
 * The response is grouped by product surface (`chat`, `developer`, `quest`,
 * ...). The `chat` group is the one that answers on the `agent_common` route,
 * so only it is used.
 *
 * @returns an array of `{ key, name, isVL, isReasoning, maxInputTokens, ... }`.
 * @throws {ProtocolShapeChangedError} when the 200 body is not an envelope
 *   this code recognises — see {@link readModelCatalogShape}.
 */
export async function fetchModels(
  region: Region,
  credential: QoderCredential,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const url = modelListUrl(region)
  const headers = authHeaders(Buffer.alloc(0), url, credential)
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', ...headers },
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Qoder model list failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
  }
  const data = await readJson(response, 'Qoder model list')
  const chat = readModelCatalogShape(data, region)
  if (chat.length === 0) return []
  const models: unknown[] = []
  for (const raw of chat) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.key !== 'string' || entry.key.length === 0) continue
    if (entry.enable === false) continue
    if (typeof entry.display_name !== 'string' || entry.display_name.length === 0) continue
    const config = entry.thinking_config as
      | { enabled?: { efforts?: unknown }; disabled?: unknown }
      | undefined
    const efforts = config?.enabled?.efforts
    // `efforts` is an object keyed by level (`{ high: {}, max: {} }`), not an
    // array, and `disabled` is present only on models that permit turning
    // thinking off. A model with `enabled` and no `disabled` block always
    // thinks: it answers `enable_thinking: false` with provider_error 1210
    // ("该模型始终思考，不支持关闭思考"), so the flag must be omitted for it.
    const effortLevels = efforts !== null && typeof efforts === 'object' ? Object.keys(efforts) : []
    const supportsEffort = effortLevels.length > 0
    const canDisableThinking = config?.disabled !== undefined

    // The catalog publishes its selectable context windows as `context_config`
    // (`{ "1M": {...}, "200K": { is_default: true }, ... }`). It publishes no
    // output ceiling anywhere, so the catalog entry deliberately carries no
    // output-ceiling field: the ceiling is a platform-wide constant, probed
    // once and pinned in `pi-model.ts` (`PROBED_MAX_TOKENS`), not per-model
    // catalog data.
    //
    // - `context_config` is the only place the offered window sizes exist, and
    //   the entry flagged `is_default` is the one the app itself starts on, so
    //   these become the choices the model picker can offer.
    // - The output ceiling is pinned, not omitted. `pi-model.ts` declares
    //   `PROBED_MAX_TOKENS` (65536) in every pi-ai descriptor, and
    //   dsh-llm-pi-ai's `resolveEntry` uses it as the per-turn cap. That pin
    //   matters: an omitted ceiling falls through to `resolveEntry`'s 32768
    //   default, which truncated long reasoned turns mid-sentence. See the
    //   `pi-model.ts` module header, item 2, for the chain and provenance.
    const windows = entry.context_config
    const contextOptions: number[] = []
    let defaultContextWindow = 0
    if (windows !== null && typeof windows === 'object') {
      for (const value of Object.values(windows as Record<string, unknown>)) {
        const option = value as { token_count?: unknown; is_default?: unknown } | null
        const tokens = Number(option?.token_count)
        if (!Number.isFinite(tokens) || tokens <= 0) continue
        contextOptions.push(tokens)
        if (option?.is_default === true) defaultContextWindow = tokens
      }
      contextOptions.sort((left, right) => left - right)
    }
    if (defaultContextWindow === 0) defaultContextWindow = Number(entry.max_input_tokens) || 0

    models.push({
      key: entry.key,
      name: entry.display_name,
      isVL: entry.is_vl === true,
      isReasoning: entry.is_reasoning === true || config !== undefined,
      supportsEffort,
      alwaysThinking: supportsEffort && !canDisableThinking,
      effortLevels,
      defaultContextWindow,
      contextOptions,
      maxInputTokens: Number(entry.max_input_tokens) || 0,
      isDefault: entry.is_default === true,
      // Absence is preserved, not folded to 0 — see `priceFactorOf` in
      // lib/catalog-entry.js for why (a manufactured zero renders as 免费, so a
      // renamed `price_factor` would present every model as free instead of
      // showing no rate). This is the only place the raw wire field is read, so
      // the rule is stated here in full rather than shared across the two
      // modules: `catalog-entry.ts` does not import this one and this one does
      // not import that one.
      priceFactor: (() => {
        if (entry.price_factor === undefined || entry.price_factor === null) return undefined
        const factor = Number(entry.price_factor)
        return Number.isFinite(factor) ? factor : undefined
      })(),
      isFree: entry.is_free === true,
      promotion: normalizePromotion(entry.promotion),
    })
  }
  return models
}

/**
 * Normalize one model's time-of-day discount.
 *
 * Qoder discounts some models during an off-peak window (the catalog's own copy
 * reads "错峰 4 折" — 22:00 to 08:00, Asia/Shanghai). The block carries the
 * window, the discounted multiplier, and the multiplier that applies outside it,
 * so the effective rate depends on **when** the model is used, not just on the
 * catalog entry.
 *
 * The upstream `active` field is a moment-in-time answer — "is the discount
 * applying right now" — NOT a campaign switch. Measured live at 14:02 UTC+8:
 * all three discounted models reported `active:false` while still carrying
 * their badges, descriptions and 22:00–08:00 windows; the window was simply
 * closed. Read verbatim as a campaign switch it silenced the entire off-peak
 * UI for the whole day — no card badge, no countdown, no discounted-rate hint,
 * exactly the "does the discount only exist after 22:00?" confusion it is
 * normalized away here. So a `false` is only honored as a kill when the window
 * was OPEN at the moment the server told us it (the one reading that can only
 * mean switched off); a `false` fetched outside the window is uninformative
 * and the campaign stands. Every consumer keeps treating the normalized
 * `active:false` as the kill signal it always meant.
 *
 * @param value - the raw upstream promotion block.
 * @param now - the fetch instant the moment-in-time flag was observed at.
 * @returns `{ active, windowStart, windowEnd, timezone, discountFactor,
 *   beforePromotionPriceFactor, badge, description }`, or `undefined` when the
 *   model carries no promotion.
 */
export function normalizePromotion(value: unknown, now: Date = new Date()) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const promotion = value as Record<string, unknown>
  const discountFactor = Number(promotion.discount_factor)
  const before = Number(promotion.before_promotion_price_factor)
  const windowStart = typeof promotion.window_start === 'string' ? promotion.window_start : ''
  const windowEnd = typeof promotion.window_end === 'string' ? promotion.window_end : ''
  const hasWindow = /^\d{2}:\d{2}$/.test(windowStart) && /^\d{2}:\d{2}$/.test(windowEnd)
  if (!Number.isFinite(discountFactor) && !Number.isFinite(before) && !hasWindow) return undefined
  const timezone =
    typeof promotion.timezone === 'string' && promotion.timezone.length > 0
      ? promotion.timezone
      : 'Asia/Shanghai'
  // The catalog is bilingual; prefer the Simplified Chinese copy to match the
  // rest of the card, falling back to English when only that is present.
  const pick = (field: string): string => {
    const source = promotion[field] as Record<string, unknown> | null | undefined
    if (source === null || typeof source !== 'object') return ''
    const text = source.zh ?? source['zh-CN'] ?? source.en
    return typeof text === 'string' ? text : ''
  }
  // `true` is on at any hour; `false` is re-read against the window above; an
  // absent or non-boolean flag keeps the old strict read (off) — there is
  // nothing here to reinterpret, and guessing campaigns into existence is
  // worse than staying quiet. Without a parseable window there is no clock to
  // re-read against either, so those falses also stand as reported.
  const active = promotion.active === true
    || (promotion.active === false && hasWindow && !windowIsOpen(windowStart, windowEnd, timezone, now))
  return {
    active,
    windowStart: hasWindow ? windowStart : '',
    windowEnd: hasWindow ? windowEnd : '',
    timezone,
    ...(Number.isFinite(discountFactor) ? { discountFactor } : {}),
    ...(Number.isFinite(before) ? { beforePromotionPriceFactor: before } : {}),
    badge: pick('badge'),
    description: pick('description'),
  }
}

/**
 * Exchange a personal access token for a job token.
 *
 * @returns `{ token, refreshToken, expiresAt }`.
 */
export async function exchangePat(
  region: Region,
  pat: string,
  signal?: AbortSignal,
): Promise<{ token: string; refreshToken: string; expiresAt: number }> {
  const response = await fetch(exchangeUrl(region), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ personal_access_token: pat }),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300)
    // Carry what a throttle gate needs to honour the platform's own window
    // rather than invent one: the HTTP status classifies the refusal (a 429 is
    // a rate limit, a 401/403 is a dead credential), and `Retry-After` — read
    // off the header, falling back to a `retryAfterSeconds` field in the body —
    // is the wait the platform asked for. The gate reads both off the thrown
    // error's flags; see `CredentialCache`. An error whose prototype is lost
    // across the throw boundary still carries them, which is why they are plain
    // fields and not a subclass.
    const error = new Error(`Qoder PAT exchange failed: HTTP ${response.status} ${text}`) as Error & {
      status: number
      retryAfterSeconds?: number
    }
    error.status = response.status
    let retryAfter = parseRetryAfterSeconds(response.headers.get('retry-after'))
    if (retryAfter === undefined) {
      // A body-carried window is a second source the gateway has used; it lives
      // in the JSON, not a header. Parse leniently — a non-JSON body is already
      // covered by the header path and leaves no wait.
      const bodySeconds = /"retryAfterSeconds"\s*:\s*(\d+)/.exec(text)
      if (bodySeconds?.[1] !== undefined) {
        const parsed = Number(bodySeconds[1])
        if (Number.isFinite(parsed) && parsed > 0) retryAfter = parsed
      }
    }
    if (retryAfter !== undefined) error.retryAfterSeconds = retryAfter
    throw error
  }
  const data = await readJson(response, 'Qoder PAT exchange')
  // The gateway has answered this field three different ways across builds, so
  // all three spellings are tried. Narrowed through one record read rather than
  // three chained `?.` on an `any`: the values stay `unknown`, so the
  // `typeof token !== 'string'` check below is what actually proves the token.
  const payload = data === null || typeof data !== 'object' ? {} : (data as Record<string, unknown>)
  const token = payload.token ?? payload.job_token ?? payload.jobToken
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Qoder PAT exchange returned no token')
  }
  return {
    token,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : '',
    expiresAt: toEpochMs(payload.expires_at) ?? (Date.now() + 3600_000),
  }
}

/**
 * Fetch the signed-in account's profile.
 *
 * The request goes through `openApiHeaders` like every other OpenAPI call, so
 * the whole route presents one client identity (`Cosy-ClientType`,
 * `User-Agent`) to the gateway.
 *
 * That is consistency, not the cure for a failure seen here: a direct probe of
 * `openapi.qoder.com.cn/api/v1/userinfo` with a real CN credential answers
 * HTTP 200 for a bare `Authorization: Bearer` as well. The 400 the card once
 * showed on 在线确认 came from the account route dereferencing a runtime
 * entry's nonexistent `region` field before this call was ever made (see the
 * stopped-region check in lib/index.js). Keep the shared header set: it is
 * what the real client sends, and the other OpenAPI calls already rely on it.
 *
 * @returns `{ userID, name, email }`.
 */
export async function fetchUserInfo(
  region: Region,
  credential: QoderCredential,
  signal?: AbortSignal,
): Promise<{ userID: string; name: string; email: string }> {
  const response = await fetch(userInfoUrl(region), {
    method: 'GET',
    headers: openApiHeaders(credential, region),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Qoder userinfo failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
  }
  const data = await readJson(response, 'Qoder userinfo')
  // Two envelopes occur: the identity sits either under `data` or at the top
  // level. Both hops are narrowed, so a body that is neither (a bare string, a
  // number) answers `{}` and the fields below read as empty rather than
  // throwing — the same "no identity" outcome the `??` chain produced, but
  // checked instead of assumed.
  const envelope = data === null || typeof data !== 'object' ? {} : (data as Record<string, unknown>)
  const inner = envelope.data
  const body = inner === null || typeof inner !== 'object' ? envelope : (inner as Record<string, unknown>)
  return {
    userID: String(body.id ?? body.user_id ?? ''),
    name: String(body.name ?? body.nickname ?? ''),
    email: String(body.email ?? ''),
  }
}

/**
 * The shape probe a chat turn hands to its frame reader.
 *
 * The doubly-wrapped SSE protocol is measured, not contracted, so the one
 * evidence that a turn's wire has moved is the frame itself: a `data:` payload
 * this build cannot read as an envelope, a chunk, or a named failure. A
 * healthy turn yields chunks and never consults the probe, so counting the
 * unreadable frames costs nothing; the verdict (in `streamChat`'s retry loop)
 * fires only when a WHOLE attempt stream carried frames and not one of them
 * was usable — the chat-side twin of the model-list freeze the catalog path
 * already triages (`protocol-shape-changed`).
 */
interface ChatShapeProbe {
  /** Data payloads the gateway streamed that this build does not read. */
  skipped: number
  /** The first unreadable payload, as received — the evidence the verdict names. */
  sample?: string
}

/** Note one unreadable frame on the turn's probe; the first is the one kept. */
function noteUnreadableFrame(probe: ChatShapeProbe, payload: string): void {
  probe.skipped += 1
  if (probe.sample === undefined) probe.sample = payload.slice(0, 300)
}

/**
 * One chat turn, streamed.
 *
 * Yields plain objects in the OpenAI chunk vocabulary
 * (`{ choices: [{ delta, finish_reason }] }`) so the caller can forward them
 * without knowing about Qoder's envelope.
 *
 * @param region - the region descriptor.
 * @param credential - `{ userID, token, name, email, machineID }`.
 * @param request - `{ model, messages, tools, maxTokens, enableThinking, alwaysThinking, reasoningEffort, sessionId }`.
 *   `alwaysThinking` marks a model that rejects `enable_thinking: false`; for
 *   those the flag is omitted entirely rather than sent as `false`.
 * @yields OpenAI-shaped chat completion chunks.
 */
/** One message as Qoder's chat route wants it. */
interface QoderMessage {
  role?: string
  content?: unknown
  [field: string]: unknown
}

/**
 * One chat turn, streamed.
 *
 * Yields plain objects in the OpenAI chunk vocabulary
 * (`{ choices: [{ delta, finish_reason }] }`) so the caller can forward them
 * without knowing about Qoder's envelope.
 *
 * @param region - the region descriptor.
 * @param credential - `{ userID, token, name, email, machineID }`.
 * @param request - `{ model, messages, tools, maxTokens, enableThinking, alwaysThinking, reasoningEffort, sessionId }`.
 *   `alwaysThinking` marks a model that rejects `enable_thinking: false`; for
 *   those the flag is omitted entirely rather than sent as `false`.
 * @yields OpenAI-shaped chat completion chunks.
 */
export async function* streamChat(
  region: Region,
  credential: QoderCredential,
  request: ChatTurnRequest,
  signal?: AbortSignal,
): AsyncGenerator<UpstreamChunk> {
  const model = request.model
  const recordID = crypto.randomUUID()
  const messages = request.messages as QoderMessage[]
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const lastText = typeof lastUser?.content === 'string' ? lastUser.content : ''

  // A model that always thinks answers `enable_thinking: false` with a
  // `provider_error` (1210) instead of a completion, so the flag is left off
  // for those and thinking is only ever requested positively.
  //
  // `max_tokens` is forwarded only when the caller actually specifies one. The
  // caller is the harness, and it now passes the declared `PROBED_MAX_TOKENS`
  // ceiling (see `pi-model.ts`) through as `request.maxTokens`. Forwarding is
  // the whole job: an over-small value is harmful because reasoning and the
  // answer share this budget upstream, so we never invent or lower it here —
  // and an absent value sends NO key rather than a made-up default.
  // Mixed value types by design (booleans and numbers, and only the keys the
  // caller actually asked for), so the honest type is a record of unknowns.
  // The three assignments below are what prove each value is the right one.
  const parameters: Record<string, unknown> = {}
  // Bound first: `Number.isSafeInteger` is not a type predicate, so testing
  // `request.maxTokens` directly leaves it `number | undefined` inside the
  // branch. Testing the local narrows it, and the comment above is why an
  // absent value must send NO key rather than a default.
  const maxTokens = request.maxTokens
  if (maxTokens !== undefined && Number.isSafeInteger(maxTokens) && maxTokens > 0) {
    parameters.max_tokens = maxTokens
  }
  if (request.enableThinking === true) {
    parameters.enable_thinking = true
    if (typeof request.reasoningEffort === 'string' && request.reasoningEffort.length > 0) {
      parameters.reasoning_effort = request.reasoningEffort
    }
  } else if (request.alwaysThinking !== true) {
    parameters.enable_thinking = false
  }

  // The literal is annotated rather than inferred: every `null` and every `[]`
  // below is a REQUIRED field the gateway expects to see present, and inference
  // widens them to `any`/`never[]` precisely because their emptiness is the
  // point. `image_urls: null` is not "no images" vs "images" — the key has to
  // be there as null, and a future edit that drops it should be a type error.
  const body: {
    image_urls: null
    messages: unknown
    tools: unknown
    chat_context: {
      chatPrompt: string
      imageUrls: null
      extra: { context: unknown[]; modelConfig: { key: unknown; is_reasoning: boolean }; originalContent: string }
      features: unknown[]
      text: string
    }
    [field: string]: unknown
  } = {
    request_id: crypto.randomUUID(),
    request_set_id: recordID,
    chat_record_id: recordID,
    session_id: request.sessionId ?? `dsh-${crypto.randomUUID()}`,
    stream: true,
    chat_task: 'FREE_INPUT',
    is_reply: true,
    is_retry: false,
    source: 1,
    version: '3',
    session_type: 'qodercli',
    agent_id: 'agent_common',
    task_id: 'common',
    code_language: '',
    chat_prompt: '',
    image_urls: null,
    aliyun_user_type: '',
    // The upstream ignores a top-level `system` field; a leading role:system
    // message is what it actually honours.
    system: '',
    messages: request.messages,
    tools: request.tools ?? [],
    parameters,
    chat_context: {
      chatPrompt: '',
      imageUrls: null,
      extra: {
        context: [],
        modelConfig: { key: model, is_reasoning: request.enableThinking === true },
        originalContent: lastText,
      },
      features: [],
      text: lastText,
    },
    model_config: { key: model, source: 'system', is_reasoning: request.enableThinking === true },
    business: {
      product: 'cli',
      version: '1.0.0',
      type: 'agent',
      stage: 'start',
      id: crypto.randomUUID(),
      name: lastText.slice(0, 30),
      begin_at: Date.now(),
    },
  }

  const url = chatUrl(region)
  const bodyBytes = encodeBody(Buffer.from(JSON.stringify(body)))

  // The turn's shape probe: shared across the attempts of this loop, because
  // the verdict is reached only when a WHOLE stream carried frames and none of
  // them was usable (see ChatShapeProbe).
  const shapeProbe: ChatShapeProbe = { skipped: 0, sample: undefined }

  /**
   * Open one attempt and hand back its frame stream.
   *
   * Nothing is yielded until the first frame arrives, so a queue rejection
   * raised here is still safe to retry: the caller has seen no output yet.
   */
  async function* readFrames(response: Response, probe: ChatShapeProbe): AsyncGenerator<UpstreamChunk> {
    // A response with no body is not a stream that ended — it is an answer this
    // transport cannot read, and `getReader()` on `null` would throw a
    // TypeError that the caller would classify as an ordinary fetch failure.
    // Naming it here keeps the retry path and the error message honest; the
    // caller's `try` already covers it, since a generator body does not run
    // until the first `next()`.
    const body = response.body
    if (body === null) {
      throw new Error(`dsh-connect-qoder: response ${response.status} carried no body to stream`)
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let streamDone = false
    try {
      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newline
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload.length === 0) continue
          if (payload === '[DONE]') { streamDone = true; break }

          // The frame is an envelope whose `body` is itself JSON — but a few
          // frames carry the chunk inline, so both shapes are accepted. Every
          // data payload this build ends up not reading is noted on the probe
          // rather than dropped: the verdict at the end of a stream that
          // yielded nothing is the drift triage (see ChatShapeProbe).
          let envelope
          try {
            envelope = JSON.parse(payload)
          } catch {
            noteUnreadableFrame(probe, payload)
            continue
          }
          let chunk = envelope
          if (typeof envelope?.body === 'string') {
            try {
              chunk = JSON.parse(envelope.body)
            } catch {
              noteUnreadableFrame(probe, payload)
              continue
            }
          } else if (envelope?.body !== undefined && typeof envelope.body === 'object') {
            chunk = envelope.body
          }
          // A token-accounting frame carries `choices: []` (or omits the field)
          // and a top-level `usage`. It must be forwarded, not treated as a
          // failure: the shim turns it into the counts DSH records per turn.
          if (chunk?.choices !== undefined || (chunk?.usage !== undefined && chunk.usage !== null)) {
            yield chunk
            continue
          }

          // A failure arrives as an ordinary 200 frame carrying an error object
          // rather than a chunk. Silently dropping it would present the user
          // with an empty assistant turn, so it is raised instead. A frame that
          // is none of chunk, usage, or a NAMED failure — a renamed field, a
          // new wrapper — is noted like the unparseable ones: the verdict that
          // fires when the whole stream is like this says the wire moved.
          const failure = readFailure(chunk)
          if (failure === undefined) {
            noteUnreadableFrame(probe, payload)
            continue
          }
          // Checked before the queue branch on purpose: a spent daily allowance
          // arrives WITH queue markers and a multi-hour Retry-After, so anything
          // that classified on the marker fallback first would turn it into a
          // long sleep. It must not be retried at all.
          if (failure.kind === 'daily-limit') throw new DailyLimitRejection(failure.detail, failure.retryAfterSeconds)
          if (failure.kind === 'rate-limit') {
            // Retryable: the caller waits it out and re-sends, so this is not
            // reported as a rejection.
            throw new QueueRejection(failure.retryAfterSeconds, failure.detail)
          }
          const message = failureMessage(failure, region)
          // The flag is on the class, not hung on a bare `Error` through an
          // `any` local: `isStaleCredentialError` reads it, and this way the
          // reader and this throw cannot drift apart.
          if (failure.kind === 'sign-in-expired') throw new SignInExpiredError(message)
          throw new Error(message)
        }
      }
    } finally {
      // On a retryable rejection the body is abandoned mid-stream; cancelling
      // releases the socket now instead of leaving it to the garbage collector,
      // which matters because the retry loop may open several of these.
      try {
        await reader.cancel()
      } catch {
        // Already closed or errored — nothing left to release.
      }
    }
  }

  /** Send one request. Throws for terminal failures, returns the open stream. */
  async function openAttempt() {
    let response
    // Build headers outside the try so that a programming error (e.g.
    // `credential` is undefined) throws directly rather than being caught
    // and misclassified as a transient network failure.
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Accept-Encoding': 'identity',
      'X-Model-Key': String(model),
      'X-Model-Source': 'system',
      ...authHeaders(bodyBytes, url, credential),
    }
    // Bound this attempt on its own, and still honour the caller's abort. The
    // returned response body outlives this scope, so the deadline must NOT stay
    // armed for the whole stream — only the handshake up to response headers.
    // `AbortSignal.any` is used rather than a manual controller so the timer is
    // always cleared once `fetch` settles, with no listener to leak per attempt.
    const deadline = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)
    const attemptSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        // `Buffer` is a `Uint8Array` and `fetch` accepts binary bodies at
        // runtime, but `BodyInit` in the DOM/Node lib types does not list it —
        // it is spelled as the `URLSearchParams` / `Blob` / `ReadableStream`
        // union. The bytes handed over are exactly the encoded body
        // `authHeaders` just signed, and the signature is computed over THESE
        // bytes, so re-encoding or re-copying them here would break the
        // pairing. One cast at the type boundary, with no runtime effect.
        body: bodyBytes as unknown as BodyInit,
        redirect: 'error',
        signal: attemptSignal,
      })
    } catch (error) {
      // A caller abort is the user's own doing and must surface unchanged.
      if (signal?.aborted) throw error
      // A deadline that fired is a stuck attempt, not a code bug. It is
      // retryable for the same reason a reset socket is: nothing was received,
      // so no output is duplicated by trying again.
      if (deadline.aborted) {
        throw new QueueRejection(
          0,
          `no response headers within ${Math.round(ATTEMPT_TIMEOUT_MS / 1000)}s`,
        )
      }
      // Network-level failures (ECONNRESET, DNS, proxy timeout, undici socket
      // errors) are transient and safe to retry before the first frame. The
      // caller's `queueWaitFor` will apply the escalation ladder.
      // `cause` is an undici `Error` wrapping the socket failure, and its `code`
      // is where the real diagnosis lives; `error.code` is the fallback for a
      // throw that carried no cause. Both reads are narrowed rather than
      // assumed, so a non-object throw answers `undefined` for each and falls
      // through to the `message` test below instead of matching a code by luck.
      const cause = thrownFlag(error, 'cause')
      const code = thrownFlag(cause, 'code') ?? thrownFlag(error, 'code') ?? ''
      if (
        code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' ||
        code === 'ENOTFOUND' || code === 'UND_ERR_SOCKET' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' ||
        String(thrownFlag(error, 'message') ?? '').includes('fetch failed')
      ) {
        // Prefer the cause's own message — it names the socket failure — and
        // fall back to the wrapper's when the throw carried no usable cause.
        const detail = errorMessage(cause) !== '' ? errorMessage(cause) : describeThrown(error)
        throw new QueueRejection(0, `network: ${detail}`)
      }
      // A bare `TypeError` used to land in that list, on the theory that undici
      // wraps transport failures in one. It does not: `TypeError` is also what a
      // malformed URL or an illegal header value throws, so a plain coding bug
      // was retried as though the network were flaky — silently, for the whole
      // budget. Only the transport-shaped ones are retried now; everything else
      // propagates and is reported as itself.
      throw error
    }

    if (!response.ok) {
      const text = (await response.text()).slice(0, 500)

      // Transient HTTP failures (429, 5xx) are safe to retry before the first
      // frame: the caller has seen no output yet. Honour a `Retry-After` hint
      // when present; otherwise let the escalation ladder in `queueWaitFor`
      // take over.
      if (response.status === 429 || response.status >= 500) {
        let retryAfter = 0
        const header = response.headers.get('retry-after')
        if (header !== null) {
          const seconds = Number(header)
          if (Number.isFinite(seconds) && seconds > 0) {
            retryAfter = seconds
          } else {
            // `Retry-After` may be an HTTP date.
            const date = Date.parse(header)
            if (Number.isFinite(date)) {
              retryAfter = Math.max(0, Math.ceil((date - Date.now()) / 1000))
            }
          }
        }
        throw new QueueRejection(retryAfter, `HTTP ${response.status} — ${text}`)
      }

      // A non-2xx reply carries the same nested envelope as an in-band error
      // frame, so it is unwrapped the same way: the outer status is often a
      // bare 403 whose real meaning (`10605`, queued) lives two JSON strings
      // deeper.
      const failure = readFailure({ code: String(response.status), message: text }, String(response.status))
      if (failure === undefined) {
        throw new Error(`Qoder chat failed: HTTP ${response.status} ${response.statusText} — ${text}`)
      }
      // A spent daily allowance on the non-2xx path. Ahead of the queue branch
      // for the same reason as in the frame path: it carries queue markers and a
      // multi-hour hint, and it must not become a sleep.
      if (failure.kind === 'daily-limit') throw new DailyLimitRejection(failure.detail, failure.retryAfterSeconds)
      if (failure.kind === 'rate-limit') throw new QueueRejection(failure.retryAfterSeconds, failure.detail)
      const message = failureMessage(failure, region, response.status, response.statusText)
      // Same reasoning as the frame path above.
      if (failure.kind === 'sign-in-expired') throw new SignInExpiredError(message)
      throw new Error(message)
    }
    // A 200 that claims a document content-type is the endpoint answering with
    // something other than the SSE stream: an SSO/HTML page, a JSON error
    // document, a non-streaming answer to a `stream: true` request. Left to
    // the frame reader, every one of those surfaces as an "empty response"
    // that names nothing about why. The check stays narrow on purpose — only
    // the content types the documented drift modes arrive as are triaged; an
    // absent header or an event-stream one passes untouched, and the frame
    // probe below is the second half of the same verdict.
    const contentType = response.headers.get('content-type') ?? ''
    if (/json|html|xml/i.test(contentType)) {
      throw new ProtocolShapeChangedError(
        `chat answered \`200 ${contentType}\` where \`text/event-stream\` was expected`,
      )
    }
    if (response.body === null) throw new Error('Qoder chat returned no body')
    return response
  }

  // Qoder queues rather than rejecting, and tells us how long to wait. That wait
  // belongs here, not in DSH's retry loop: DSH's policy is fixed (5 attempts,
  // 500 ms doubling to 10 s, ignoring the hint) and its budget is often shorter
  // than the queue. Waiting internally also keeps the turn alive, so the user
  // does not have to send the message again and restart it.
  let waitedMs = 0
  for (let attempt = 1; ; attempt++) {
    let stream
    let first
    // Everything this attempt costs — the handshake, the first frame, and any
    // retry delay — is charged to the budget, not just the delay. Counting only
    // the sleep is what made the budget decorative: a slow-but-progressing
    // attempt could spend unbounded time without ever exhausting it.
    const attemptStartedAt = Date.now()
    try {
      stream = readFrames(await openAttempt(), shapeProbe)
      // Pull the first frame before committing to a response, so a queue
      // rejection surfaces here rather than mid-stream where it could not be
      // retried without duplicating output.
      first = await stream.next()
    } catch (error) {
      waitedMs += Date.now() - attemptStartedAt
      const queueWaitMs = queueWaitFor(error, waitedMs, attempt)
      if (queueWaitMs === undefined) throw error
      // The caller aborted while we were deciding, so stop rather than sleep.
      if (signal?.aborted) throw error
      await sleep(queueWaitMs, signal)
      waitedMs += queueWaitMs
      continue
    }
    waitedMs += Date.now() - attemptStartedAt

    if (first.done === true) {
      // The gateway accepted the request but yielded no usable frame. Two
      // shapes are kept apart, because their answers differ: a stream that
      // carried frames this build does not parse says the WIRE moved — a
      // renamed envelope, a new wrapper, an error shape this code does not
      // name — and that is the drift verdict the card's "update the plugin"
      // copy exists for; a stream that carried no data payloads at all is an
      // empty answer, not a defect of this build. Before the split, both
      // cases read as "empty response" and a changed protocol kept the turn
      // failing silently — the chat-side twin of the model-list freeze the
      // catalog path triages as `protocol-shape-changed`.
      if (shapeProbe.skipped > 0) {
        throw new ProtocolShapeChangedError(
          `${region.displayName} chat stream: ${shapeProbe.skipped} frame(s) this build does not parse; first: ${shapeProbe.sample ?? '(none kept)'}`,
        )
      }
      throw new Error(`${region.displayName} returned an empty response`)
    }

    // Once the first chunk is out the turn is committed — there is no going
    // back — so the remaining frames are forwarded as they arrive. The `finally`
    // covers the case where the consumer stops early (the shim aborts on client
    // disconnect): without it the upstream socket would stay open until the
    // gateway closed it on its own.
    try {
      yield first.value
      for (;;) {
        const step = await stream.next()
        if (step.done === true) break
        yield step.value
      }
    } finally {
      await stream.return(undefined).catch(() => {})
    }
    return
  }
}

/**
 * A queue rejection that can be waited out.
 *
 * `retryable` is what the shim reads to decide between a retryable status and a
 * hard failure, so this stays a plain `Error` carrying the same flags the shim
 * already understood.
 */
class QueueRejection extends Error {
  /** Always true: waiting can clear a queue. */
  retryable: boolean
  /** Seconds to wait before retrying. */
  retryAfterSeconds: number
  /** The upstream detail, in a form a human can act on. */
  upstreamDetail: unknown

  constructor(retryAfterSeconds: number, detail: unknown) {
    super(
      `Qoder is busy — the request was queued` +
        `${retryAfterSeconds > 0 ? ` (retry in ~${retryAfterSeconds}s)` : ''}`,
    )
    this.name = 'QueueRejection'
    this.retryable = true
    this.retryAfterSeconds = retryAfterSeconds
    this.upstreamDetail = detail
  }
}

/**
 * The account's daily billing allowance is spent.
 *
 * NOT a queue, and the difference is the whole point. The gateway sends this
 * one with a `Retry-After` measured in hours (7350 s in the report this class
 * was written from), so a classifier that only knows "retryable with a hint"
 * turns it into a multi-hour sleep: the user was told the request would be
 * retried, and no amount of waiting within the session changes the answer,
 * because the counter resets at the day boundary rather than draining.
 *
 * So it is a hard failure with an honest name. `retryable` is explicitly FALSE,
 * which is what stops both this plugin's own queue ladder and DSH's retry policy
 * from picking it up, and `resetAt` is what the UI can offer instead: "try again
 * after the day rolls over" rather than "try again in 7350 seconds".
 *
 * The message names the cause in the user's terms, because the upstream text
 * ("Billing daily count exceeded") is a billing term and the action is none of
 * billing's business — waiting, using the off-peak price, or claiming the daily
 * check-in.
 */
class DailyLimitRejection extends Error {
  /** Always false: waiting within the session cannot fix a daily limit. */
  retryable: boolean
  /** Marks this as a daily-limit (not queue) failure. */
  dailyLimit: boolean
  /** Seconds until the counter resets (from the gateway, else 0). */
  retryAfterSeconds: number
  /** The upstream detail, in a form a human can act on. */
  upstreamDetail: unknown

  constructor(detail: unknown, retryAfterSeconds = 0) {
    super(
      `Qoder's daily request allowance for this account is used up` +
        `${retryAfterSeconds > 0 ? ` — it resets in about ${Math.round(retryAfterSeconds / 3600)}h` : ''}. ` +
        'Waiting within the session will not help; the off-peak price (22:00–08:00 Asia/Shanghai) ' +
        'and the daily check-in both still work.',
    )
    this.name = 'DailyLimitRejection'
    this.retryable = false
    this.dailyLimit = true
    // Kept for the UI to show "resets at HH:MM" rather than a raw count.
    this.retryAfterSeconds = retryAfterSeconds
    this.upstreamDetail = detail
  }
}

/**
 * How long to wait before retrying a queue rejection, or `undefined` when it is
 * not a queue rejection or the wait budget is spent.
 *
 * The gateway's own `retryAfterSeconds` is the primary signal and is honoured
 * as given. It is not always accurate, though: a queue that keeps answering
 * "retry in 2s" for a minute would otherwise be polled every two seconds for the
 * whole budget, which is both rude and pointless. So once a few consecutive
 * rejections have shown the hint is not converging, the pause escalates
 * geometrically up to {@link QUEUE_WAIT_MAX_SLEEP_MS}.
 *
 * @param error - the rejection to judge.
 * @param waitedMs - time already spent waiting in this turn.
 * @param attempt - 1-based index of the attempt that was just rejected.
 * @returns the sleep in milliseconds, or `undefined` when the turn should stop
 *   retrying. Exported so the budget invariant ("never more than remains") is
 *   asserted against the real function rather than a copy of the arithmetic —
 *   the old clamp broke it in a way no reader of `streamChat` could see.
 */
export function queueWaitFor(error: unknown, waitedMs: number, attempt: number): number | undefined {
  if ((error as { retryable?: unknown } | null | undefined)?.retryable !== true) return undefined
  const remaining = QUEUE_WAIT_BUDGET_MS - waitedMs
  if (remaining <= 0) return undefined

  const hinted =
    Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds) > 0
      ? Number((error as { retryAfterSeconds?: unknown }).retryAfterSeconds) * 1000
      : QUEUE_WAIT_MIN_SLEEP_MS

  // Leave the first few attempts on the gateway's own advice; only start
  // backing off further once it is clear the hint is not clearing the queue.
  const GRACE_ATTEMPTS = 3
  const escalated =
    attempt > GRACE_ATTEMPTS
      ? QUEUE_WAIT_MIN_SLEEP_MS * 2 ** Math.min(attempt - GRACE_ATTEMPTS, 8)
      : 0

  const target = Math.max(hinted, escalated) * (0.75 + Math.random() * 0.5)
  // Clamp the target into [MIN, MAX] FIRST, then cap it at `remaining`.
  // The old shape — `Math.max(MIN, Math.min(target, MAX, remaining))` — put the
  // floor OUTSIDE the cap, so once the budget dropped below MIN_SLEEP the
  // function returned MIN_SLEEP regardless: a promise of "never wait past the
  // budget" that the code could not keep (measured: with 1 ms left it slept a
  // full 1000 ms). The floor belongs to the retry policy, not to the budget;
  // a sub-second last sleep is cheap and buys one more real attempt.
  const clamped = Math.max(QUEUE_WAIT_MIN_SLEEP_MS, Math.min(target, QUEUE_WAIT_MAX_SLEEP_MS))
  return Math.min(clamped, remaining)
}

/**
 * Build the readable sentence for a non-queue failure.
 *
 * Both parameters are the real shapes rather than `any`: `failure` is exactly
 * what {@link readFailure} returns (the only producer), and `region` is the
 * plugin's own `Region`. The `any` here meant the five field reads below —
 * including `failure.detail.length`, which throws on a non-string — were never
 * checked against the object that actually flows in.
 */
function failureMessage(
  failure: { kind: string; code: string; detail: string },
  region: Region,
  status?: number,
  statusText?: string,
) {
  if (failure.kind === 'sign-in-expired') {
    return (
      `${region.displayName} sign-in is no longer valid — open the ${region.displayName} app ` +
      `to sign in again, then restart DSH` +
      `${status !== undefined ? ` (HTTP ${status}: ${failure.detail})` : ` (upstream ${failure.code || 'error'}: ${failure.detail})`}`
    )
  }
  if (status === 401 || status === 403) {
    return (
      `${region.displayName} was refused by Qoder — check that this account can use this model ` +
      `(HTTP ${status}: ${failure.detail})`
    )
  }
  if (status !== undefined) {
    return `Qoder chat failed: HTTP ${status} ${statusText ?? ''} — ${failure.detail}`
  }
  return `Qoder upstream error${failure.code !== '' ? ` ${failure.code}` : ''}${failure.detail.length > 0 ? `: ${failure.detail}` : ''}`
}

/**
 * Parse a string that is expected to hold a JSON object, else `undefined`.
 */
function tryJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(trimmed)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Whether a value is a plain (non-array) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Unwrap the gateway's failure envelope to its deepest level.
 *
 * Qoder nests the real complaint instead of stating it once: an outer
 * transport code wraps a `message` that is itself a JSON *string*, which wraps
 * another code and message, and the queue descriptor sits at the bottom —
 *
 * ```
 * { code: "403",
 *   message: "{\"code\":\"10605\",
 *              \"message\":\"{\\\"isQueued\\\":false,\\\"retryAfterSeconds\\\":2,...}\"}" }
 * ```
 *
 * Reading only the first level therefore reports a bare `403` and hides both
 * the true code (`10605`) and the retry hint. The whole chain is walked here so
 * the deepest code — the one that names the actual problem — wins.
 *
 * @returns `{ code, detail }`, the most specific code and the most informative
 *   detail text found.
 */
function unwrapFailure(chunk: Record<string, unknown>): { code: string; detail: string } {
  let code = ''
  let detail = ''
  let node: Record<string, unknown> = chunk
  let descended = false

  for (let depth = 0; depth < 8; depth++) {
    if (!isPlainObject(node)) break
    const levelCode = node.errorCode ?? node.code
    // Both spellings occur in the wild: a quoted `"10605"` and a bare JSON
    // number. Normalising numbers keeps the code usable for the exact matches
    // downstream instead of silently falling through to `''`.
    if (typeof levelCode === 'string' && levelCode.length > 0) code = levelCode
    else if (typeof levelCode === 'number' && Number.isFinite(levelCode)) code = String(levelCode)
    const message = node.message ?? node.errorMessage
    if (typeof message === 'string' && message.length > 0) detail = message

    // The next level sits under `details`/`error`, or inside a `message`
    // string that is itself a JSON document.
    const nested = isPlainObject(node.details) ? node.details : isPlainObject(node.error) ? node.error : undefined
    const next = nested ?? (typeof message === 'string' ? tryJsonObject(message) : undefined)
    if (next === undefined) break
    node = next
    descended = true
  }

  // When the walk bottoms out on a payload object (the queue descriptor), that
  // object is far more useful than the JSON string that carried it.
  if (descended && isPlainObject(node) && typeof node.message !== 'string') {
    detail = JSON.stringify(node)
  }
  return { code, detail }
}

/**
 * Normalize a message list into what the Qoder endpoint accepts.
 *
 * Two vocabularies can arrive here and both must survive the trip:
 *
 * - **OpenAI shape**, which is what pi-ai actually sends through the shim:
 *   `tool_calls` on the assistant message and `role: "tool"` with a
 *   `tool_call_id` for the result. Dropping either would break the harness's
 *   tool loop on the second turn, which is the single most important thing
 *   this translation has to get right.
 * - **DSH shape** (`toolCall` content blocks, `toolResult` role), accepted so
 *   the function stays usable from a direct caller.
 *
 * Image parts become `image_url` parts carrying a data URL, which is the only
 * image form this endpoint accepts.
 *
 * @param messages - messages in either vocabulary.
 * @returns Qoder-shaped messages.
 */
export function toQoderMessages(messages: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const raw of messages as Array<Record<string, unknown>>) {
    const message = raw
    if (message === null || typeof message !== 'object') continue

    if (message.role === 'system' || message.role === 'developer') {
      // `developer` is OpenAI's newer name for the same thing, and pi-ai emits
      // it whenever a reasoning model's compat allows it. Qoder only knows
      // `system`, so the two collapse into one here. Dropping the role instead
      // (which is what an unhandled value used to do) left the request with no
      // system message at all, and the gateway answers that with a permanent
      // `403 {"code":"10605"}` on every retry.
      out.push({ role: 'system', content: textOf(message.content) })
      continue
    }

    if (message.role === 'user') {
      const parts = []
      let hasImage = false
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block?.type === 'text') parts.push({ type: 'text', text: block.text ?? '' })
          else if (block?.type === 'image_url' || block?.type === 'image') {
            // Two shapes reach this function and BOTH must survive:
            //
            // - `image_url` is what pi-ai's OpenAI-completions API actually puts
            //   on the wire through the shim (it maps every image block to
            //   `{ type: 'image_url', image_url: { url } }`), so this is the
            //   shape the harness really sends. Matching only `image` here made
            //   every attached image silently disappear on the way out.
            // - `image` with bytes is the DSH-native shape, kept so the function
            //   stays usable from a direct caller.
            const url = block.image_url?.url ?? (typeof block.data === 'string'
              ? `data:${block.mimeType ?? 'image/png'};base64,${block.data}`
              : undefined)
            if (url !== undefined) {
              hasImage = true
              parts.push({ type: 'image_url', image_url: { url } })
            }
          }
        }
      }
      out.push({ role: 'user', content: hasImage ? parts : textOf(message.content) })
      continue
    }

    if (message.role === 'assistant') {
      let text = ''
      const toolCalls = []

      // OpenAI shape: tool_calls sit on the message itself.
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          if (call == null || typeof call !== 'object') continue
          const id = call.id
          if (typeof id !== 'string' || id.length === 0) {
            throw new Error('toQoderMessages: assistant tool_call is missing an id; the tool loop cannot match the result back to it')
          }
          const name = call.function?.name ?? call.name
          if (typeof name !== 'string' || name.length === 0) {
            throw new Error(`toQoderMessages: assistant tool_call "${id}" has no function name; the gateway cannot dispatch it`)
          }
          toolCalls.push({
            id,
            type: 'function',
            function: {
              name,
              arguments:
                typeof call.function?.arguments === 'string'
                  ? call.function.arguments
                  : JSON.stringify(call.function?.arguments ?? call.arguments ?? {}),
            },
          })
        }
      }

      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block?.type === 'text') text += block.text ?? ''
          // DSH shape: tool calls are content blocks.
          else if (block?.type === 'toolCall') {
            const id = block.id
            if (typeof id !== 'string' || id.length === 0) {
              throw new Error('toQoderMessages: assistant toolCall block is missing an id; the tool loop cannot match the result back to it')
            }
            if (typeof block.name !== 'string' || block.name.length === 0) {
              throw new Error(`toQoderMessages: toolCall "${id}" has no function name; the gateway cannot dispatch it`)
            }
            toolCalls.push({
              id,
              type: 'function',
              function: { name: block.name, arguments: JSON.stringify(block.arguments ?? {}) },
            })
          }
        }
      } else {
        text = textOf(message.content)
      }

      // An assistant turn that only called tools carries no content; the
      // endpoint rejects a null content field, so an empty string is sent.
      // Typed as the element of `out` rather than `any`: `content` is a string
      // and `tool_calls` is a real array, so both assignments are checked.
      const entry: Record<string, unknown> = { role: 'assistant', content: text }
      if (toolCalls.length > 0) entry.tool_calls = toolCalls
      out.push(entry)
      continue
    }

    if (message.role === 'toolResult' || message.role === 'tool') {
      const toolCallId = message.toolCallId ?? message.tool_call_id
      if (typeof toolCallId !== 'string' || toolCallId.length === 0) {
        throw new Error('toQoderMessages: tool result message is missing tool_call_id; it cannot be linked to the calling assistant turn')
      }
      out.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: textOf(message.content),
      })
    }
  }
  return out
}

/** Flatten a DSH content value into plain text. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content as Array<{ type?: unknown; text?: unknown }>) {
    if (block?.type === 'text') text += typeof block.text === 'string' ? block.text : ''
  }
  return text
}

/**
 * Normalize tool definitions into the endpoint's function schema.
 *
 * pi-ai hands the shim tools that are already OpenAI-shaped
 * (`{ type: "function", function: { name, description, parameters } }`), so the
 * common case is a pass-through. A bare DSH descriptor (`{ name, description,
 * parameters }`) is also accepted and wrapped, which keeps this usable from a
 * direct caller as well.
 *
 * @param tools - tool descriptors in either shape.
 * @returns OpenAI-shaped tool entries.
 */
export function toQoderTools(tools: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(tools)) return []
  // One tool, in either of the two vocabularies described above. Declared
  // loosely on purpose: the branches below narrow it field by field, and a
  // closed shape here would just be a claim about pi-ai's internals — see the
  // note on peer types in `domain.ts`.
  type ToolDescriptor = {
    function?: { name?: unknown; description?: unknown; parameters?: unknown }
    name?: unknown
    description?: unknown
    parameters?: unknown
  }
  return (tools as ToolDescriptor[]).map((tool, index) => {
    if (tool?.function != null && typeof tool.function === 'object') {
      const name = tool.function.name
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error(`toQoderTools: tool at index ${index} has no function name; the gateway cannot register it`)
      }
      return {
        type: 'function',
        function: {
          name,
          description: tool.function.description ?? '',
          parameters: tool.function.parameters ?? { type: 'object', properties: {} },
        },
      }
    }
    const name = tool?.name
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`toQoderTools: tool at index ${index} has no name; the gateway cannot register it`)
    }
    return {
      type: 'function',
      function: {
        name,
        description: tool?.description ?? '',
        parameters: tool?.parameters ?? { type: 'object', properties: {} },
      },
    }
  })
}
