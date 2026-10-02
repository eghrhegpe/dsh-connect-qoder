/**
 * Negative control for test/contract.test.js's text extractors.
 *
 * The sibling plugin's §10/§39 lesson: a text-parser guard must have a
 * liveness guard ("who shouts when the guard itself dies"), or it can pass
 * with zero evidence. Here we take the REAL sources, break the anchor in
 * memory (rename the constant), and run the EXACT assertion contract.test.js
 * runs. If the real test would stay green while the route silently diverged,
 * the guard has no liveness.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// Copied verbatim from test/contract.test.js
const extractString = (source, name) => {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`)
  const match = re.exec(source)
  return match === null ? undefined : match[1]
}

// The real sources, with the anchor constant renamed in memory.
const clientPaths = read('src/client/paths.ts').replaceAll('QODER_MODELS_PATH', 'RENAMED_MODELS_PATH')
const hostIndex = read('src/host/index.ts').replaceAll('QODER_MODELS_PATH', 'RENAMED_MODELS_PATH')

const client = extractString(clientPaths, 'QODER_MODELS_PATH')
const host = extractString(hostIndex, 'QODER_MODELS_PATH')
console.log('[extracted] client=%s host=%s', String(client), String(host))

// The exact assertion from contract.test.js lines 53-57.
assert.strictEqual(client, host, `model route mismatch: client="${client}" host="${host}"`)
console.log('PASS (silent): the guard stays green even though both anchors are broken')
console.log('  -> client and host could disagree about the route forever and this test would not notice')
