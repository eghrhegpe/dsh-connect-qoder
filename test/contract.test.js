/**
 * Frontend-backend contract test.
 *
 * The client (`src/client/`) and host (`src/host/`) halves — both TypeScript —
 * must agree on two things:
 *
 * 1. **Route paths** — the client's `paths.ts` defines the paths it fetches;
 *    the host's `index.ts` registers them. A mismatch is a silent 404.
 * 2. **Settings field names** — the client's `settings-write.ts` posts fields
 *    to `__save`; the host's `settings-save.ts` whitelists them. A mismatch
 *    is a silent 400.
 *
 * This test reads both source files as text and extracts the constants. It
 * does not import either (the host pulls in the Cordis peer dependencies, so
 * it cannot be imported by a test), so it checks the declarations rather than
 * the runtime values.
 *
 * Every extraction is required to prove it extracted something (`requireExtracted`)
 * before two sides are compared: a regex that stops matching returns `undefined`
 * on both sides, and `assert.strictEqual(undefined, undefined)` would pass with
 * zero evidence. A broken anchor must turn red, never silently agree.
 *
 * Run: node --test test/contract.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Read a source file as text. */
const read = (path) => readFileSync(join(root, path), 'utf8')

/** Extract a string constant from source: `export const NAME = "value";` */
const extractString = (source, name) => {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`)
  const match = re.exec(source)
  return match === null ? undefined : match[1]
}

/** Extract all string values matching a prefix from an object literal. */
const extractObjectKeys = (source, name) => {
  const re = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\{([^}]+)\\}`, 's')
  const match = re.exec(source)
  if (match === null) return undefined
  const keys = []
  for (const m of match[1].matchAll(/(\w+)\s*:/g)) keys.push(m[1])
  return keys
}

/**
 * Prove an extraction actually extracted something.
 *
 * The guard-liveness lesson that cost a sibling plugin a CI failure: a
 * text-parser whose regex stops matching returns `undefined` on BOTH sides,
 * and `assert.strictEqual(undefined, undefined)` passes with zero evidence —
 * the client and host can drift apart forever while the guard stays green.
 * Every extraction below therefore proves it found its anchor, so a renamed
 * constant or a restructured declaration turns red with a readable message
 * instead of silently agreeing.
 */
const requireExtracted = (value, what) => {
  assert.ok(
    value !== undefined && value !== null,
    `could not extract \`${what}\` from its source — the anchor changed or the regex no longer matches. ` +
      'Fix the extractor; do not let this comparison pass silently.',
  )
  return value
}

// --- Route paths ----------------------------------------------------------

const clientPaths = read('src/client/paths.ts')
const hostIndex = read('src/host/index.ts')

