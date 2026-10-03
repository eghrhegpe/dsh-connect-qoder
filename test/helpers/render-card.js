/**
 * A jsdom harness that renders the SHIPPED `lib/client.js` card.
 *
 * Run: node --test test/card-dom.test.js
 *
 * WHY THIS EXISTS
 *
 * `lib/client.js` is a browser build: it calls `window.__ModuleLoader__.load`
 * with a factory, and that factory reaches for `react` / `react/jsx-runtime` at
 * module scope. Nothing in this repository can import it. The existing client
 * tests drive that factory and call `apply()`, but they never render — so
 * `test/client-bundle.test.js` states plainly that "everything around the gate"
 * (the JSX rendering, the fetch of the host route, the settings write) is
 * uncovered.
 *
 * This harness closes that gap against the SAME artifact CI already builds and
 * ships. It is deliberately not an import of `src/client/card.tsx`: the point is
 * to execute the code the user sees, not a transcription. A card that loses its
 * roster in a rebuild turns this red even though `npm test` stays green.
 *
 * WHAT IT DOES
 *
 * 1. Installs a jsdom window and aliases the DOM globals React's renderer reads
 *    at call time, so `react-dom/client` runs the CLIENT build.
 * 2. Evaluates `lib/client.js` in that window, capturing the loader entry.
 * 3. Runs the factory with a `require` that serves the real `react`,
 *    `react/jsx-runtime` and `react-dom/client` — the externals the HOST would
 *    supply at runtime, so the card behaves exactly as it does in DSH.
 * 4. Runs `apply()` with a stub client context that records every slot the card
 *    registers into, and returns the captured component.
 * 5. Mounts that component into the jsdom document with a mocked `fetch` that
 *    answers the host's own routes.
 *
 * The `t` function is built from the very table `apply()` registers, so the
 * assertions read the real copy rather than a literal.
 */
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const requireHere = createRequire(import.meta.url)

/** The namespaces the host serves in this checkout, read from the source. */
const HOST_NAMESPACE = /export const QODER_SETTINGS_NS = '([^']+)'/
  .exec(readFileSync(join(root, 'src', 'host', 'index.ts'), 'utf8'))?.[1]

/**
 * Install a jsdom window and copy the globals React's renderer reads.
 *
 * React decides between its client and server renderer at import time by
 * testing `typeof document !== 'undefined'`. `react-dom/client` is imported
 * HERE (inside this function) so that decision happens after the globals land.
 */
async function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1/',
    // Not `pretendToBeVisual`: that starts a requestAnimationFrame loop which
    // keeps the event loop alive after the tests finish and hangs the runner.
  })
  const w = dom.window

  const alias = (name) => {
    const value = w[name]
    if (value === undefined) return
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    })
  }
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLButtonElement',
    'Element',
    'Node',
    'Event',
    'InputEvent',
    'CustomEvent',
    'KeyboardEvent',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'TextEncoder',
    'AbortController',
  ]) alias(name)

  // React's `act()` only warns-free when it knows it is inside a test runner.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  // React's scheduler reads `queueMicrotask` / `MessageChannel` if present;
  // jsdom has neither, but Node does — hand them over so the act() flush works.
  for (const name of ['queueMicrotask', 'MessageChannel']) {
    const value = globalThis[name]
    if (value === undefined) continue
    Object.defineProperty(w, name, { value, writable: true, configurable: true })
  }

  return { dom, window: w }
}

/**
 * The instant every clock read lands on while the clock is frozen: 23:30 in
 * Asia/Shanghai — inside the 22:00–08:00 off-peak window the card's live-window
 * badge tests use, so those tests are deterministic at any hour of day.
 */
const FROZEN_NOW = Date.parse('2026-09-26T23:30:30+08:00')

/** The instant a formatter should use for one argument. */
function frozenInstantOf(date) {
  if (date === undefined || date === null) return FROZEN_NOW
  return date
}

