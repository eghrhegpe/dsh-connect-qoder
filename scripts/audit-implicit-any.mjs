/**
 * Count the implicit-`any` sites that `noImplicitAny` would reject, per file.
 *
 * Run: node scripts/audit-implicit-any.mjs [--write] [--budget N]
 *
 * WHY THIS EXISTS
 *
 * `tsconfig.json` runs with `strict: false` / `noImplicitAny: false`, so every
 * unannotated parameter and every un-annotated `let` sails through `npm run
 * typecheck`. That was a deliberate trade at migration time, but a permanent
 * exception is indistinguishable from a permanent hole: "we have 445 implicit
 * any" decays into "we have some number of implicit any" and nobody notices the
 * count going up.
 *
 * So the debt is made visible and *frozen*. This script turns it into a number
 * a gate can compare, and a budget a PR cannot raise without editing this file
 * in the same diff — which is the only honest way to take on more debt.
 *
 * WHAT IT COUNTS
 *
 * The same set `tsc --noImplicitAny` reports, grouped by file:
 *
 *   TS7006  parameter implicitly any      TS7031  variable implicitly any
 *   TS7005  destructured binding any       TS7018  `x` implicitly has type `any`
 *   TS7034  rest param any                 TS7019/7017/7011  from `any`-typed input
 *   TS7010  function expression any        TS7023  circular self-reference
 *
 * Only the files that `noImplicitAny` *governs* are counted. Note that
 * `--noImplicitAny` on the CLI reports MORE than the strict sub-flags it
 * implies (it pulls in the TS7031/TS7018 variable cases), so this script
 * prefers the project config's own sub-flags and only ever adds `noImplicitAny`
 * on top — the count is therefore the same one the compiler sees, not a guess.
 *
 * `--write` records the current totals into BUDGET below (raising the debt).
 * `--budget N` fails unless the total is at most N (tightening the debt).
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The debt ceiling. Only `--write` changes this, and that is the point: the
 * number that gates the build is edited deliberately, in a diff a reviewer
 * reads, rather than drifting as a side effect of ordinary work.
 *
 * 536 is the measured count, not an estimate. The migration commit reported
 * "445 implicit any", which was parameter positions only; turning the flag on
 * for real also reports the ~91 TS7031/TS7018 VARIABLE sites (`let x = …` with
 * no type and no inference), which a parameter-shaped count misses. Starting
 * the ratchet at 445 would have failed on the first run.
 *
 * Lowered batch by batch as the host modules were annotated: 536 → 502 → 445 →
 * 387 → 354 → 289 → 211 → 122 → 104 → 76 → 0. THE DEBT IS CLEARED, and
 * `noImplicitAny` is now `true` in tsconfig.json — the compiler enforces the
 * rule directly. This script stays as a second opinion and as the record of the
 * trajectory: it runs tsc with the individual flags spelled out (so it works
 * even if the project config is loosened again), and a budget of 0 means any
 * reintroduced `any` fails the build.
 *
 * Worth keeping in mind about where the last 104 went: 28 of them were not
 * "unannotated" at all, but INVISIBLE — a bare `declare module 'react';` types
 * every member as `any`, so nothing inside card.ts could be reported. Declaring
 * a real (if minimal) React surface immediately exposed 16 genuine type errors
 * the empty shell had been hiding, one of which was a real call-arity bug.
 * An `any` you cannot see is worth more attention than one you can.
 */
const BUDGET = 0

// Flags from tsconfig's `strict` family that `noImplicitAny` implies. Passing
// these explicitly keeps this script's count identical whether or not the
// project has `strict` turned on, so flipping the flag later does not silently
// change what "the same debt" means.
//
// `strictPropertyInitialization` is deliberately absent: it is inert without
// `strictNullChecks`, and naming it alone makes tsc refuse to run at all
// (TS5052). It governs class property init, not the implicit-`any` sites this
// script counts.
const IMPLIED = ['--noImplicitThis', '--strictFunctionTypes', '--strictBindCallApply']

const args = [
  '-p',
  join(root, 'tsconfig.json'),
  '--noEmit',
  '--noImplicitAny',
  ...IMPLIED,
  '--pretty',
  'false',
]

/**
 * tsc exits 2 whenever it has anything to say, so a full run ALWAYS throws here.
 * The report is on stdout, not in the error, which makes this script a reader of
 * a compiler failure — the one place where "expect the process to die" is the
 * correct shape rather than a mistake.
 */
let raw
try {
  raw = execFileSync(
    process.execPath,
    [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), ...args],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  )
} catch (err) {
  raw = err.stdout ?? ''
  if (!/error TS\d+:/.test(raw)) throw err
}

/** `src/host/foo.ts(12,3): error TS7006: …` → `{ file, count, detail }`. */
const lines = raw.split(/\r?\n/).filter((l) => /error TS\d+:/.test(l))

const perFile = new Map()
const unparsed = []
for (const line of lines) {
  const m = line.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/)
  if (!m) {
    // A diagnostic with no file position (a tsconfig error, say) would
    // otherwise vanish from the total without a trace. Never let a number be
    // quietly smaller than the compiler's.
    unparsed.push(line)
    continue
  }
  const [, file, , , code, detail] = m
  const key = relative(root, join(root, file)).replace(/\\/g, '/')
  const entry = perFile.get(key) ?? { count: 0, codes: new Map(), first: `${key}(${m[2]}:${m[3]})`, detail }
  entry.count += 1
  entry.codes.set(code, (entry.codes.get(code) ?? 0) + 1)
  perFile.set(key, entry)
}

const total = lines.length

if (process.argv.includes('--write')) {
  const body = [...perFile.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([file, e]) => `  ${String(e.count).padStart(4)}  ${file}  ${[...e.codes].map(([c, n]) => `${c}×${n}`).join(' ')}`)
    .join('\n')
  console.log(body)
  console.log(`\n${total} total — update BUDGET in scripts/audit-implicit-any.mjs by hand (no --write-in-place).`)
  process.exit(0)
}

if (unparsed.length > 0) {
  console.error(`\nFAIL implicit-any audit: ${unparsed.length} diagnostic(s) had no file position and are not counted:`)
  for (const l of unparsed) console.error(`  ${l}`)
  process.exit(1)
}

// Report before the gate so the failure is legible, not just a number.
const rows = [...perFile.entries()].sort((a, b) => b[1].count - a[1].count)
console.log(`implicit-any sites: ${total} (budget ${BUDGET})`)
for (const [file, e] of rows) {
  console.log(`  ${String(e.count).padStart(4)}  ${file}  ${[...e.codes].map(([c, n]) => `${c}×${n}`).join(' ')}`)
}

const budget = process.argv.includes('--budget')
  ? Number(process.argv[process.argv.indexOf('--budget') + 1])
  : BUDGET

if (!(total <= budget)) {
  console.error(
    `\nFAIL implicit-any ratchet: ${total} sites, budget ${BUDGET}. ` +
      `The debt grew. Annotate the new sites, or take the increase deliberately by ` +
      `editing BUDGET in scripts/audit-implicit-any.mjs — silently, this is how ` +
      `537 becomes 700 and nobody notices.`,
  )
  process.exit(1)
}