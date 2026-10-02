/**
 * Guard the registration gate of the card's `__save` route.
 *
 * Run: node --test test/save-route-wiring.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `src/host/index.ts` cannot be imported by a test (it pulls in the Cordis
 * peer dependencies) — the registered gap docs/KNOWN_GAPS.md item 2（`RegionRuntime`
 * 本身与 `activate` 的 Cordis 接线）. The defect this pins is docs/issues/06:
 * when the route was registered under `ctx.inject(['webServer','settings'])`
 * it never mounted without the settings service, so a client saw a **404** and
 * fell into an unverified settings-scope snapshot, which then showed a false
 * "已保存". The fix gates the route on `webServer` **alone**, so it is present
 * whether or not `settings` exists and answers the service-absent case a **503**
 * the client can read.
 *
 * The verdict itself (`saveFieldOutcome`) is exercised for real in
 * test/settings-save.test.js. What that file cannot see is WHERE the route
 * sits: re-adding `'settings'` to the gate makes the 503 unreachable again,
 * and every unit test stays green. So, like test/account-route-wiring.test.js,
 * the wiring is asserted as source text.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = readFileSync(join(root, 'src', 'host', 'index.ts'), 'utf8')

/**
 * The `ctx.inject([...])` gate whose callback registers `path: QODER_SAVE_PATH`.
 *
 * The `webServer.register({ … path: QODER_SAVE_PATH … })` call sits inside
 * exactly one `ctx.inject(…)` callback, so the gate is the nearest `ctx.inject(`
 * that precedes the route's `path:` line.
 */
function saveRouteDeps() {
  const atPath = HOST.indexOf('path: QODER_SAVE_PATH')
  assert.notStrictEqual(atPath, -1, 'src/host/index.ts no longer registers the __save route')
  const before = HOST.slice(0, atPath)
  const gates = [...before.matchAll(/ctx\.inject\(\s*\[([^\]]*)\]/g)]
  assert.ok(gates.length > 0, 'the __save route is no longer inside a ctx.inject gate')
  const deps = gates.at(-1)[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"`]|['"`]$/g, ''))
    .filter((s) => s !== '')
  return { deps }
}

test('the __save route is gated on webServer ALONE', () => {
  const { deps } = saveRouteDeps()
  assert.deepStrictEqual(
    deps,
    ['webServer'],
    `the __save route must sit under inject(['webServer']) so it mounts whether or not ` +
      `the settings service exists; found [${deps.join(', ')}]. Re-gating it on 'settings' ` +
      `re-introduces the false-"已保存": without the service the route stops registering, ` +
      `the client gets a 404, and the service-absent 503 the client reads becomes unreachable.`,
  )
})

test('the __save handler delegates its verdict to the testable saveFieldOutcome', () => {
  // If the 503 logic is inlined back into the handler instead of calling the
  // extracted function, the settings-save.test.js coverage silently stops
  // applying. This pins the boundary, the way account-route-wiring pins the
  // payload builder.
  const atPath = HOST.indexOf('path: QODER_SAVE_PATH')
  const handler = HOST.slice(atPath, atPath + 1600)
  assert.match(
    handler,
    /saveFieldOutcome\(/,
    'the __save handler must delegate to src/host/settings-save.ts saveFieldOutcome, which a test can import',
  )
  assert.doesNotMatch(
    handler,
    /settings === undefined \)\s*\{[\s\S]*?sendJson\(res, 503/,
    'the service-absent 503 must live in saveFieldOutcome, not be inlined back into the handler',
  )
})
