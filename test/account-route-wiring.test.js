/**
 * Guard the two call sites that decide how hard the plugin works to answer the
 * card's account panel.
 *
 * Run: node --test test/account-route-wiring.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `lib/index.js` cannot be imported by a test (it pulls in the Cordis peer
 * dependencies), which is a registered gap — docs/KNOWN_GAPS.md item 1（`adapter.js` 的 Cordis 接线与 profile 构造）and item 2（`RegionRuntime` 本身与 `activate` 的 Cordis 接线）. It is therefore possible to regress
 * the ROUTING of the credential read without any test going red, and that is
 * not hypothetical: dropping `{ cachedOnly: true }` from the render path was
 * measured to leave the whole suite green, while putting the plugin's 30 s
 * synchronous PowerShell unwrap back on every panel render.
 *
 * So the wiring is asserted as source text, the way `test/contract.test.js`
 * already asserts the client's route paths against the host's. It cannot prove
 * the handler runs; it proves the call the handler makes, which is the part
 * that was unguarded.
 *
 * The two sites pull in OPPOSITE directions and that is the whole point:
 *
 * - `GET /account` runs on every panel render, so it must read `cachedOnly`
 *   (never block the event loop on an unwrap);
 * - `POST /account/reload` is the user pressing "重读登录", so it must NOT be
 *   cached and must ignore the unwrap failure window — otherwise the button is
 *   a no-op exactly when someone has just re-signed-in.
 *
 * Getting either one wrong is silent: the first is a frozen UI, the second is
 * a button that does nothing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = readFileSync(join(root, 'lib', 'index.js'), 'utf8')

/** The body of one registered route handler, by its path constant. */
function handlerFor(pathConst) {
  const at = HOST.indexOf(`path: ${pathConst}`)
  assert.notStrictEqual(at, -1, `lib/index.js no longer registers a route for ${pathConst}`)
  // The handler is the first `handler:` after the path, and runs to the closing
  // of its registration block. A window is enough and is safer than trying to
  // match braces across the whole file.
  const start = HOST.indexOf('handler:', at)
  assert.notStrictEqual(start, -1, `${pathConst} has no handler`)
  return HOST.slice(start, start + 2600)
}

/**
 * The `readAccountState` call that answers a route.
 *
 * `GET /account` does not call it inline — it answers with `accountPayload()`,
 * which is the shared builder both the GET and the reload route use, and the
 * mode flags are decided where the state is READ rather than where it is
 * served. So the payload builder is the place the render path is pinned, and
 * the reload route separately.
 */
function payloadBuilder() {
  const at = HOST.indexOf('const accountPayload =')
  assert.notStrictEqual(at, -1, 'lib/index.js no longer builds an account payload')
  return HOST.slice(at, at + 1200)
}

test('the shared payload builder — the render path — reads the cached credential', () => {
  // The regression this file was written after: without the flag the panel
  // blocks the host event loop for up to 30 s on a machine that cannot unwrap,
  // and the panel that must explain that state is what gets frozen.
  const read = /readAccountState\(([^)]*)\)/.exec(payloadBuilder())
  assert.ok(read !== null, 'the account payload builder must call readAccountState')
  assert.match(
    read[1],
    /cachedOnly:\s*true/,
    'the account payload must read with { cachedOnly: true } — a fresh unwrap here blocks every render',
  )
})

test('the account GET serves the cached payload', () => {
  // And the route that renders the panel must be the one serving it, rather
  // than assembling its own body from a live read somewhere else.
  assert.match(
    handlerFor('QODER_ACCOUNT_PATH'),
    /accountPayload\(\)/,
    'GET /account must answer from the shared (cached) payload builder',
  )
})

test('the account reload re-reads for real, ignoring the failure window', () => {
  // The opposite requirement, and the one a well-meaning "let's cache that too"
  // edit would break: this route IS the user saying "read it again now". Reading
  // it from a remembered failure makes the button silently do nothing.
  const handler = handlerFor('QODER_ACCOUNT_RELOAD_PATH')
  const read = /readAccountState\(([^)]*)\)/.exec(handler)
  assert.ok(read !== null, 'the reload handler must call readAccountState')
  assert.match(
    read[1],
    /force:\s*true/,
    'POST /account/reload must read with { force: true } — otherwise 重读登录 is a no-op',
  )
  assert.doesNotMatch(
    read[1],
    /cachedOnly/,
    'the reload path must not be the cached one, whatever else changes',
  )
})

test('the two sites do not drift into the same mode', () => {
  // Stated separately because the failure is symmetric: both wrong in the same
  // direction (always cached) is just as bad as both always live. Asserting each
  // independently already covers this, and this test names the invariant so a
  // future refactor that unifies them has to delete a line, not just pass.
  const get = /readAccountState\(([^)]*)\)/.exec(payloadBuilder())
  const post = /readAccountState\(([^)]*)\)/.exec(handlerFor('QODER_ACCOUNT_RELOAD_PATH'))
  assert.notStrictEqual(get?.[1], post?.[1], 'the render path and the re-read path must differ')
})

test('a zero-region activation keeps the card routes registered', () => {
  // "No region started" is the NORMAL state of a fresh install — nobody has
  // signed in yet. It used to `return` from `apply` right where the routes are
  // mounted below, so every card fetch 404'd and the panel said "读取账号状态失败"
  // instead of the copy that explains it, and — worse — the reload route that
  // brings a region online was itself never mounted, making the documented
  // "re-sign in, it appears without restarting DSH" path unreachable from a fresh
  // install, which is the only case it exists for.
  const activation = HOST.slice(HOST.indexOf('export async function apply('), HOST.length)
  const zeroRegion = /if \(started\.length === 0\) \{[\s\S]*?\n  \}/.exec(activation)
  assert.ok(zeroRegion !== null, 'the zero-region branch is gone; where does activation go now?')
  // Match a `return` STATEMENT, not the word: the branch's own comment explains
  // at length why it must not return, and a plain /return/ would match that.
  assert.doesNotMatch(
    zeroRegion[0],
    /^\s*return\b/m,
    'a zero-region activation must NOT return — the card routes are mounted after this point',
  )
})

test('a zero-region publish is a no-op rather than a throw', () => {
  // `createQoderAdapter` refuses an empty region set by design, so both adapter
  // construction sites have to tolerate zero regions. `publishRegions` is the
  // one the reload route reaches, and an uncaught throw there would take the
  // whole route down.
  const publish = /function publishRegions\(\) \{[\s\S]*?\n  \}/.exec(HOST)
  assert.ok(publish !== null, 'lib/index.js no longer has a publishRegions')
  assert.match(
    publish[0],
    /started\.length === 0\) return \{ ok: true \}/,
    'publishRegions must answer "nothing to do" when no region started, not call createQoderAdapter',
  )
  assert.match(
    HOST,
    /let adapter = started\.length > 0 \? buildAdapter\(\) : undefined/,
    'the initial adapter build must tolerate an empty region set',
  )
})
