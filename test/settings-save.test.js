/**
 * Tests for the settings write-and-verify pipeline.
 *
 * Run: node --test test/settings-save.test.js
 *
 * This code exists for one reason. On the DSH 0.1.7 line the client-side
 * `settingsScope.set()` can resolve successfully without persisting anything:
 * the host's atomic write exhausts its retries on a locked file, the scope
 * reloads the previous document, and success is returned anyway. A card that
 * trusted the return value would show "已保存" while the model roster, image
 * overrides and context window had all silently failed to change.
 *
 * So the only thing this route calls a success is a value that has been read
 * back out of the document and compared. The rest of these tests exist to make
 * sure the rest of the pipeline — namespace resolution, the per-region merge,
 * volatile unwrapping — does not become the new way to lose a write.
 *
 * The `settings` object below is a small stand-in for the host service: it
 * holds a document, and `mutate` can be told to silently drop the write, which
 * is the failure this whole file is about.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'

import {
  applySettingsSave,
  findSettingsRow,
  mergeForShape,
  readField,
  SAVE_FIELDS,
  settingsNamespaceOf,
} from '../src/host/settings-save.ts'
import { unwrapVolatile } from '../src/host/volatile.ts'

const CANDIDATES = ['dsh-connect-qoder', 'llm-qoder']

/**
 * A stand-in for the host settings service.
 *
 * @param options.ns - the namespace of the document to serve.
 * @param options.value - the document's initial value.
 * @param options.dropWrites - when true, `mutate` resolves without applying —
 *   the exact 0.1.7 defect this pipeline exists to catch.
 * @param options.volatile - when true, fields are served as `{ get() }` shells,
 *   as they are on the 0.1.7 line.
 */
function makeSettings({ ns = 'dsh-connect-qoder', value = {}, dropWrites = false, volatile = false } = {}) {
  const settings = {
    document: { [ns]: { ...value } },
    mutations: [],
    describe() {
      return Object.entries(this.document).map(([key, fields]) => ({
        ns: key,
        value: volatile
          ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { get: () => v }]))
          : fields,
      }))
    },
    async mutate(targetNs, ops) {
      this.mutations.push({ targetNs, ops })
      if (dropWrites) return
      for (const op of ops) {
        // The route sends `path: [field]` — a single-element path, not a pair.
        const field = op.path[0]
        this.document[targetNs] = { ...this.document[targetNs], [field]: op.value }
      }
    },
  }
  return settings
}

const save = (settings, field, value) =>
  applySettingsSave({ settings, field, value, candidates: CANDIDATES, equals: isDeepStrictEqual })

test('a write that lands is reported as a success', async () => {
  const settings = makeSettings({ value: { imageOverrides: {} } })
  const result = await save(settings, 'imageOverrides', { ModelA: 'off' })
  assert.strictEqual(result.status, 200)
  assert.strictEqual(result.body.ok, true)
  assert.deepStrictEqual(result.body.value, { ModelA: 'off' })
  assert.deepStrictEqual(result.body.readBack, { ModelA: 'off' })
  assert.strictEqual(settings.mutations.length, 1)
})

test('a write that silently does not land is reported as a FAILURE', async () => {
  // The whole point. `mutate` resolves, the document is unchanged, and the card
  // must be told the truth so it does not display "已保存".
  const settings = makeSettings({ value: { imageOverrides: { Old: 'on' } }, dropWrites: true })
  const result = await save(settings, 'imageOverrides', { ModelA: 'off' })

  assert.strictEqual(result.status, 200, 'the HTTP status stays 200; ok:false carries the verdict')
  assert.strictEqual(result.body.ok, false, 'a write that did not land must never report success')
  assert.strictEqual(result.body.errorName, 'read-back-mismatch')
  // The value that was written is still reported, so the client can show what
  // it tried; the read-back says what is actually stored.
  assert.deepStrictEqual(result.body.value, { ModelA: 'off' })
  assert.deepStrictEqual(result.body.readBack, { Old: 'on' })
})

test('an inherited property name is not a writable field', async () => {
  // `SAVE_FIELDS[field]` reaches the prototype chain, so `constructor`,
  // `toString`, `__proto__` and friends all yield something that is not
  // `undefined` — they sail past a `=== undefined` guard and go straight into
  // `settings.mutate` and the preferences assign. The lookup must be an own-
  // property check.
  for (const field of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty', 'isPrototypeOf']) {
    const settings = makeSettings()
    const result = await save(settings, field, { anything: true })
    assert.strictEqual(result.status, 400, `${field} must not be accepted as a field`)
    assert.strictEqual(settings.mutations.length, 0, `${field} must not be written to the document`)
  }
  // And a field that is not a string at all.
  for (const field of [null, undefined, 0, [], {}]) {
    const settings = makeSettings()
    const result = await save(settings, field, 'x')
    assert.strictEqual(result.status, 400)
    assert.strictEqual(settings.mutations.length, 0)
  }
})

