/**
 * Guard the host-facing config schema against the "not volatile" save refusal.
 *
 * Run: node --test test/config-schema.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `lib/index.js` cannot be imported here: it pulls in the host's Cordis peer
 * dependencies (schemastery, dsh-home-paths, dsh-llm), which only the DSH host
 * resolves at activation time. So this guard works on the source text, the way
 * `test/client-bundle.test.js` works on the shipped bundle.
 *
 * The defect it pins is a real one the card hit in production: the account
 * panel's per-region "models" switch writes `enabledRegions` through
 * `settings.mutate`, and the 0.1.7 host validates every muted field against
 * the plugin's config schema, refusing anything that is not declared AND
 * volatile with `Config field "enabledRegions" is not volatile`. Declaring the
 * field in the source was the fix; this file is what turns a future deletion
 * of that declaration into a red test instead of a silent save failure on the
 * user's card.
 *
 * WHAT IS STILL NOT COVERED
 *
 * The host-side acceptance of the mutate itself — that needs a live 0.1.7
 * host, which the zero-dependency suite cannot spin up. What is covered is the
 * plugin side of the contract: the field exists in both schema objects, is
 * wrapped the way volatile fields are, and carries the shape the card posts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'index.js'),
  'utf8',
)

/**
 * Extract one `z.object({ ... })` value by the name of the binding that holds
 * it. Walks the braces of the OBJECT itself (the value), not the statement,
 * so a `.default({})` inside a field cannot end the walk early — the walk
 * starts at the `{` after `z.object(`.
 */
function objectValueOf(binder) {
  const anchor = SOURCE.indexOf(binder)
  assert.ok(anchor !== -1, `could not find \`${binder}\` in lib/index.js`)
  const open = SOURCE.indexOf('z.object({', anchor)
  assert.ok(open !== -1, `no z.object({ after \`${binder}\``)
  const start = SOURCE.indexOf('{', open)
  let depth = 0
  for (let i = start; i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++
    else if (SOURCE[i] === '}') {
      depth--
      if (depth === 0) return SOURCE.slice(start, i + 1)
    }
  }
  assert.fail(`unbalanced braces in \`${binder}\``)
}

/**
 * Extract the statement body of one `const NAME = asVolatile( ... )` field
 * definition: from the opening paren of the `asVolatile(` call to its
 * matching close, walked by parens.
 */
function volatileBodyOf(name) {
  const anchor = new RegExp(`const ${name} = asVolatile\\(`).exec(SOURCE)
  assert.ok(anchor !== null, `lib/index.js no longer declares \`${name}\` as a volatile field`)
  const start = SOURCE.indexOf('(', anchor.index + anchor[0].length - 1)
  let depth = 0
  for (let i = start; i < SOURCE.length; i++) {
    if (SOURCE[i] === '(') depth++
    else if (SOURCE[i] === ')') {
      depth--
      if (depth === 0) return SOURCE.slice(start, i + 1)
    }
  }
  assert.fail(`unbalanced parens in \`${name}\``)
}

test('the config schema declares enabledRegions as a volatile field', () => {
  // The host validates `settings.mutate` fields against the Loader entry's
  // config schema (the `Config` export) and accepts only declared, volatile
  // fields. This is the one that the account panel's switch writes through,
  // so it must be present and volatile.
  const config = objectValueOf('export const Config')
  assert.ok(
    /enabledRegions:\s*ENABLED_REGIONS_FIELD/.test(config),
    'Config lost its enabledRegions field — the host will refuse the switch save again',
  )
  const body = volatileBodyOf('ENABLED_REGIONS_FIELD')
  assert.ok(
    body.includes('z.boolean()'),
    'enabledRegions must be a map of region id to boolean — the card posts one flag per region',
  )
  assert.ok(
    body.includes('.default({})'),
    'an absent value must default to an empty map, which regionEnabledFor reads as "all offered"',
  )
})

test('the installed section declares the same field', () => {
  // The 0.1.6 line publishes the section through `settings.installSection`;
  // without the field there, the same switch dies on that host line with the
  // same refusal. Both schema objects share the field constants on purpose,
  // so both must carry it.
  const section = objectValueOf('const QODER_SECTION')
  assert.ok(
    /enabledRegions:\s*ENABLED_REGIONS_FIELD/.test(section),
    'QODER_SECTION lost its enabledRegions field',
  )
})

test('the pre-existing fields are still declared', () => {
  // A merge that drops a sibling field while adding enabledRegions would pass
  // the two tests above and still break the card's context-window and image
  // saves. Pin the whole declared set.
  const config = objectValueOf('export const Config')
  for (const field of [
    'useMaximumContextWindow',
    'imageOverrides',
    'enabledModelIds',
    'enabledRegions',
  ]) {
    assert.ok(config.includes(field), `Config lost its \`${field}\` field`)
  }
})

test('the save whitelist and the schema agree on the field name', () => {
  // `lib/settings-save.js` white-lists the fields `__save` may write. If the
  // schema and the whitelist ever drift apart (one side renamed, the other
  // not), the save passes the plugin's guard and dies at the host's, or vice
  // versa. Keep the two spellings in lockstep.
  const config = objectValueOf('export const Config')
  const save = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'settings-save.js'),
    'utf8',
  )
  const SAVE_FIELDS_START = save.indexOf('export const SAVE_FIELDS')
  assert.ok(SAVE_FIELDS_START !== -1, 'lib/settings-save.js lost its SAVE_FIELDS whitelist')
  // Walk the braces of the object: the object's own comment mentions a `}`,
  // so a first-`}` slice would end inside the comment, before the whitelist
  // entries it is trying to guard.
  const objectOpen = save.indexOf('{', SAVE_FIELDS_START)
  let depth = 0
  let objectClose = -1
  for (let i = objectOpen; i < save.length; i++) {
    if (save[i] === '{') depth++
    else if (save[i] === '}') {
      depth--
      if (depth === 0) {
        objectClose = i
        break
      }
    }
  }
  const saveWhitelist = save.slice(objectOpen, objectClose + 1)
  assert.ok(
    /enabledRegions:\s*['"]regions['"]/.test(saveWhitelist),
    'the save whitelist no longer accepts enabledRegions with the regions merge',
  )
  assert.ok(
    /enabledRegions/.test(config),
    'the config schema and the save whitelist disagree on enabledRegions',
  )
})