/**
 * Run `task` with the clock frozen, in the realm the shipped bundle reads it.
 *
 * The bundle executes inside a `new Function` in the NODE realm, so the card's
 * `new Date()` / `Intl.DateTimeFormat` calls resolve to Node's globals, not the
 * jsdom window's. Both are patched, for the reason already proven in
 * `scripts/verify-bundle-behaviour.mjs` (see its header and
 * docs/KNOWN_GAPS.md §7): the card reads the clock through
 * `Intl.DateTimeFormat.formatToParts`, and per ECMA-402 a non-Date argument is
 * converted via `ToNumber` — `NaN` for `undefined` — landing on
 * `%CurrentDateTime%`, an engine-internal slot no `Date` override can reach.
 * So `Intl.DateTimeFormat` is replaced as well.
 *
 * Only the no-argument `new Date()` and the no-instant format calls are
 * rewritten; an explicit argument (including a real `Date`) is the caller's
 * intent and passes through — this patches the clock, not the card's parsing.
 *
 * Each test FILE runs in its own process under `node --test`, and the tests
 * within a file run sequentially, so the global patch never leaks into another
 * file's assertions.
 */
async function withFrozenClock(task) {
  const RealDate = globalThis.Date
  const RealIntl = globalThis.Intl
  class FrozenDate extends RealDate {
    constructor(...args) {
      // `new Date()` with no argument is the only form that reads the clock; an
      // explicit argument is the caller's real intent and must not be rewritten.
      if (args.length === 0) super(FROZEN_NOW)
      else super(...args)
    }
    static now() {
      return FROZEN_NOW
    }
  }
  globalThis.Date = FrozenDate
  // A subclass keeps the real implementation for every case except the one that
  // matters here: a formatter asked to format a non-Date is given the frozen
  // instant instead of `%CurrentDateTime%`. Both entry points are covered
  // because the card uses `formatToParts`, not `format`.
  class FrozenDateTimeFormat extends RealIntl.DateTimeFormat {
    format(date) {
      return super.format(frozenInstantOf(date))
    }
    formatToParts(date) {
      return super.formatToParts(frozenInstantOf(date))
    }
  }
  const FrozenIntl = Object.create(RealIntl)
  FrozenIntl.DateTimeFormat = FrozenDateTimeFormat
  globalThis.Intl = FrozenIntl
  try {
    return await task()
  } finally {
    globalThis.Date = RealDate
    globalThis.Intl = RealIntl
  }
}

/** A `t` that interpolates `{key}` against the table the card registered. */
function makeTranslate(table) {
  return (key, params) => {
    const template = table[key] ?? key
    if (params === undefined) return template
    return String(template).replace(/\{(\w+)\}/g, (_, name) =>
      params[name] === undefined ? `{${name}}` : String(params[name]))
  }
}

/**
 * Load `lib/client.js`, run its factory with the real externals, and apply the
 * client context. Returns the card components the slot registrations captured.
 */