test('a field that exists only on the prototype is reported as unknown', () => {
  // The error message itself is built from `Object.keys`, which is already
  // own-properties-only, so it cannot leak the prototype's members.
  assert.deepStrictEqual(Object.keys(SAVE_FIELDS), [
    'enabledModelIds',
    'enabledRegions',
    'imageOverrides',
    'useMaximumContextWindow',
  ])
  for (const inherited of ['constructor', 'toString', '__proto__']) {
    assert.ok(
      !Object.keys(SAVE_FIELDS).includes(inherited),
      `${inherited} must not appear in the whitelist`,
    )
  }
})

test('a write that lands on a DIFFERENT value than intended is caught', async () => {
  // Not just "nothing happened": a host that stored something other than what
  // was asked for must also fail. A loose comparison — say, comparing only the
  // keys, or only the top-level shape — would let this through, and the user
  // would see a setting the document does not agree with.
  const settings = makeSettings({ value: { imageOverrides: {} } })
  // A host that quietly stores a different value for the same field.
  settings.mutate = async function (targetNs, ops) {
    this.mutations.push({ targetNs, ops })
    this.document[targetNs] = { ...this.document[targetNs], imageOverrides: { ModelA: 'on' } }
  }
  const result = await save(settings, 'imageOverrides', { ModelA: 'off' })
  assert.strictEqual(result.body.ok, false, 'a differently-stored value is not a success')
  assert.deepStrictEqual(result.body.readBack, { ModelA: 'on' })
})

test('a write that lands with an extra key is caught', async () => {
  // The document gaining something the card never asked for means it is not the
  // document the user saved into.
  const settings = makeSettings({ value: { imageOverrides: {} } })
  settings.mutate = async function (targetNs, ops) {
    this.mutations.push({ targetNs, ops })
    this.document[targetNs] = { ...this.document[targetNs], imageOverrides: { ModelA: 'off', Extra: 'on' } }
  }
  const result = await save(settings, 'imageOverrides', { ModelA: 'off' })
  assert.strictEqual(result.body.ok, false)
})

test('an unknown field is a 400 and touches nothing', async () => {
  const settings = makeSettings()
  const result = await save(settings, 'somethingElse', 'x')
  assert.strictEqual(result.status, 400)
  assert.match(result.body.error, /field must be one of/)
  assert.strictEqual(settings.mutations.length, 0, 'an unknown field must not be written')
})

test('an inherited Object key is not a field, however much it looks like one', async () => {
  // The guard is an own-property check, not `SAVE_FIELDS[field] === undefined`.
  // A plain lookup walks the prototype chain, so `constructor` resolves to a
  // function — never `undefined` — and sails straight through into `mutate`.
  for (const field of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'isPrototypeOf']) {
    const settings = makeSettings()
    const result = await save(settings, field, { M: 'on' })
    assert.strictEqual(result.status, 400, `"${field}" must be refused as a field name`)
    assert.match(result.body.error, /field must be one of/)
    assert.strictEqual(settings.mutations.length, 0, `"${field}" must not reach settings.mutate`)
  }
})

test('a non-string field name is refused rather than coerced', async () => {
  // `body.field` arrives from JSON, so it can be any JSON value. An array or a
  // number must not index into the whitelist.
  for (const field of [undefined, null, 0, 1, true, ['imageOverrides'], { toString: () => 'imageOverrides' }]) {
    const settings = makeSettings()
    const result = await save(settings, field, { M: 'on' })
    assert.strictEqual(result.status, 400, `${JSON.stringify(field)} must not be treated as a field`)
    assert.strictEqual(settings.mutations.length, 0)
  }
})

test('a missing namespace is a 503 naming what was available', async () => {
  const settings = makeSettings({ ns: 'some.other.plugin' })
  const result = await save(settings, 'imageOverrides', {})
  assert.strictEqual(result.status, 503)
  assert.match(result.body.error, /namespace missing/)
  assert.match(result.body.error, /some\.other\.plugin/, 'the error must list the namespaces it did find')
})

