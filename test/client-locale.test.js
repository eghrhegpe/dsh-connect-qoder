/**
 * Guard the card's copy against the failure that actually shipped in 0.4.3.
 *
 * Run: node --test test/client-locale.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * In 0.4.3 the client registered its translation table under the literal
 * `"settings.qoder"` — a namespace the HOST has never served. The host's own
 * namespace resolution (`settingsNamespaceOf` in src/host/settings-save.ts)
 * keys off the Loader entry, falling back to `dsh-connect-qoder`; on 0.1.7 it
 * is the provider name `llm-qoder`. None of those is `settings.qoder`.
 *
 * When `locale.bind(ns)` cannot find a table for `ns`, it does not throw — it
 * returns the key it was asked for. So the card rendered `account.reload`,
 * `usage.checkin` and the rest as literal dotted identifiers. Two things made
 * that hard to see:
 *
 *   1. A key-echo looks identical to a MISSING TRANSLATION, in every locale.
 *      The report that arrived was "there is no English translation", which
 *      points at the copy tables — and those were complete and correct all
 *      along. 192 keys, both languages. Nothing was wrong with them.
 *   2. No test touched `locale.register` at all. `grep locale test/` was
 *      empty, so the whole registration path was unguarded.
 *
 * WHAT THIS FILE PINS
 *
 * The two namespaces must be ONE value. Not "the client's namespace is
 * `dsh-connect-qoder`" — that would just re-hardcode a constant that the host
 * is allowed to change. It asserts the invariant that was violated: whatever
 * namespace the client registers copy under is the same namespace it resolves
 * the settings scope with, and it is derived from what the host serves rather
 * than from a literal.
 *
 * It drives the REAL shipped bundle, not a transcription: the module factory is
 * extracted and evaluated with a stub `ctx` that records what was registered.
 * That is what makes it a guard — reintroducing the literal turns it red.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

/**
 * The namespace the host serves in this checkout.
 *
 * Read from the source rather than duplicated, so a future change to the
 * host's own constant cannot silently desync this test from reality.
 */
const HOST_NAMESPACE = /export const QODER_SETTINGS_NS = '([^']+)'/
  .exec(readFileSync(join(root, 'src', 'host', 'index.ts'), 'utf8'))?.[1]

assert.ok(
  HOST_NAMESPACE !== undefined,
  'could not read QODER_SETTINGS_NS from src/host/index.ts — this test keys on it',
)

/**
 * Drive the card's module factory with a stub client context.
 *
 * `configForms.describe()` answers with the namespace list the real host would
 * serve. Everything the card touches at load time is stubbed; the card body is
 * never rendered, only `apply()` is run.
 */
function loadClient({ servedNamespace }) {
  const registered = []
  const bound = []
  const describeCalls = []

  const namespaceList = servedNamespace === null ? [] : [{ ns: servedNamespace }]

  const forms = {
    describe: () => {
      describeCalls.push(true)
      return { getSnapshot: () => ({ view: { namespaces: namespaceList } }) }
    },
    get: (ns) => ({ __scopeFor: ns }),
  }

  const ctx = {
    effect: (fn) => fn(),
    get: (name) => {
      if (name === 'configForms') return forms
      return undefined
    },
    locale: {
      register: (ns, table) => {
        registered.push({ ns, table })
      },
      bind: (ns) => {
        bound.push(ns)
        return (key) => key
      },
    },
    slots: {
      inject: () => undefined,
      register: () => undefined,
    },
  }

  // The bundle is a browser build: it calls `window.__ModuleLoader__.load`
  // with `{ id, factory }`. Capture the entry instead of executing it.
  let entry
  const window = {
    __ModuleLoader__: { load: (mod) => { entry = mod } },
  }

  // `apply()` installs the card's stylesheet before it registers anything, and
  // that reaches for `document`. Only three members are needed, and the style
  // tag's contents are irrelevant here — so this stays a stub rather than a DOM
  // implementation. It must swallow the append silently: `apply` wraps its body
  // in a try/catch, so a throwing stub would make this test pass vacuously by
  // taking the "card failed to load" path.
  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => undefined },
  }

  const sandbox = { window, document, console }
  const names = Object.keys(sandbox)
  new Function(...names, `${BUNDLE}\n;`)(...names.map((n) => sandbox[n]))

  assert.ok(entry !== undefined, 'the bundle did not call window.__ModuleLoader__.load')
  assert.equal(typeof entry.factory, 'function', 'the loader entry carries no factory')

  // `react` and `react/jsx-runtime` are externals the host supplies. The card
  // body is never rendered here, so the stubs only need to satisfy the
  // module-scope destructuring.
  const require = (name) => {
    if (name === 'react') return { useState: () => [], useEffect: () => {}, useRef: () => ({ current: undefined }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: Symbol('Fragment') }
    if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
    throw new Error(`unexpected require("${name}") from the client bundle`)
  }
  const app = entry.factory(require)

  assert.equal(typeof app?.apply, 'function', 'the bundle exposes no apply()')
  app.apply(ctx)

  return { registered, bound, describeCalls }
}

