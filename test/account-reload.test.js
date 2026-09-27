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
 * lib/index.js cannot be imported in a node test (Cordis peer dependencies),
 * so — like test/config-schema.test.js — the checks are textual against the
 * module's source.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Normalize so the literal newline markers below match on a CRLF checkout.
const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n')

/** Slice from a start marker to an end marker (exclusive). */
function slice(start, end) {
  const from = source.indexOf(start)
  assert.notEqual(from, -1, `marker not found: ${start}`)
  const to = end === undefined ? source.length : source.indexOf(end, from)
  assert.notEqual(to, -1, `end marker not found: ${end}`)
  return source.slice(from, to)
}

const startRegionBody = slice('async function startRegion(', '\n}\n')
const startStoppedRegionsBody = slice('async function startStoppedRegions(', '\n  }\n')
const reloadHandler = slice('path: QODER_ACCOUNT_RELOAD_PATH', 'webCtx.webServer.register')

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
  assert.match(
    reloadHandler,
    /try \{\s*await startStoppedRegions\(wanted\)\s*\} catch \(error\) \{/,
    'a throw out of startStoppedRegions would reach the web server catch-all and answer a bare 400',
  )
})
