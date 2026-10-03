/**
 * Contract test for the two `regionEnabled` defaults that point opposite ways.
 *
 * Run: node --test test/region-enabled-defaults.test.js
 *
 * There are two switches with the same name at two layers, and they answer
 * different questions — which is why their defaults are deliberately different,
 * and why reading either one alone gets the answer backwards:
 *
 *   - `adapter.ts` supplies the RESOLVER when the wiring omits it entirely
 *     (`?? (() => true)`): the caller already chose which regions to adapt, so a
 *     missing switch must not publish nothing.
 *   - `adapter-models.ts` reads the RESOLVED value for one region
 *     (`!== true` → `[]`): this is the switch that hides a region the user
 *     turned off, so anything but an explicit `true` must not publish it.
 *
 * Both are spelled `??` and both sit next to a comment calling the other one
 * wrong-looking, so "unifying" them is a natural edit — and the failure it
 * causes is quiet in both directions (either a region the user disabled
 * reappears, or all regions vanish). These assertions exist to make that edit
 * fail loudly instead.
 *
 * `adapter.ts`'s half is asserted structurally rather than by calling
 * `createQoderAdapter`, because that function builds a real `PiAiAdapter` at
 * construction time and needs the pi-ai peer — the same reason its decision
 * logic was hoisted into `adapter-models.ts` in the first place.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildModelsFor } from '../src/host/adapter-models.ts'
import { normalizeEntry } from '../src/host/catalog-entry.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const REGION = { id: 'qoder-cn', displayName: 'Qoder CN' }
const entry = () => normalizeEntry({ key: 'A', name: 'A', priceFactor: 0.01 })
const runtime = () => ({ region: REGION, catalog: () => [entry()] })

const options = (overrides = {}) => ({
  baseUrl: 'http://127.0.0.1:1/v1',
  imageModeFor: () => 'auto',
  enabledIds: [],
  ...overrides,
})

test('the model layer refuses to publish a region whose flag is not exactly true', () => {
  // The fail-closed half. This is the one that protects the user's choice: the
  // flag is how they turn a region off, so a missing/malformed value must not
  // be read as "on" — that would republish a region they disabled, and the
  // models would work, so nothing else would look wrong.
  for (const regionEnabled of [false, undefined, null, 0, 1, 'true', {}, []]) {
    assert.deepStrictEqual(
      buildModelsFor(runtime(), options({ regionEnabled })),
      [],
      `regionEnabled=${JSON.stringify(regionEnabled)} must not publish the region`,
    )
  }
})

test('the model layer does publish a region whose flag is exactly true', () => {
  // The other side of the same rule, so "refuses everything" cannot pass as
  // fail-closed.
  assert.strictEqual(buildModelsFor(runtime(), options({ regionEnabled: true })).length, 1)
})

test('adapter.ts still defaults the resolver to "every region", not to "none"', () => {
  // The fail-open half, asserted where it lives. If someone "unifies" this with
  // the model layer's rule — a reasonable-looking edit, since both are `??` —
  // an adapter built without the switch would publish nothing, and the plugin
  // would look broken with no error anywhere.
  const source = readFileSync(join(root, 'src', 'host', 'adapter.ts'), 'utf8')
  assert.match(
    source,
    /const regionEnabled = options\.regionEnabled \?\? \(\(\) => true\)/,
    'adapter.ts must keep defaulting a missing regionEnabled resolver to true — see the comment there for why this is not the same rule as adapter-models.ts',
  )
})

test('the model layer still defaults a missing flag to off', () => {
  // The mirror of the assertion above, pinned against the source too: the two
  // defaults are a pair, and a change to one is the signal the other's comment
  // says to look for.
  const source = readFileSync(join(root, 'src', 'host', 'adapter-models.ts'), 'utf8')
  assert.match(
    source,
    /if \(options\.regionEnabled !== true\) return \[\]/,
    'adapter-models.ts must keep requiring an explicit true — an absent flag means "not offered"',
  )
})

test('both sides name each other, so the next reader is warned before editing', () => {
  // A default that is deliberately the opposite of its neighbour is only safe
  // while both comments say so. This asserts the cross-reference exists rather
  // than trusting that it survives a refactor that moves the prose away.
  const adapter = readFileSync(join(root, 'src', 'host', 'adapter.ts'), 'utf8')
  const models = readFileSync(join(root, 'src', 'host', 'adapter-models.ts'), 'utf8')
  assert.match(adapter, /buildModelsFor/, 'adapter.ts must point at the rule it deliberately differs from')
  assert.match(models, /adapter\.ts/, 'adapter-models.ts must point back at the default it deliberately differs from')
})
