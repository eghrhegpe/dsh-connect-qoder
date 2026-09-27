/**
 * Frontend-backend contract test.
 *
 * The client (TypeScript) and host (JavaScript) must agree on two things:
 *
 * 1. **Route paths** — the client's `paths.ts` defines the paths it fetches;
 *    the host's `index.js` registers them. A mismatch is a silent 404.
 * 2. **Settings field names** — the client's `settings-write.ts` posts fields
 *    to `__save`; the host's `settings-save.js` whitelists them. A mismatch
 *    is a silent 400.
 *
 * This test reads both source files as text and extracts the constants. It
 * does not import either (the client is TypeScript; the host has peer
 * dependencies), so it checks the declarations rather than the runtime values.
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

// --- Route paths ----------------------------------------------------------

const clientPaths = read('src/client/paths.ts')
const hostIndex = read('lib/index.js')

test('route paths: client and host agree on the model route', () => {
  const client = extractString(clientPaths, 'QODER_MODELS_PATH')
  const host = extractString(hostIndex, 'QODER_MODELS_PATH')
  assert.strictEqual(client, host, `model route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the usage route', () => {
  const client = extractString(clientPaths, 'QODER_USAGE_PATH')
  const host = extractString(hostIndex, 'QODER_USAGE_PATH')
  assert.strictEqual(client, host, `usage route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the account route', () => {
  const client = extractString(clientPaths, 'QODER_ACCOUNT_PATH')
  const host = extractString(hostIndex, 'QODER_ACCOUNT_PATH')
  assert.strictEqual(client, host, `account route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the account reload route', () => {
  const client = extractString(clientPaths, 'QODER_ACCOUNT_RELOAD_PATH')
  const host = extractString(hostIndex, 'QODER_ACCOUNT_RELOAD_PATH')
  assert.strictEqual(client, host, `account reload route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the account confirm route', () => {
  const client = extractString(clientPaths, 'QODER_ACCOUNT_CONFIRM_PATH')
  const host = extractString(hostIndex, 'QODER_ACCOUNT_CONFIRM_PATH')
  assert.strictEqual(client, host, `account confirm route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the checkin route', () => {
  const client = extractString(clientPaths, 'QODER_CHECKIN_PATH')
  const host = extractString(hostIndex, 'QODER_CHECKIN_PATH')
  assert.strictEqual(client, host, `checkin route mismatch: client="${client}" host="${host}"`)
})

test('route paths: client and host agree on the save route', () => {
  // The save route is hardcoded in settings-write.ts as a fetch URL.
  const clientMatch = /fetch\(["']([^"']+)["']/.exec(clientWrite)
  const client = clientMatch === null ? undefined : clientMatch[1]
  const host = extractString(hostIndex, 'QODER_SAVE_PATH')
  assert.strictEqual(client, host, `save route mismatch: client="${client}" host="${host}"`)
})

// --- Settings field names ---------------------------------------------------

const clientWrite = read('src/client/settings-write.ts')
const hostSave = read('lib/settings-save.js')

test('settings fields: client and host agree on the field names', () => {
  // The client posts fields by string literal; the host whitelists them.
  // Extract both sets and compare.
  const clientFields = []
  for (const m of clientWrite.matchAll(/field\s*===\s*["'](\w+)["']/g)) clientFields.push(m[1])
  // Deduplicate while preserving order.
  const clientUnique = [...new Set(clientFields)]
  const hostKeys = extractObjectKeys(hostSave, 'SAVE_FIELDS') ?? []
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
  // card registration (card.ts). A future refactor could extract a shared
  // constant, but for now this test pins the host's value so a rename fails.
  const hostNs = extractString(hostIndex, 'QODER_SETTINGS_NS')
  assert.strictEqual(hostNs, 'dsh-connect-qoder', 'host namespace must be dsh-connect-qoder')
})