test('the copy is registered under the namespace the host actually serves', () => {
  const { registered, bound } = loadClient({ servedNamespace: HOST_NAMESPACE })

  assert.equal(registered.length, 1, 'expected exactly one locale.register call')
  assert.equal(
    registered[0].ns,
    HOST_NAMESPACE,
    `copy registered under "${registered[0].ns}" but the host serves "${HOST_NAMESPACE}" — ` +
      'a namespace that is not served makes locale.bind echo every key, so the card ' +
      'renders raw identifiers in BOTH languages',
  )
  assert.deepEqual(bound, [HOST_NAMESPACE], 'the card must bind the namespace it registered')
})

test('the locale namespace follows the host, not a hardcoded literal', () => {
  // The 0.1.7 line derives the namespace from the Loader entry, so the served
  // value can differ from the fallback. The client must follow it.
  const { registered, bound } = loadClient({ servedNamespace: 'llm-qoder' })

  assert.equal(registered[0].ns, 'llm-qoder', 'the client ignored what the host serves')
  assert.deepEqual(bound, ['llm-qoder'])
})

test('a host that serves nothing still yields a usable namespace', () => {
  // `configForms` present but with no namespaces listed: the plugin must fall
  // back to its own name rather than registering under `undefined`, which
  // would make the tables unreachable AND look like a typo.
  const { registered, bound } = loadClient({ servedNamespace: null })

  assert.equal(registered[0].ns, 'dsh-connect-qoder')
  assert.deepEqual(bound, ['dsh-connect-qoder'])
})

test('every key the card can ask for is present, in both languages', () => {
  const { registered } = loadClient({ servedNamespace: HOST_NAMESPACE })
  const { zh, en } = registered[0].table

  assert.equal(typeof zh, 'object', 'no zh table was registered')
  assert.equal(typeof en, 'object', 'no en table was registered')

  /**
   * The keys the CARD actually asks for.
   *
   * Taken from card.tsx rather than from the copy tables, and that is the whole
   * point: comparing the tables to themselves would pass even if every key in
   * them were spelled differently from the lookups. This is the direction that
   * catches a typo on either side.
   */
  const card = readFileSync(join(root, 'src', 'client', 'card.tsx'), 'utf8')
  const asked = new Set()
  for (const m of card.matchAll(/\bt\(\s*"([\w.]+)"/g)) asked.add(m[1])
  for (const m of card.matchAll(/\bt\(\s*`([\w.]+)\.\$\{/g)) {
    // A template lookup like t(`account.state.${state}`) — expand it over the
    // suffixes the copy table actually carries.
    const prefix = `${m[1]}.`
    for (const key of Object.keys(zh)) if (key.startsWith(prefix)) asked.add(key)
  }

  assert.ok(asked.size > 50, `expected the card to ask for many keys, found ${asked.size}`)

  const missingZh = [...asked].filter((k) => !(k in zh))
  const missingEn = [...asked].filter((k) => !(k in en))
  assert.deepEqual(missingZh, [], 'the card asks for these keys but zh has no entry')
  assert.deepEqual(missingEn, [], 'the card asks for these keys but en has no entry')

  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(
    zhKeys.filter((k) => !enKeys.includes(k)),
    [],
    'these keys have Chinese copy but no English',
  )
  assert.deepEqual(
    enKeys.filter((k) => !zhKeys.includes(k)),
    [],
    'these keys have English copy but no Chinese',
  )

  // A value equal to its own key is the signature of a key-echo — which is
  // what the shipped 0.4.3 bug produced at RUNTIME. Catching it in the table
  // means a copy mistake cannot masquerade as the same symptom as the
  // namespace bug this file exists for.
  for (const [key, value] of Object.entries(zh)) {
    assert.notEqual(value, key, `zh["${key}"] is its own key — that is a key-echo, not copy`)
  }
  for (const [key, value] of Object.entries(en)) {
    assert.notEqual(value, key, `en["${key}"] is its own key — that is a key-echo, not copy`)
  }
})