test('route paths: client and host agree on the model route', () => {
  const client = requireExtracted(extractString(clientPaths, 'QODER_MODELS_PATH'), 'QODER_MODELS_PATH in src/client/paths.ts')
  const host = requireExtracted(extractString(hostIndex, 'QODER_MODELS_PATH'), 'QODER_MODELS_PATH in src/host/index.ts')
  assert.strictEqual(client, host, `model route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the usage route', () => {
  const client = requireExtracted(extractString(clientPaths, 'QODER_USAGE_PATH'), 'QODER_USAGE_PATH in src/client/paths.ts')
  const host = requireExtracted(extractString(hostIndex, 'QODER_USAGE_PATH'), 'QODER_USAGE_PATH in src/host/index.ts')
  assert.strictEqual(client, host, `usage route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the account route', () => {
  const client = requireExtracted(extractString(clientPaths, 'QODER_ACCOUNT_PATH'), 'QODER_ACCOUNT_PATH in src/client/paths.ts')
  const host = requireExtracted(extractString(hostIndex, 'QODER_ACCOUNT_PATH'), 'QODER_ACCOUNT_PATH in src/host/index.ts')
  assert.strictEqual(client, host, `account route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the account reload route', () => {
  const client = requireExtracted(extractString(clientPaths, 'QODER_ACCOUNT_RELOAD_PATH'), 'QODER_ACCOUNT_RELOAD_PATH in src/client/paths.ts')
  const host = requireExtracted(extractString(hostIndex, 'QODER_ACCOUNT_RELOAD_PATH'), 'QODER_ACCOUNT_RELOAD_PATH in src/host/index.ts')
  assert.strictEqual(client, host, `account reload route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the account confirm route', () => {
  const client = requireExtracted(extractString(clientPaths, 'QODER_ACCOUNT_CONFIRM_PATH'), 'QODER_ACCOUNT_CONFIRM_PATH in src/client/paths.ts')
  const host = requireExtracted(extractString(hostIndex, 'QODER_ACCOUNT_CONFIRM_PATH'), 'QODER_ACCOUNT_CONFIRM_PATH in src/host/index.ts')
  assert.strictEqual(client, host, `account confirm route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the checkin route', () => {
  const client = requireExtracted(extractString(clientPaths, 'QODER_CHECKIN_PATH'), 'QODER_CHECKIN_PATH in src/client/paths.ts')
  const host = requireExtracted(extractString(hostIndex, 'QODER_CHECKIN_PATH'), 'QODER_CHECKIN_PATH in src/host/index.ts')
  assert.strictEqual(client, host, `checkin route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the save route', () => {
  // The save route is hardcoded in settings-write.ts as a fetch URL.
  const clientMatch = /fetch\(["']([^"']+)["']/.exec(clientWrite)
  assert.ok(clientMatch !== null, 'settings-write.ts no longer fetches the save endpoint — the route contract has lost its anchor')
  const client = clientMatch[1]
  const host = requireExtracted(extractString(hostIndex, 'QODER_SAVE_PATH'), 'QODER_SAVE_PATH in src/host/index.ts')
  assert.strictEqual(client, host, `save route mismatch: client="${client}" host="${host}"`)
})

// --- Settings field names ---------------------------------------------------

const clientWrite = read('src/client/settings-write.ts')
const hostSave = read('src/host/settings-save.ts')

test('settings fields: client and host agree on the field names', () => {
  // The client posts fields by string literal; the host whitelists them.
  // Extract both sets and compare.
  const clientFields = []
  for (const m of clientWrite.matchAll(/field\s*===\s*["'](\w+)["']/g)) clientFields.push(m[1])
  // Deduplicate while preserving order.
  const clientUnique = [...new Set(clientFields)]
  // Both sides must have produced evidence before they are compared — an empty
  // set on each side agrees vacuously, which is the silent-pass failure mode
  // this file exists to rule out (see requireExtracted).
  assert.ok(clientUnique.length > 0, 'no settings field comparisons found in settings-write.ts — the guard has nothing to check')
  const hostKeys = requireExtracted(extractObjectKeys(hostSave, 'SAVE_FIELDS') ?? [], 'SAVE_FIELDS in src/host/settings-save.ts')
  assert.ok(hostKeys.length > 0, 'SAVE_FIELDS extracted as an empty object — the extractor or the declaration changed')
  // The client references fields in comparisons; the host declares them all.
  // Every field the client checks must be in the host's whitelist.
  for (const field of clientUnique) {
    assert.ok(
      hostKeys.includes(field),
      `client checks field "${field}" but it is not in SAVE_FIELDS [${hostKeys.join(', ')}]`,
    )
  }
})

// --- Plugin namespace --------------------------------------------------------

test('namespace: host defines the expected settings namespace', () => {
  // The host's QODER_SETTINGS_NS is the authoritative namespace. The client
  // hardcodes "dsh-connect-qoder" in its fetch URLs (settings-write.ts) and
  // card registration (card.tsx). A future refactor could extract a shared
  // constant, but for now this test pins the host's value so a rename fails.
  const hostNs = requireExtracted(extractString(hostIndex, 'QODER_SETTINGS_NS'), 'QODER_SETTINGS_NS in src/host/index.ts')
  assert.strictEqual(hostNs, 'dsh-connect-qoder', 'host namespace must be dsh-connect-qoder')
})

// --- Guard liveness (negative control) ---------------------------------------

test('guard liveness: a broken anchor turns red instead of passing silently', () => {
  // Replays the silent-pass failure mode this file used to have: rename the
  // anchor constant in memory on BOTH sides. The old code extracted
  // `undefined` from each and compared `undefined === undefined` — green, with
  // the routes free to drift apart. requireExtracted must make the same
  // scenario throw.
  const broken = read('src/client/paths.ts').replaceAll('QODER_MODELS_PATH', 'RENAMED_MODELS_PATH')
  assert.throws(
    () => requireExtracted(extractString(broken, 'QODER_MODELS_PATH'), 'QODER_MODELS_PATH'),
    /could not extract/,
  )
})