test('the provider name is accepted as a namespace on the 0.1.7 line', async () => {
  // 0.1.7 keys a provider's document by the provider name rather than the
  // plugin namespace; both must resolve.
  const settings = makeSettings({ ns: 'llm-qoder', value: { imageOverrides: {} } })
  const result = await save(settings, 'imageOverrides', { M: 'on' })
  assert.strictEqual(result.body.ok, true)
  assert.strictEqual(settings.mutations[0].targetNs, 'llm-qoder')
})

test('a near-miss namespace is NOT matched', async () => {
  // The old code fell back to `String(entry.ns).includes(name)`, which matches
  // `llm-qoder-extra`. Saving there would mutate another plugin's document.
  for (const other of ['llm-qoder-extra', 'x-dsh-connect-qoder-y', 'dsh-connect-qoder2']) {
    const settings = makeSettings({ ns: other })
    const result = await save(settings, 'imageOverrides', { M: 'on' })
    assert.strictEqual(result.status, 503, `${other} must not be treated as ours`)
    assert.strictEqual(settings.mutations.length, 0, `${other} must not be written to`)
  }
})

test('namespace resolution prefers the exact namespace over the provider name', () => {
  const rows = [
    { ns: 'llm-qoder', value: {} },
    { ns: 'dsh-connect-qoder', value: {} },
  ]
  assert.strictEqual(findSettingsRow(rows, CANDIDATES).ns, 'dsh-connect-qoder')
  // And with only the second present, it is still found.
  assert.strictEqual(findSettingsRow([rows[0]], CANDIDATES).ns, 'llm-qoder')
  assert.strictEqual(findSettingsRow([], CANDIDATES), undefined)
})

test('the declared namespace comes from the Loader entry, not from the constant', () => {
  // 0.1.7 keys the document by the Loader entry id, which for this bundle is
  // `llm-qoder`. The models settings page resolves a provider's row by EXACT
  // match on the namespace it declared, so declaring the constant here hides
  // the whole Qoder group from that page while the plugin stays registered and
  // answering — the failure this helper exists to prevent.
  assert.strictEqual(settingsNamespaceOf({ fiber: { entry: { options: { id: 'llm-qoder' } } } }, 'dsh-connect-qoder'), 'llm-qoder')
  // Whatever the host serves is declared verbatim: a Loader that namespaces
  // bundles (`include:dsh-connect-workbuddy`) must be matched, not reformatted.
  assert.strictEqual(
    settingsNamespaceOf({ fiber: { entry: { options: { id: 'include:dsh-connect-qoder' } } } }, 'dsh-connect-qoder'),
    'include:dsh-connect-qoder',
  )
})

test('the fallback covers hosts that mount the plugin without a Loader entry', () => {
  // `ctx.fiber.entry` is added by the Loader, not by Cordis: a test harness or
  // a direct `ctx.plugin()` has none, and the plugin must still name itself.
  for (const ctx of [
    undefined,
    {},
    { fiber: {} },
    { fiber: { entry: {} } },
    { fiber: { entry: { options: {} } } },
    { fiber: { entry: { options: { id: '' } } } },
    { fiber: { entry: { options: { id: 42 } } } },
  ]) {
    assert.strictEqual(settingsNamespaceOf(ctx, 'dsh-connect-qoder'), 'dsh-connect-qoder', `${JSON.stringify(ctx)} must fall back`)
  }
})

test('a volatile field is unwrapped on both the read and the read-back', async () => {
  // On 0.1.7 a volatile field holds `{ get() }`. Comparing the shell to the
  // written value would report a mismatch on every successful save, so the
  // comparison must be against the resolved value.
  const settings = makeSettings({ value: { imageOverrides: {} }, volatile: true })
  const result = await save(settings, 'imageOverrides', { M: 'off' })
  assert.strictEqual(result.body.ok, true, 'a volatile shell must not be mistaken for a mismatch')
  assert.deepStrictEqual(result.body.readBack, { M: 'off' })
})

test('unwrapVolatile passes ordinary values through untouched', () => {
  assert.strictEqual(unwrapVolatile(undefined), undefined)
  assert.strictEqual(unwrapVolatile(null), null)
  assert.strictEqual(unwrapVolatile(false), false)
  assert.strictEqual(unwrapVolatile(0), 0)
  assert.strictEqual(unwrapVolatile(''), '')
  const plain = { a: 1 }
  assert.strictEqual(unwrapVolatile(plain), plain, 'a plain object must be returned as-is')
  // An object that merely looks like a reference but has no get is not one.
  assert.deepStrictEqual(unwrapVolatile({ get: 1 }), { get: 1 })
})

