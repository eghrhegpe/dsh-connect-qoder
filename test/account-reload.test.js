/**
 * The account reload route must not throw where the host turns a throw into a
 * bare, bodyless 400.
 *
 * The route had a real shape bug (fixed alongside these guards): `startRegion`
 * returned `{ runtime, shim }` while the stopped-region check read
 * `entry.region.id`, so every re-read threw a TypeError, dsh-host-webserver
 * caught it and answered 400 with no body — and the card's whole account panel
 * fell over to "读取账号状态失败" with nothing to show why. These guards pin
 * the two sides of that contract, plus the try/catch that keeps any future
 * region-start failure from taking the route down with it.
 *
 * src/host/index.ts cannot be imported in a node test (Cordis peer dependencies),
 * so — like test/config-schema.test.js — the checks are textual against the
 * module's source.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Normalize so the literal newline markers below match on a CRLF checkout.
const source = readFileSync(new URL('../src/host/index.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
// The reload handler body (with its try/catch) now lives in the executable
// handlers.ts; index.ts only delegates. Both halves are pinned: the delegation
// here, the guard there.
const handlersSource = readFileSync(new URL('../src/host/handlers.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n')

/** Slice from a start marker to an end marker (exclusive), over an optional source. */
function slice(start, end, fromSource = source) {
  const from = fromSource.indexOf(start)
  assert.notEqual(from, -1, `marker not found: ${start}`)
  const to = end === undefined ? fromSource.length : fromSource.indexOf(end, from)
  assert.notEqual(to, -1, `end marker not found: ${end}`)
  return fromSource.slice(from, to)
}

const startRegionBody = slice('async function startRegion(', '\n}\n')
const startStoppedRegionsBody = slice('async function startStoppedRegions(', '\n  }\n')
// The reload route's body ends where the NEXT registration begins. The
// receiver is spelled `webServer.register` because each `inject` callback binds
// the injected service to a local once; see test/lifecycle.test.js.
const reloadHandler = slice('path: QODER_ACCOUNT_RELOAD_PATH', 'webServer.register')

test('startRegion returns an entry tagged with its region', () => {
  assert.match(
    startRegionBody,
    /return \{ region, runtime, shim \}/,
    'the reload route reads entry.region.id off started entries; the entry must carry region',
  )
})

test('the stopped-region check reads that shape back', () => {
  assert.match(
    startStoppedRegionsBody,
    /started\.some\(\(entry\) => entry\.region\.id === region\.id\)/,
    'the consumer side of the entry shape',
  )
})

test('the reload route survives a failing region start', () => {
  // The try/catch now lives in the executable reloadHandler (handlers.ts) —
  // where it can be exercised for real, not just pattern-matched. The route in
  // index.ts must keep delegating to it, so a re-inlined body cannot smuggle
  // the throw back past this file's reach.
  assert.match(
    reloadHandler,
    /reloadHandler\(/,
    'POST /account/reload must delegate to src/host/handlers.ts reloadHandler',
  )
  const guard = slice(
    'export async function reloadHandler(',
    'export async function confirmHandler(',
    handlersSource,
  )
  assert.match(
    guard,
    /try \{\s*await deps\.startStoppedRegions\(wanted\)\s*\} catch \(error(?::\s*any)?\) \{/,
    'a throw out of startStoppedRegions would reach the web server catch-all and answer a bare 400',
  )
})
