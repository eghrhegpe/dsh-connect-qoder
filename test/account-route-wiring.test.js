/**
 * Guard the two call sites that decide how hard the plugin works to answer the
 * card's account panel.
 *
 * Run: node --test test/account-route-wiring.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `src/host/index.ts` cannot be imported by a test (it pulls in the Cordis peer
 * dependencies), which is a registered gap — docs/KNOWN_GAPS.md item 1（`adapter.ts` 的 Cordis 接线与 profile 构造）and item 2（`RegionRuntime` 本身与 `activate` 的 Cordis 接线）. It is therefore possible to regress
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
 *
 * WHAT MOVED OUT OF THIS FILE
 *
 * The payload builder itself now lives in `src/host/account-payload.ts`, which is
 * peer-free and therefore importable — so the questions about HOW it reads
 * (async reader, cached by default, forced on request, concurrently) are now
 * answered by EXECUTING it in test/account-payload.test.js rather than by
 * pattern-matching its source. That matters, because the defect that proved
 * this area needed a guard at all was one source-text matching could not see:
 * the builder called `readAccountStateAsync` while the file imported only the
 * synchronous `readAccountState`, and every panel render answered a bodyless
 * 400 with nothing logged anywhere. A regex over the same file says nothing
 * about whether a name resolves; running it does.
 *
 * What stays here is the part a test still cannot execute: which route calls
 * which entry point, and that the wiring is not inlined back into the
 * untestable file.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = readFileSync(join(root, 'src', 'host', 'index.ts'), 'utf8')

/** The body of one registered route handler, by its path constant. */
function handlerFor(pathConst) {
  const at = HOST.indexOf(`path: ${pathConst}`)
  assert.notStrictEqual(at, -1, `src/host/index.ts no longer registers a route for ${pathConst}`)
  // The handler is the first `handler:` after the path, and runs to the closing
  // of its registration block. A window is enough and is safer than trying to
  // match braces across the whole file — but it has to be generous, because the
  // reload handler carries the most commentary of the seven and a tight window
  // silently truncates the very call this file is here to check.
  const start = HOST.indexOf('handler:', at)
  assert.notStrictEqual(start, -1, `${pathConst} has no handler`)
  return HOST.slice(start, start + 6000)
}

/**
 * The source without its comment lines.
 *
 * Several assertions here say "this word must not appear", and this file's
 * comments legitimately discuss those words — including the one being banned.
 * Matching against commented-out text would make the assertion unfalsifiable in
 * one direction and false-positive in the other, so the comments are dropped
 * before the pattern is applied.
 */
function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

/**
 * The account payload entry point in `src/host/index.ts`.
 *
 * It is a one-line delegation now: the read itself lives in
 * `src/host/account-payload.ts` so a test can execute it (see the header). What is
 * left to assert here is that the delegation exists at all — that the payload
 * is not inlined back into this file, which is the one place no test can reach
 * and the exact shape that hid a ReferenceError from every gate until a user
 * reported a half-rendered card.
 */
function payloadBuilder() {
  const at = HOST.indexOf('const accountPayload =')
  assert.notStrictEqual(at, -1, 'src/host/index.ts no longer builds an account payload')
  return HOST.slice(at, at + 400)
}

test('the payload is built by the importable module, not inline in this file', () => {
  // Behaviour (which mode, async reader, concurrency) is asserted by executing
  // it in test/account-payload.test.js. This pins the boundary instead: if the
  // body comes back into src/host/index.ts, that coverage silently stops applying.
  const builder = payloadBuilder()
  assert.match(
    builder,
    /buildAccountPayload\(/,
    'accountPayload must delegate to src/host/account-payload.ts, which a test can import',
  )
  assert.match(
    builder,
    /regions: REGIONS/,
    'and it must pass the real region set, so the panel reports every region',
  )
  assert.match(
    builder,
    /settings: current\(\)/,
    'and the live settings snapshot, so a switch saved via the settings pipeline shows up at the next render',
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
  //
  // The mode now lives in the shared payload builder rather than in the handler
  // (issue 12, item 8 — the two bodies had drifted apart in SHAPE as well), so
  // this asserts the route asks for the forced variant of that one builder.
  const handler = handlerFor('QODER_ACCOUNT_RELOAD_PATH')
  assert.match(
    handler,
    /accountPayload\(\{\s*force:\s*true\s*\}\)/,
    'POST /account/reload must ask for the forced read — otherwise 重读登录 is a no-op',
  )
  assert.doesNotMatch(
    handler,
    /cachedOnly/,
    'the reload path must not be the cached one, whatever else changes',
  )
})

test('the cached-vs-forced decision is not made in the routing file', () => {
  // Both are now one parameter to the shared builder, and the mapping from route
  // to mode is asserted per route below (GET = default, reload = forced). If a
  // mode literal reappears in src/host/index.ts the two routes have stopped sharing
  // one decision, and the shape drift this file has been written against twice
  // is back.
  // `force: true` legitimately appears here — it is the reload route ASKING for
  // the forced read, asserted above. `cachedOnly` must not: it is a read mode
  // literal, and the routing file is supposed to name the mode it wants, never
  // spell out how the store is read.
  assert.doesNotMatch(
    codeOnly(HOST.slice(HOST.indexOf('export async function apply('))),
    /cachedOnly/,
    'the read mode belongs to src/host/account-payload.ts; the routes must only ask for it',
  )
})

test('the two account routes answer with the SAME shape', () => {
  // The reload response used to be `{ regions }` while the GET answered
  // `{ regions, enabledRegions }`, so the card had to follow every re-read with a
  // second GET to learn the per-region switches — and the two answers could
  // disagree in between, which is a UI showing a switch state that is not the
  // one it just wrote.
  assert.match(
    handlerFor('QODER_ACCOUNT_RELOAD_PATH'),
    /sendJson\(res, 200, await accountPayload\(/,
    'the reload route must send the shared payload, not a narrower object literal',
  )
  assert.doesNotMatch(
    handlerFor('QODER_ACCOUNT_RELOAD_PATH'),
    /sendJson\(res, 200, \{ regions \}\)/,
    'a hand-built { regions } body is the shape drift this replaced',
  )
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
  // The return annotation and the parameter list are matched loosely, and the
  // body terminator accepts CRLF: the source is LF in a working copy and CRLF
  // in a fresh checkout, so a literal `\n` only ever matched one of the two.
  // Neither looseness touches what this assertion is about — the zero-region
  // branch inside the body.
  const publish = /function publishRegions\([^)]*\)[^{]*\{[\s\S]*?\r?\n  \}/.exec(HOST)
  assert.ok(publish !== null, 'src/host/index.ts no longer has a publishRegions')
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
