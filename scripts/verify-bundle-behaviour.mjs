/**
 * Prove a rebuilt `lib/client.js` still *behaves* like the one it replaced.
 *
 * Run: node scripts/verify-bundle-behaviour.mjs [--baseline HEAD]
 *
 * WHY THIS EXISTS
 *
 * Byte-for-byte reproduction of the shipped bundle turned out to be
 * unreachable: the original was built by a toolchain this repository never
 * had, so a rebuild differs in formatting, in bundler scaffolding, and in
 * whether comments survive (docs/issues/17). "Differs in bytes" is therefore
 * the expected outcome, and it says nothing about whether the card still
 * works. This asks the question that matters instead: run both bundles, call
 * every pure function with the same arguments, and compare what comes back.
 *
 * The baseline defaults to `git show HEAD:lib/client.js`, so after a rebuild
 * it answers "did this change behaviour since the last commit", and after a
 * commit it becomes a regression check against the previous release.
 *
 * WHAT IT CANNOT SEE
 *
 * Rendering. The bundle is executed with stub `react` and `react/jsx-runtime`,
 * which is enough to define the components but not to mount them — JSX comes
 * back as `null`. Everything that is a pure function of its arguments is
 * covered; anything that needs a DOM needs a browser (docs/KNOWN_GAPS.md).
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const baselineRef = process.argv.includes('--baseline')
  ? process.argv[process.argv.indexOf('--baseline') + 1]
  : 'HEAD'

const NEW = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * The baseline bundle, or `undefined` when the ref carries none.
 *
 * `lib/` is a versioned build artifact (docs/issues/19): committed alongside its
 * sources, with CI's `git diff` gate keeping it fresh against `src/`. But refs
 * that predate the commit which started tracking `lib/` carry no `lib/client.js`
 * — `${baselineRef}:lib/client.js` simply is not there any more — which is not a
 * reason to fail, and must not be confused with "the rebuild differs".
 * `build-client.mjs` already refuses to write a bundle that does not reproduce
 * `src/client/` byte-for-byte, so freshness is enforced at the point where it
 * can actually be enforced; this script's job is the narrower question of
 * behaviour drift against a KNOWN-GOOD shipped bundle.
 */