async function loadCardBundle({ fetchImpl, scopePersist = true }) {
  const { window: w } = await installDom()
  const BUNDLE = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

  let entry
  w.__ModuleLoader__ = {
    load: (mod) => { entry = mod },
  }
  w.fetch = fetchImpl ?? (() => { throw new Error('no fetch stub') })
  // Alias the stub onto the Node global too: the bundle runs in a `new Function`
  // scope where only the named params are in scope, and `fetch` resolves to
  // `globalThis.fetch` otherwise — Node's real one, which would try to reach the
  // host route over the network and fail on a path that is not a URL.
  globalThis.fetch = w.fetch

  // The bundle references `window`, `document` and `console` by free name.
  const names = ['window', 'document', 'console', 'fetch']
  const values = [w, w.document, w.console, w.fetch]
  new Function(...names, `${BUNDLE}\n;`)(...values)

  if (entry === undefined) throw new Error('the bundle did not call window.__ModuleLoader__.load')
  if (typeof entry.factory !== 'function') throw new Error('the loader entry carries no factory')

  // The host supplies these three at runtime; the real packages are what make
  // this a render rather than a transcription.
  const require = (name) => {
    if (name === 'react') return requireHere('react')
    if (name === 'react/jsx-runtime') return requireHere('react/jsx-runtime')
    throw new Error(`unexpected require("${name}") from the client bundle`)
  }

  const app = entry.factory(require)
  if (typeof app?.apply !== 'function') throw new Error('the bundle exposes no apply()')

  // Stub client context. `slots.register` captures the card component; `locale`
  // records the copy table so the harness can build a real `t`.
  const slots = []
  const tables = {}
  const scope = {
    // The card's settings writes go through the host endpoint FIRST, so the
    // stub `fetch` above answers those; the scope mirror only records.
    //
    // `persist` is the 0.1.7 silent-failure mode the PLAN calls out: `set`
    // resolves but the document is not written, so the read-back disagrees and
    // the card must NOT claim success. Set it false in a test to drive that.
    persist: true,
    written: {},
    set: async (field, value) => {
      if (scope.persist) scope.written[field] = value
    },
    getSnapshot: () => ({ value: { ...scope.written } }),
  }
  const forms = {
    describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: HOST_NAMESPACE }] } }) }),
    get: () => scope,
  }
  // The host's `locale.register(ns, { zh, en })` stores BOTH languages, and
  // `locale.bind(ns)` returns a `t` over the ACTIVE one. Mirror that: `t` must
  // answer real copy, or the card renders key-echoes and every assertion here
  // would compare a literal to itself.
  const registered = {}
  scope.persist = scopePersist
  const ctx = {
    effect: (fn) => fn(),
    get: (name) => (name === 'configForms' ? forms : undefined),
    locale: {
      register: (ns, table) => { registered[ns] = table },
      bind: (ns) => makeTranslate(registered[ns]?.zh ?? {}),
    },
    slots: {
      inject: (_slotName, callback) => callback(),
      register: (slot, card) => { slots.push({ slot, card }) },
    },
  }

  app.apply(ctx)

  if (slots.length === 0) throw new Error('apply() registered no card slot')

  return { window: w, registered, scope, slots }
}

/** Mount every captured card and return handles to drive assertions on. */
async function renderCards({ card, registered, scope, window: w, props = {}, locale = 'zh' }) {
  const { createRoot } = requireHere('react-dom/client')
  const react = requireHere('react')

  const container = w.document.createElement('div')
  w.document.body.appendChild(container)
  const root = createRoot(container)

  // `apply()` handed each slot an `inject` that resolves the props the host
  // would pass; `t` and `settingsScope` are what the card reads.
  const slot = card.slot
  const injected = typeof slot.inject === 'function' ? slot.inject() : {}
  const t = makeTranslate(registered[HOST_NAMESPACE]?.[locale] ?? {})

  const element = react.createElement(card.card, {
    ...injected,
    t: injected.t ?? t,
    settingsScope: injected.settingsScope ?? scope,
    view: 'page',
    ...props,
  })
  await react.act(async () => {
    root.render(element)
    // Effects fetch on mount; each route resolves in its own microtask turn, so
    // yield several times so every panel settles before the assertions run.
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })

  // The card installs a per-second interval while an off-peak window is open;
  // unmounting is what clears it, so every test must release its root or the
  // runner hangs waiting on a live timer. It also runs inside `act`: the cleanup
  // lands a state update, and doing it outside would surface the "not wrapped in
  // act" warning.
  let released = false
  return {
    root,
    container,
    react,
    t,
    unmount: () => {
      if (released) return
      released = true
      react.act(() => root.unmount())
      container.remove()
    },
  }
}

export { loadCardBundle, renderCards, makeTranslate, withFrozenClock, HOST_NAMESPACE }