test('readField tolerates a missing row or field', () => {
  assert.strictEqual(readField(undefined, 'imageOverrides'), undefined)
  assert.strictEqual(readField({}, 'imageOverrides'), undefined)
  assert.strictEqual(readField({ value: {} }, 'imageOverrides'), undefined)
})

test('saving one region does not delete the other', async () => {
  // The card posts one region at a time. A wholesale replace would drop the
  // other region's curated roster, so this is the merge that matters.
  const settings = makeSettings({
    value: { enabledModelIds: { 'qoder-cn': ['A'], qoder: ['B', 'C'] } },
  })
  const result = await save(settings, 'enabledModelIds', { 'qoder-cn': ['A', 'D'] })

  assert.strictEqual(result.body.ok, true)
  assert.deepStrictEqual(result.body.value, {
    'qoder-cn': ['A', 'D'],
    qoder: ['B', 'C'],
  })
  assert.deepStrictEqual(result.body.readBack['qoder'], ['B', 'C'], 'the other region must survive')
})

test('the per-region merge starts from the live value, not from empty', async () => {
  // With no stored value at all, the incoming object is the whole result.
  const settings = makeSettings({ value: {} })
  const result = await save(settings, 'enabledModelIds', { 'qoder-cn': ['A'] })
  assert.strictEqual(result.body.ok, true)
  assert.deepStrictEqual(result.body.value, { 'qoder-cn': ['A'] })
})

test('saving one region\'s provider switch does not delete the other', async () => {
  // The card posts the complete map, but the merge is what keeps it safe even
  // if a partial map is ever sent: flipping one region's switch can never
  // drop the other region's stored flag, the same guarantee the per-model
  // roster gets.
  const settings = makeSettings({
    value: { enabledRegions: { 'qoder-cn': false, qoder: true } },
  })
  const result = await save(settings, 'enabledRegions', { 'qoder-cn': true })
  assert.strictEqual(result.body.ok, true)
  assert.deepStrictEqual(result.body.value, { 'qoder-cn': true, qoder: true })
  assert.strictEqual(result.body.readBack['qoder'], true, 'the other region must survive')
})

test('a whole-shaped field replaces rather than merges', async () => {
  // The card always posts the complete value for these, so a merge would leave
  // stale keys behind — e.g. a model whose image mode was reset.
  const settings = makeSettings({ value: { imageOverrides: { A: 'on', B: 'off' } } })
  const result = await save(settings, 'imageOverrides', { A: 'off' })
  assert.strictEqual(result.body.ok, true)
  assert.deepStrictEqual(result.body.value, { A: 'off' })
  assert.strictEqual('B' in result.body.readBack, false, 'a replaced field must not keep old keys')
})

test('a boolean field round-trips', async () => {
  const settings = makeSettings({ value: { useMaximumContextWindow: false } })
  const on = await save(settings, 'useMaximumContextWindow', true)
  assert.strictEqual(on.body.ok, true)
  assert.strictEqual(on.body.readBack, true)
  const off = await save(settings, 'useMaximumContextWindow', false)
  assert.strictEqual(off.body.ok, true)
  assert.strictEqual(off.body.readBack, false)
})

test('the field list is exactly the four the card writes', () => {
  // A typo here would make a field unwritable with a 400 the card cannot
  // explain, so the set is pinned.
  assert.deepStrictEqual(Object.keys(SAVE_FIELDS).sort(), [
    'enabledModelIds',
    'enabledRegions',
    'imageOverrides',
    'useMaximumContextWindow',
  ])
  assert.strictEqual(SAVE_FIELDS.enabledModelIds, 'regions')
  assert.strictEqual(SAVE_FIELDS.enabledRegions, 'regions')
  assert.strictEqual(SAVE_FIELDS.imageOverrides, 'whole')
  assert.strictEqual(SAVE_FIELDS.useMaximumContextWindow, 'whole')
})

test('mergeForShape ignores the stored value for whole-shaped fields', () => {
  assert.strictEqual(mergeForShape('whole', 'new', 'old'), 'new')
  assert.deepStrictEqual(mergeForShape('regions', { b: 1 }, { a: 1 }), { a: 1, b: 1 })
  // A non-object on either side degrades to an object rather than throwing.
  assert.deepStrictEqual(mergeForShape('regions', undefined, 'garbage'), {})
  assert.deepStrictEqual(mergeForShape('regions', 'garbage', undefined), {})
})

test('a mutate that throws is not a success', async () => {
  const settings = makeSettings()
  settings.mutate = async () => {
    throw new Error('host is on fire')
  }
  await assert.rejects(
    () => save(settings, 'imageOverrides', { M: 'on' }),
    /host is on fire/,
  )
})