const readBaseline = (ref) => {
  try {
    return execFileSync('git', ['show', `${ref}:lib/client.js`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
}

const OLD = readBaseline(baselineRef)

if (OLD === undefined) {
  process.stderr.write(
    `\n[verify:bundle] SKIPPED — \`${baselineRef}:lib/client.js\` is not in git.\n` +
    `[verify:bundle]   \`lib/\` is a versioned build artifact (docs/issues/19): refs that\n` +
    `[verify:bundle]   predate the commit which started tracking it carry no shipped bundle\n` +
    `[verify:bundle]   to compare behaviour against. This is expected, not a regression:\n` +
    `[verify:bundle]   freshness is enforced by the byte-for-byte check \`scripts/build-client.mjs\`\n` +
    `[verify:bundle]   runs on every build (it fails the build when the artifact does not\n` +
    `[verify:bundle]   reproduce src/client/), by CI's \`git diff --exit-code -- lib\` gate, and\n` +
    `[verify:bundle]   the card's behaviour by test/client-bundle.test.js,\n` +
    `[verify:bundle]   test/card-host-parity.test.js and test/theme-token-contract.test.js.\n` +
    `[verify:bundle]   To compare against a specific earlier release, pass a ref that still\n` +
    `[verify:bundle]   carries the artifact: node scripts/verify-bundle-behaviour.mjs --baseline <ref>\n\n`,
  )
  process.exit(0)
}

/**
 * The card's pure functions. Every one of these is reachable inside the module
 * factory's scope, which is where the bundle leaves them.
 */
const PROBES = [
  'parseClock', 'localSecondsOf', 'offPeakState', 'rateAt', 'rateLabelOf',
  'windowLabelOf', 'formatCountdown', 'formatContextWindowForUi',
  'enabledIdsFor', 'imageModeOf', 'initialOpenForView', 'fieldSnapshot', 'withDate',
  // The card's refresh verdict (issue 05 / issue 10). It is pure and it decides
  // whether the user is told to update the plugin or to try again, so it belongs
  // in this comparison like every other pure function of the card: a rebuild that
  // dropped or inverted it must not pass as "behaves like its baseline".
  'refreshNoticeKey',
]

/**
 * A fixed instant, used while both bundles are fingerprinted.
 *
 * WHY: the probe pool deliberately contains `undefined`, and the card's
 * `localSecondsOf(undefined)` / `offPeakState(x, undefined)` fall back to the
 * wall clock. The two bundles are loaded milliseconds apart, so those calls
 * legitimately returned different seconds and the script reported "N differing
 * call(s)" for an artefact that had not changed — a flake that made this gate
 * untrustworthy exactly when it mattered. It was registered in
 * docs/KNOWN_GAPS.md（仍未建立的东西）as "freeze the probe clock"; this is that
 * fix.
 *
 * Patching `Date` alone was NOT enough, and the reason is worth recording:
 * `localSecondsOf` hands its argument straight to
 * `Intl.DateTimeFormat.format(date)`, and per ECMA-402 a non-Date argument is
 * converted to a Date via `ToNumber` — for `undefined` that is `NaN`, and the
 * result is `%CurrentDateTime%`: the *engine's* clock, read through an internal
 * slot that no `Date` override can reach. So the clock is frozen at the source
 * by replacing `Intl.DateTimeFormat` as well, which is the only handle a
 * bundled card actually reads time through.
 *
 * Applied only around the fingerprinting: `load()` itself runs real code that
 * must see the real clock.
 */
const FROZEN_NOW = Date.parse('2026-09-26T23:30:30+08:00')

/**
 * The instant a formatter should use for one argument.
 *
 * Only the no-instant forms are rewritten. A real `Date`, and every other value
 * (a string, a number, `null` handling aside), is the caller's intent and is
 * passed through — this patches the clock, not the card's parsing.
 */
function frozenInstantOf(date) {
  if (date === undefined || date === null) return FROZEN_NOW
  return date
}

function withFrozenClock(task) {
  const RealDate = globalThis.Date
  const RealIntl = globalThis.Intl
  class FrozenDate extends RealDate {
    constructor(...args) {
      // `new Date()` with no argument is the only form that reads the clock; any
      // explicit argument (including `undefined` passed through) is the caller's
      // real intent and must not be rewritten.
      if (args.length === 0) super(FROZEN_NOW)
      else super(...args)
    }
    static now() {
      return FROZEN_NOW
    }
  }
  globalThis.Date = FrozenDate
  // `Intl.DateTimeFormat` is what the card actually reads the clock through, and
  // the one that `Date`-patching cannot reach. A subclass keeps the real
  // implementation for every case except the one that matters here: a formatter
  // asked to format a non-Date (the probe's `undefined`) is given the frozen
  // instant instead of `%CurrentDateTime%`. `resolveOptions` and everything else
  // are inherited untouched, so the card's own logic — timezone handling, the
  // h23 wrap, the NaN guards — is what is still being compared.
  class FrozenDateTimeFormat extends RealIntl.DateTimeFormat {
    // Both entry points are covered because the card uses `formatToParts`, not
    // `format` — patching only the latter would have left the flake in place,
    // which is exactly what the first attempt did.
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
    return task()
  } finally {
    globalThis.Date = RealDate
    globalThis.Intl = RealIntl
  }
}

/** Serialise anything, including `undefined`, functions and Dates. */
function show(value, depth = 0) {
  if (depth > 4) return '…'
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'function') return `[Function ${value.name || 'anon'}]`
  if (value instanceof Date) {
    return `Date(${Number.isNaN(value.getTime()) ? 'Invalid' : value.toISOString()})`
  }
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => show(v, depth + 1)).join(',')}]`
  return `{${Object.keys(value).sort().map((k) => `${k}:${show(value[k], depth + 1)}`).join(',')}}`
}

/**
 * Execute a bundle and return what its factory exported, with the internal
 * functions attached.
 *
 * The factory already ends in `return module.exports;` — that line is widened
 * to also hand back the internals, which is the only way to reach them from
 * outside: the bundle exposes `apply`/`inject`/`name` and nothing else.
 */
function load(text) {
  const patched = text.replace(
    'return module.exports;',
    `return Object.assign(module.exports, {${
      // Each probe is reached through a `typeof` guard rather than by name
      // alone. A name the bundle no longer declares would otherwise be a bare
      // identifier in the injected object literal — a ReferenceError thrown
      // from inside the factory, which reads as "the bundle is broken" rather
      // than the accurate "this function is gone". `typeof` on an undeclared
      // name is safe, so a missing function arrives as `undefined`.
      PROBES.map((name) => `${name}: typeof ${name} === 'function' ? ${name} : undefined`).join(', ')
    }});`,
  )
  if (patched === text) throw new Error('could not find the factory return — the bundle shape changed')

  let captured
  const jsx = () => null
  const react = new Proxy({}, { get: (_t, key) => (key === 'Fragment' ? 'Fragment' : () => null) })
  globalThis.window = { __ModuleLoader__: { load: (module_) => { captured = module_ } } }
  const require_ = (id) => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
    throw new Error(`bundle required an unexpected module: ${id}`)
  }
  new Function(patched)()
  if (captured === undefined) throw new Error('the bundle never called __ModuleLoader__.load')
  return captured.factory(require_)
}

const PROMO = {
  active: true,
  windowStart: '22:00',
  windowEnd: '08:00',
  timezone: 'Asia/Shanghai',
  discountFactor: 0.4,
  beforePromotionPriceFactor: 0.025,
}

/**
 * Arguments worth throwing at a function whose signature is unknown: a wrong
 * shape is as informative as a right one, because both bundles get the same
 * wrong shape.
 */
const POOL = [
  undefined, null, 0, 1, -1, '', 'x', '22:00', '0.4', true, false,
  [], {}, [1, 2], { a: 1 },
  { promotion: PROMO },
  { promotion: { ...PROMO, active: false } },
  { models: [{ id: 'a', enabled: true }, { id: 'b' }] },
  // Host payloads carrying the refresh verdict. Without these every probe
  // argument would collapse to "no failures", and a card that had lost the
  // protocol-change branch would still be called identical.
  { refreshedAt: 1, refreshFailures: [] },
  { refreshedAt: 1, refreshFailures: [{ region: 'qoder', reason: 'fetch' }] },
  { refreshedAt: 1, refreshFailures: [{ region: 'qoder-cn', reason: 'protocol-shape-changed' }] },
  { refreshedAt: 1, refreshFailures: 'not-an-array' },
  new Date('2026-09-26T23:30:00+08:00'),
  new Date('2026-09-26T12:00:00+08:00'),
]

/**
 * Call every probe with every 1-arg and 2-arg combination from POOL.
 *
 * A probe that is not a function is reported as missing rather than skipped:
 * if a symbol vanished from BOTH bundles the fingerprints would agree and this
 * script would call that "identical". Both sides losing the same thing is the
 * one result a comparison cannot detect on its own.
 */
function fingerprint(scope) {
  const lines = []
  const missing = []
  for (const name of PROBES) {
    const fn = scope[name]
    if (typeof fn !== 'function') {
      missing.push(name)
      lines.push(`${name}: MISSING`)
      continue
    }
    for (const a of POOL) {
      for (const b of [undefined, ...POOL]) {
        let result
        try {
          result = `ok:${show(fn(a, b))}`
        } catch (error) {
          result = `throw:${error?.constructor?.name ?? 'Error'}:${String(error?.message ?? '').slice(0, 60)}`
        }
        lines.push(`${name}|${show(a)}|${b === undefined ? '-' : show(b)} => ${result}`)
      }
    }
  }
  return { lines, missing }
}

const oldFingerprint = withFrozenClock(() => fingerprint(load(OLD)))
const newFingerprint = withFrozenClock(() => fingerprint(load(NEW)))
const oldPrint = oldFingerprint.lines
const newPrint = newFingerprint.lines

let diffs = 0
for (let i = 0; i < Math.max(oldPrint.length, newPrint.length); i++) {
  if (oldPrint[i] === newPrint[i]) continue
  diffs++
  if (diffs <= 12) {
    console.log(`\n  DIFF`)
    console.log(`    baseline: ${(oldPrint[i] ?? '<none>').slice(0, 160)}`)
    console.log(`    rebuilt:  ${(newPrint[i] ?? '<none>').slice(0, 160)}`)
  }
}

/**
 * The off-peak gate is checked separately from the fingerprints: it is the one
 * line whose loss is silent (the card shows a discount the user is never
 * charged), and it is the needle `check-deploy-drift.mjs` looks for too.
 */
const gateOld = OLD.includes('promo.active !== true')
const gateNew = NEW.includes('promo.active !== true')

console.log(`\n${PROBES.length} probes x ${oldPrint.length} calls, baseline=${baselineRef}`)
console.log(`behaviour: ${diffs === 0 ? 'IDENTICAL' : `${diffs} differing call(s)`}`)
console.log(`off-peak gate: baseline=${gateOld} rebuilt=${gateNew}`)
if (newFingerprint.missing.length > 0) {
  console.log(`absent from the rebuild: ${newFingerprint.missing.join(', ')}`)
}

if (diffs !== 0 || !gateNew || newFingerprint.missing.length > 0) {
  console.log('\nFAIL: the rebuilt bundle does not behave like its baseline.')
  process.exitCode = 1
} else {
  console.log('OK: the rebuilt bundle behaves like its baseline on every probed call.')
}
