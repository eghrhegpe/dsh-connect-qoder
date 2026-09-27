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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { classifyUpstreamError } from './errors.js'
import { windowIsOpen } from './offpeak.js'
import { toEpochMs } from './time.js'
import { checkinStateFrom } from './claim.js'

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
function sleep(ms, signal) {
  return new Promise((resolve) => {
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
function readFailure(chunk, fallbackCode = '') {
  if (chunk === null || typeof chunk !== 'object' || Array.isArray(chunk)) return undefined
  // A frame is only a failure if it carries identifying detail. Bare status or
  // keepalive frames (`{ success: true }`, `{ success: false }` with no code
  // and no message, plain arrays, etc.) must not kill the stream.
  const hasCode = chunk.code != null || chunk.errorCode != null
  const hasMessage =
    (typeof chunk.message === 'string' && chunk.message.length > 0) ||
    (typeof chunk.errorMessage === 'string' && chunk.errorMessage.length > 0)
  if (!hasCode && !hasMessage) {
    // No identifying fields at all. A `fallbackCode` (HTTP status) still
    // identifies the failure on the transport path; without it, this is not
    // an error frame.
    if (fallbackCode === '') return undefined
  }
  const { code, detail } = unwrapFailure(chunk)
  const effective = code !== '' ? code : fallbackCode
  const kind = classifyUpstreamError(chunk, effective, detail)
  return { kind: kind.kind, retryAfterSeconds: kind.retryAfterSeconds ?? 0, code: effective, detail }
}
/** Login protocol revision. */
const LOGIN_VERSION = 'v2'

/** Machine OS string, spelled the way the gateway expects. */
export const MACHINE_OS =
  process.platform === 'win32'
    ? process.arch === 'arm64'
      ? 'aarch64_windows'
      : 'x86_64_windows'
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

/** Positional translation table from standard to custom alphabet. */
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
 * Encode a request body the way the `Encode=1` flag requires.
 *
 * The transform is: base64 the bytes, translate each character through the
 * permuted alphabet, then rotate the string so the last third comes first and
 * the first third goes last.
 *
 * @param plaintext - the JSON body bytes.
 * @returns the encoded bytes to send as the request body.
 */
export function encodeBody(plaintext) {
  const bytes = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)
  const std = bytes.toString('base64')
  const n = std.length
  const third = Math.floor(n / 3)
  const out = Buffer.allocUnsafe(n)
  let dst = 0
  for (let i = n - third; i < n; i++) out[dst++] = ENCODE_TABLE[std.charCodeAt(i)]
  for (let i = third; i < n - third; i++) out[dst++] = ENCODE_TABLE[std.charCodeAt(i)]
  for (let i = 0; i < third; i++) out[dst++] = ENCODE_TABLE[std.charCodeAt(i)]
  return out
}

/** AES-128-CBC encrypt with the key doubling as the IV, base64-encoded. */
function aesEncryptCBCBase64(plaintext, keyString) {
  const key = Buffer.from(keyString)
  const cipher = crypto.createCipheriv('aes-128-cbc', key, key)
  return cipher.update(plaintext, 'utf8', 'base64') + cipher.final('base64')
}

/**
 * The path the signature covers: the request path with a leading `/algo`
 * stripped, because the gateway routes that prefix away before verifying.
 */
export function signaturePath(url) {
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
export function authHeaders(body, url, credential) {
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

  const machineID = credential.machineID
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
export function modelListUrl(region) {
  return `${region.baseUrl}algo/api/v2/model/list?Encode=1`
}

/** URL of the streaming chat endpoint. */
export function chatUrl(region) {
  return `${region.baseUrl}algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`
}

/** URL exchanging a personal access token for a job token. */
export function exchangeUrl(region) {
  return `${region.openApiUrl}/api/v1/jobToken/exchange`
}

/** URL returning the signed-in account's profile. */
export function userInfoUrl(region) {
  return `${region.openApiUrl}/api/v1/userinfo`
}

/** URL returning the account's quota usage. */
export function usageUrl(region) {
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
export function usagePresentationUrl(region) {
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
export function campaignsUrl(region) {
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
export function openApiHeaders(credential, region) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${credential.token}`,
    'Cosy-ClientType': '10',
    'User-Agent': 'Qoder',
    ...umidHeadersFor(region),
  }
}

/** One cached umid read per process: the binary is slow enough to matter, cheap enough to run once. */
let umidInfo

/**
 * Test seam: a global function, when present, replaces the binary read
 * (`execFileSync` + `existsSync` + `JSON.parse`) and the per-process cache.
 * Production never sets it; the unit test sets it so every branch of the
 * umid path is reachable without a real install. The probe returns the
 * parsed block, `null`, `undefined`, a partial object, or throws — the
 * header builder must treat all of those as "no block" rather than crash.
 */
function umidProbe() {
  return globalThis.__dshQoderUmidProbe
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
function umidHeadersFor(region) {
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
function normalizeUmidBlock(answer) {
  if (typeof answer?.machineToken !== 'string' || answer.machineToken.length === 0) return null
  if (typeof answer?.machineType !== 'string' || answer.machineType.length === 0) return null
  if (typeof answer?.machineCode !== 'string' || answer.machineCode.length === 0) return null
  return { machineToken: answer.machineToken, machineType: answer.machineType, machineCode: answer.machineCode }
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
function readUmidInfo(region) {
  // The test seam stands in for the whole binary read: a probe that answers
  // `null` models "the binary is absent on this machine", which is the
  // production behaviour on a CN-only install or a CI runner.
  const probe = globalThis.__dshQoderUmidProbe
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
      const info = JSON.parse(output)
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
 */
function umidRootsFor(region) {
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData === undefined) return []
  const programs = join(localAppData, 'Programs')
  const roots = [
    join(programs, 'Qoder', '.qoder-versions', '0.4.3'),
    join(programs, 'Qoder'),
  ]
  if (region?.id === 'qoder-cn') roots.push(join(programs, 'QoderCN'))
  return roots
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
async function readJson(response, context) {
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
 * @returns the parsed campaigns document.
 */
export async function readCampaigns(region, credential, signal) {
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
export function projectCampaignRows(payload) {
  const list = Array.isArray(payload?.campaigns) ? payload.campaigns : []
  const rows = []
  for (const campaign of list) {
    if (campaign === null || typeof campaign !== 'object') continue
    const placements = Array.isArray(campaign?.placements) ? campaign.placements : []
    const usage = placements.find((entry) => entry?.type === 'USAGE')
    if (usage === undefined) continue
    // The panel is bilingual; prefer the Simplified Chinese copy to match the
    // rest of this card, and fall back to English when only that exists.
    const content = usage.content?.zh ?? usage.content?.['zh-CN'] ?? usage.content?.en ?? {}
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

export async function fetchCampaigns(region, credential, signal) {
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
export function claimCampaignUrl(region, campaignId) {
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
 * @returns the parsed claim response.
 */
export async function claimCampaign(region, credential, campaignId, signal) {
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

/** Coerce one quota bucket into `{ total, used, remaining, percentage, unit }`. */
function normalizeQuotaBucket(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const total = Number(value.total)
  const used = Number(value.used)
  if (!Number.isFinite(total) || total <= 0) return undefined
  const safeUsed = Number.isFinite(used) ? Math.max(0, used) : 0
  const remainingRaw = Number(value.remaining)
  const remaining = Number.isFinite(remainingRaw) ? Math.max(0, remainingRaw) : Math.max(0, total - safeUsed)
  const percentageRaw = Number(value.percentage)
  const percentage = Number.isFinite(percentageRaw)
    ? percentageRaw > 1
      ? percentageRaw / 100
      : percentageRaw
    : safeUsed / total
  return {
    total,
    used: safeUsed,
    remaining,
    percentage: Math.min(1, Math.max(0, percentage)),
    unit: typeof value.unit === 'string' && value.unit.length > 0 ? value.unit : 'credits',
  }
}

/**
 * Normalize one dedicated (per-model) resource package.
 *
 * These are the promotional allowances the IDE panel shows as e.g.
 * "Qwen3.8-Max 免费额度 1402 / 2000 次" — a package bound to a set of models
 * rather than to the account as a whole. Packages that declare no usable total
 * are dropped, matching the client's own filtering.
 */
function normalizeDedicatedPackage(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const total = Number(value.total)
  if (id === '' || !Number.isFinite(total) || total <= 0) return undefined
  const used = Number(value.used)
  const remainingRaw = Number(value.remaining)
  const safeUsed = Number.isFinite(used) ? Math.max(0, used) : 0
  const remaining = Number.isFinite(remainingRaw) ? Math.max(0, remainingRaw) : Math.max(0, total - safeUsed)
  const percentageRaw = Number(value.percentage)
  const percentage = Number.isFinite(percentageRaw)
    ? percentageRaw > 1
      ? percentageRaw / 100
      : percentageRaw
    : safeUsed / total
  const expiresAt = toEpochMs(value.expiresAt)
  return {
    id,
    name: typeof value.name === 'string' ? value.name : '',
    description: typeof value.description === 'string' ? value.description : '',
    total,
    used: safeUsed,
    remaining,
    percentage: Math.min(1, Math.max(0, percentage)),
    unit: typeof value.unit === 'string' && value.unit.length > 0 ? value.unit : 'credits',
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    available: value.available !== false,
  }
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
export async function fetchUsage(region, credential, signal) {
  const headers = openApiHeaders(credential, region)

  const read = async (url) => {
    const response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return readJson(response, 'Qoder usage')
  }

  let payload
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
  const usage = payload?.qoderUsage ?? payload?.data ?? payload
  if (usage === null || typeof usage !== 'object') return undefined

  const userQuota = normalizeQuotaBucket(usage.user_quota ?? usage.userQuota)
  const addOnQuota = normalizeQuotaBucket(usage.add_on_quota ?? usage.addOnQuota)
  const rawPackages = usage.dedicated_resource_packages ?? usage.dedicatedResourcePackages
  const dedicatedPackages = Array.isArray(rawPackages)
    ? rawPackages.map(normalizeDedicatedPackage).filter((entry) => entry !== undefined)
    : []

  // Campaigns are supplementary: the panel is still useful without them, so a
  // failure here must not cost the user their quota numbers. The same payload
  // answers whether there is a daily check-in to claim, so both are read from
  // this one round trip rather than two that could disagree.
  let campaigns = []
  let checkin
  try {
    const raw = await readCampaigns(region, credential, signal)
    campaigns = projectCampaignRows(raw)
    checkin = checkinStateFrom(raw)
  } catch (error) {
    if (signal?.aborted) throw error
  }

  const expiresAt = toEpochMs(usage.expires_at ?? usage.expiresAt)
  const isQuotaExceeded = usage.is_quota_exceeded ?? usage.isQuotaExceeded

  // Nothing usable at all is reported as "no data" so the card can say so
  // instead of rendering an empty panel.
  if (userQuota === undefined && addOnQuota === undefined && dedicatedPackages.length === 0) return undefined

  return {
    displayMode: typeof payload?.displayMode === 'string' ? payload.displayMode : 'qoder',
    userType: String(usage.user_type ?? usage.userType ?? ''),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    upgradeUrl: String(usage.upgrade_url ?? usage.upgradeUrl ?? ''),
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
 * Fetch and normalize the account's model catalog.
 *
 * The response is grouped by product surface (`chat`, `developer`, `quest`,
 * ...). The `chat` group is the one that answers on the `agent_common` route,
 * so only it is used.
 *
 * @returns an array of `{ key, name, isVL, isReasoning, maxInputTokens, ... }`.
 */
export async function fetchModels(region, credential, signal) {
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
  const chat = data?.chat
  if (chat === null || typeof chat !== 'object') return []
  const models = []
  for (const entry of Object.values(chat)) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.key !== 'string' || entry.key.length === 0) continue
    if (entry.enable === false) continue
    if (typeof entry.display_name !== 'string' || entry.display_name.length === 0) continue
    const config = entry.thinking_config
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
    // (`{ "1M": {...}, "200K": { is_default: true }, ... }`) and publishes no
    // output ceiling anywhere. Both facts matter downstream:
    //
    // - `context_config` is the only place the offered window sizes exist, and
    //   the entry flagged `is_default` is the one the app itself starts on, so
    //   these become the choices the model picker can offer.
    // - No output ceiling is reported on purpose. Declaring one makes
    //   dsh-llm-pi-ai record it as the model's *configured* max tokens, and a
    //   long reasoned reply then ends with `finish: max-tokens` — the visible
    //   text is cut off mid-sentence. Leaving it undeclared lets the harness
    //   use its own default instead.
    const windows = entry.context_config
    const contextOptions = []
    let defaultContextWindow = 0
    if (windows !== null && typeof windows === 'object') {
      for (const value of Object.values(windows)) {
        const tokens = Number(value?.token_count)
        if (!Number.isFinite(tokens) || tokens <= 0) continue
        contextOptions.push(tokens)
        if (value?.is_default === true) defaultContextWindow = tokens
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
      priceFactor: Number(entry.price_factor) || 0,
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
export function normalizePromotion(value, now = new Date()) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const discountFactor = Number(value.discount_factor)
  const before = Number(value.before_promotion_price_factor)
  const windowStart = typeof value.window_start === 'string' ? value.window_start : ''
  const windowEnd = typeof value.window_end === 'string' ? value.window_end : ''
  const hasWindow = /^\d{2}:\d{2}$/.test(windowStart) && /^\d{2}:\d{2}$/.test(windowEnd)
  if (!Number.isFinite(discountFactor) && !Number.isFinite(before) && !hasWindow) return undefined
  const timezone = typeof value.timezone === 'string' && value.timezone.length > 0 ? value.timezone : 'Asia/Shanghai'
  // The catalog is bilingual; prefer the Simplified Chinese copy to match the
  // rest of the card, falling back to English when only that is present.
  const pick = (field) => {
    const source = value[field]
    if (source === null || typeof source !== 'object') return ''
    const text = source.zh ?? source['zh-CN'] ?? source.en
    return typeof text === 'string' ? text : ''
  }
  // `true` is on at any hour; `false` is re-read against the window above; an
  // absent or non-boolean flag keeps the old strict read (off) — there is
  // nothing here to reinterpret, and guessing campaigns into existence is
  // worse than staying quiet. Without a parseable window there is no clock to
  // re-read against either, so those falses also stand as reported.
  const active = value.active === true
    || (value.active === false && hasWindow && !windowIsOpen(windowStart, windowEnd, timezone, now))
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
export async function exchangePat(region, pat, signal) {
  const response = await fetch(exchangeUrl(region), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ personal_access_token: pat }),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Qoder PAT exchange failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
  }
  const data = await readJson(response, 'Qoder PAT exchange')
  const token = data?.token ?? data?.job_token ?? data?.jobToken
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Qoder PAT exchange returned no token')
  }
  return {
    token,
    refreshToken: typeof data?.refresh_token === 'string' ? data.refresh_token : '',
    expiresAt: toEpochMs(data?.expires_at) ?? (Date.now() + 3600_000),
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
export async function fetchUserInfo(region, credential, signal) {
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
  const body = data?.data ?? data
  return {
    userID: String(body?.id ?? body?.user_id ?? ''),
    name: String(body?.name ?? body?.nickname ?? ''),
    email: String(body?.email ?? ''),
  }
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
export async function* streamChat(region, credential, request, signal) {
  const model = request.model
  const recordID = crypto.randomUUID()
  const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')
  const lastText = typeof lastUser?.content === 'string' ? lastUser.content : ''

  // A model that always thinks answers `enable_thinking: false` with a
  // `provider_error` (1210) instead of a completion, so the flag is left off
  // for those and thinking is only ever requested positively.
  //
  // `max_tokens` is forwarded only when the caller actually specifies one. The
  // harness sizes its request from the model's declared ceiling, and this
  // plugin deliberately declares none, so inventing a number here would
  // reintroduce the very truncation that omission avoids: reasoning and the
  // answer share this budget upstream, so an over-large value is not harmless
  // and an absent one lets Qoder apply its own.
  const parameters = {}
  if (Number.isSafeInteger(request.maxTokens) && request.maxTokens > 0) {
    parameters.max_tokens = request.maxTokens
  }
  if (request.enableThinking === true) {
    parameters.enable_thinking = true
    if (typeof request.reasoningEffort === 'string' && request.reasoningEffort.length > 0) {
      parameters.reasoning_effort = request.reasoningEffort
    }
  } else if (request.alwaysThinking !== true) {
    parameters.enable_thinking = false
  }

  const body = {
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

  /**
   * Open one attempt and hand back its frame stream.
   *
   * Nothing is yielded until the first frame arrives, so a queue rejection
   * raised here is still safe to retry: the caller has seen no output yet.
   */
  async function* readFrames(response) {
    const reader = response.body.getReader()
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
          // frames carry the chunk inline, so both shapes are accepted.
          let envelope
          try {
            envelope = JSON.parse(payload)
          } catch {
            continue
          }
          let chunk = envelope
          if (typeof envelope?.body === 'string') {
            try {
              chunk = JSON.parse(envelope.body)
            } catch {
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
          // with an empty assistant turn, so it is raised instead.
          const failure = readFailure(chunk)
          if (failure === undefined) continue
          if (failure.kind === 'rate-limit') {
            // Retryable: the caller waits it out and re-sends, so this is not
            // reported as a rejection.
            throw new QueueRejection(failure.retryAfterSeconds, failure.detail)
          }
          const message = failureMessage(failure, region)
          const error = new Error(message)
          if (failure.kind === 'sign-in-expired') error.signInExpired = true
          throw error
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
      'X-Model-Key': model,
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
        body: bodyBytes,
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
      const cause = error?.cause
      const code = cause?.code ?? error?.code ?? ''
      if (
        code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' ||
        code === 'ENOTFOUND' || code === 'UND_ERR_SOCKET' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' ||
        error?.message?.includes?.('fetch failed')
      ) {
        throw new QueueRejection(0, `network: ${cause?.message ?? error?.message ?? error}`)
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
      if (failure.kind === 'rate-limit') throw new QueueRejection(failure.retryAfterSeconds, failure.detail)
      const message = failureMessage(failure, region, response.status, response.statusText)
      const error = new Error(message)
      if (failure.kind === 'sign-in-expired') error.signInExpired = true
      throw error
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
      stream = readFrames(await openAttempt())
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
      // The gateway accepted the request but sent nothing usable. Treat it as an
      // empty turn rather than a queue rejection: it is not something waiting
      // will fix.
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
  constructor(retryAfterSeconds, detail) {
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
export function queueWaitFor(error, waitedMs, attempt) {
  if (error?.retryable !== true) return undefined
  const remaining = QUEUE_WAIT_BUDGET_MS - waitedMs
  if (remaining <= 0) return undefined

  const hinted =
    Number(error.retryAfterSeconds) > 0 ? Number(error.retryAfterSeconds) * 1000 : QUEUE_WAIT_MIN_SLEEP_MS

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

/** Build the readable sentence for a non-queue failure. */
function failureMessage(failure, region, status, statusText) {
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
function tryJsonObject(text) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(trimmed)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Whether a value is a plain (non-array) object. */
function isPlainObject(value) {
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
function unwrapFailure(chunk) {
  let code = ''
  let detail = ''
  let node = chunk
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
export function toQoderMessages(messages) {
  const out = []
  for (const message of messages) {
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
      const entry = { role: 'assistant', content: text }
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
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block?.type === 'text') text += block.text ?? ''
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
export function toQoderTools(tools) {
  if (!Array.isArray(tools)) return []
  return tools.map((tool, index) => {
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
