/**
 * Tests that every place spelling this plugin's identity agrees.
 *
 * Run: node --test test/plugin-identity.test.js
 *
 * WHY THIS EXISTS. The host keys the plugin's UI half on literal string
 * equality at two joins. First, client discovery (dsh-client-modules): the
 * Loader row's module specifier must equal the `name` field of the nearest
 * package.json, or the client bundle is skipped with no error, no warning and
 * no log line. Second, the bundle itself: the id it passes to
 * `__ModuleLoader__.load` must equal the name the host asks the module table
 * under, or the artifact executes, registers under a name nobody requested,
 * and the entry dies as "already executed without registering". The 0.3.0
 * scoped rename passed through both traps in sequence — the patch row and the
 * build script's header id were literals that the rename did not touch, and
 * each produced a silent, undiagnosable UI loss while the model channel kept
 * answering. A rename is a package.json edit; every other spelling must be
 * derived, and anything derived wrong should fail here rather than in someone
 * else's plugin manager.
 *
 * Nothing in this file hardcodes the current identity. It reads package.json
 * as the source of truth and asks each other place whether it agrees — which
 * is exactly the question the host will ask at boot.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The identity of record: package.json's `name`, nothing else. */
const pkgName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name
assert.ok(
  typeof pkgName === 'string' && pkgName.length > 0,
  'package.json must declare a name — the whole gate hangs on it',
)

/** The Loader row the cordis patch inserts, as `id`/`name` text. */
function patchRow(key) {
  const yml = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  // Accept quoted or bare scalars; the scoped '@' needs quoting in YAML, the
  // bare historical form did not, and both spellings mean the same string.
  const match = yml.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'))
  assert.ok(match, `cordis.patch.yml must declare the row ${key}`)
  return match[1].trim()
}

/** The id the shipped bundle registers itself under in the module table. */
function bundleLoaderId() {
  const bundle = readFileSync(join(root, 'lib/client.js'), 'utf8')
  const match = bundle.match(/__ModuleLoader__\.load\(\{\s*\n\s*id:\s*"([^"]+)"/)
  assert.ok(match, 'the bundle must self-register via __ModuleLoader__.load with an id')
  return match[1]
}

/** The bundle identities the client registers its config cards under. */
function cardRegistrationIdentities(source) {
  const list = source.match(/for \(const bundle of \[([^\]]+)\]/)
  assert.ok(list, 'the client must register its cards through the identity loop')
  return list[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter((entry) => entry.length > 0)
}

test('the cordis patch row names the plugin by its package name', () => {
  // The host compares this string to the manifest name to find the client
  // half. Bare-vs-scoped mismatch drops the UI silently.
  assert.equal(
    patchRow('name'),
    pkgName,
    'a rename that leaves the patch row behind kills the plugin card without any error',
  )
})

test('the shipped bundle registers under the package name', () => {
  // The module table is keyed by the same identity; a header literal from
  // before a rename executes under a name nobody asked for.
  assert.equal(
    bundleLoaderId(),
    pkgName,
    'lib/client.js carries a stale loader id — run npm run build',
  )
})

test('the card slots are registered under the current identity', () => {
  // The plugin-manager page gates the config section on
  // `ledger.bundles.has(pkg.name)`, and that ledger is these keys. A card
  // registered only under a former name is invisible even though apply ran.
  const source = readFileSync(join(root, 'src', 'client', 'index.ts'), 'utf8')
  assert.ok(
    cardRegistrationIdentities(source).includes(pkgName),
    'src/client/index.ts must keep the current package name among its card identities',
  )
  const built = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  assert.ok(
    cardRegistrationIdentities(built).includes(pkgName),
    'lib/client.js is stale against its source — run npm run build',
  )
})

test('the build script derives the loader id instead of hardcoding it', () => {
  // The one edit a rename should require is package.json. The wrapper header
  // reads it; the moment someone writes a literal back, this test says so.
  const script = readFileSync(join(root, 'scripts', 'build-client.mjs'), 'utf8')
  assert.match(
    script,
    /LOADER_ID\s*=\s*JSON\.parse\(readFileSync\(join\(root,\s*'package\.json'\)/,
    'build-client.mjs must read the loader id from package.json',
  )
  assert.doesNotMatch(
    script,
    /id:\s*"@?[\w/-]+",\s*\n?\s*'?\s*\\t?factory/m,
    'build-client.mjs must not hardcode a loader id literal in the bundle header',
  )
})
