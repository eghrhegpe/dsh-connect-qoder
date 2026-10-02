/**
 * Count the EXPLICIT `any` sites in the plugin's source, per file.
 *
 * Run: node scripts/audit-explicit-any.mjs [--write] [--budget N]
 *
 * WHY THIS EXISTS
 *
 * `audit-implicit-any.mjs` covers the sites the compiler rejects under
 * `noImplicitAny`. This covers the other half, and they are genuinely a
 * different class: an explicit `any` is hand-written, the compiler never
 * complains about it, and turning on every strict flag in the book will not
 * surface one. `tsc` reported 0 errors for the whole of the explicit-`any`
 * migration that precedes this script — the 70 sites were invisible to it by
 * construction, which is exactly why an `any` budget cannot be a compiler run.
 *
 * So this parses the source text. That is a weaker instrument than tsc, and the
 * trade is deliberate: the alternative is no visibility at all. To keep the
 * weaker instrument honest it errs toward OVER-counting — a line that mentions
 * `any` in a way this file cannot classify is counted and reported, so the
 * number is never quietly smaller than the truth. Prose is excluded by
 * stripping comments and string literals first, which is what makes the count
 * meaningful rather than a grep for the substring.
 *
 * WHAT IT COUNTS
 *
 *   `: any`            a parameter, property, return type or annotation
 *   `<any>`            an explicit type argument
 *   `as any`           a cast
 *   `any[]`            an array of them
 *
 * ALLOWED SITES, each with the reason it is not debt. A line is allowed when it
 * matches one of these; anything else counts.
 *
 * 1. `(...args: any[]) => any` in a generic CONSTRAINT. `T extends (...args:
 *    any[]) => any` is the standard spelling for "some function" and is what
 *    lib.es5.d.ts itself uses. Narrowing it to `unknown[]` breaks every call
 *    site, because `unknown[]` is not assignable to a parameter list.
 * 2. A line carrying `any-ok:` — an escape hatch for a site with a reason too
 *    long to encode as a pattern. It is greppable on purpose: every use of it
 *    is a place a reviewer should look.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The debt ceiling. Only `--write` changes this, and that is the point: the
 * number that gates the build is edited deliberately, in a diff a reviewer
 * reads, rather than drifting as a side effect of ordinary work.
 *
 * Trajectory during the migration, batch by batch:
 *   70 → 25 → 15 → 8 → 5 → 1
 *
 * The last one is `src/client/react-shim.d.ts`, and it is NOT debt:
 *
 *   `export function useCallback<T extends (...args: any[]) => any>(...)`
 *
 * That file is a hand-written minimal declaration of the React surface the card
 * uses, because this repository deliberately does not install `@types/react`
 * for it (the card is bundled for the browser; its real types arrive from the
 * host at build time). `T extends (...args: any[]) => any` is the exact spelling
 * React's own types use for `useCallback`, and it is a CONSTRAINT rather than a
 * value: it says "the argument must be callable with anything the caller
 * passes". Rewriting it as `unknown[]` would not remove an `any` from anything
 * the user's code sees — it would make every existing call site fail to
 * typecheck against a declaration that exists only to describe the harness.
 *
 * The larger point is that this file is DEV-ONLY and not published (see
 * package.json `files`), so its `any` cannot reach a consumer.
 *
 * The budget is therefore 0 and the exception is handled by the `isAllowed`
 * rule below, NOT by leaving headroom. That distinction is the whole point of a
 * ratchet: with `BUDGET = 1` this script counted a newly introduced `: any`
 * correctly and still exited 0, because one site plus the allowance is not
 * "more than one". A budget that can absorb an unrelated site is not a gate.
 * Allowing the constraint by pattern keeps the ceiling at zero, so ANY new
 * `any` — including one in a file that has never had one — fails the build.
 */
const BUDGET = 0

/** Directories to scan, relative to the repo root. */
const SOURCES = ['src/host', 'src/client']

/** Every `.ts` file under the scanned directories. */
function sources(dir) {
  const out = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...sources(rel))
    else if (entry.name.endsWith('.ts')) out.push(rel)
  }
  return out
}

/**
 * Blank out comments and string literals, preserving line structure.
 *
 * Line numbers must survive (the report names them), so every removed
 * character becomes a space rather than being deleted. This is what separates
 * "a line that mentions `any`" from "a line that uses `any`" — the migration's
 * own commit messages and doc comments quote `any` constantly, and a grep for
 * the substring reports all of them as debt.
 *
 * Known limits, both of which OVER-count rather than under-count, which is the
 * direction that matters: a regex literal containing `/*` or a template literal
 * with a nested backtick can desynchronise the scanner, and the lines after it
 * are then treated as code. Anything that survives is reported and can be
 * allowed explicitly.
 */
function stripCommentsAndStrings(text) {
  let out = ''
  let i = 0
  const n = text.length
  // `mode` is what the scanner is inside of: code, or a comment/string form.
  let mode = 'code'
  while (i < n) {
    const c = text[i]
    const c2 = text[i + 1]
    if (mode === 'code') {
      if (c === '/' && c2 === '/') { mode = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && c2 === '*') { mode = 'block'; out += '  '; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { mode = c; out += ' '; i += 1; continue }
      out += c
      i += 1
      continue
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += '\n'; i += 1; continue }
      out += ' '
      i += 1
      continue
    }
    if (mode === 'block') {
      if (c === '*' && c2 === '/') { mode = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i += 1
      continue
    }
    // Inside a string literal of the current quote character.
    if (c === '\\') { out += '  '; i += 2; continue }
    if (c === mode) { mode = 'code'; out += ' '; i += 1; continue }
    out += c === '\n' ? '\n' : ' '
    i += 1
  }
  return out
}

/** The patterns that constitute a site, in the order they are reported. */
const PATTERNS = [
  [/:\s*any\b/g, ': any'],
  [/<any>/g, '<any>'],
  [/\bas\s+any\b/g, 'as any'],
  [/\bany\[\]/g, 'any[]'],
]

/**
 * Whether a line is an allowed exception rather than debt.
 *
 * Pattern 1 is matched against the line text; the `any-ok:` escape hatch is
 * matched against the ORIGINAL line, so the marker can live in the comment or
 * string that the stripper removed.
 */
function isAllowed(code) {
  // `T extends (...args: any[]) => any` — see BUDGET for why this is correct.
  if (/extends\s*\(\s*\.\.\.\s*\w+\s*:\s*any\[\]\s*\)\s*=>\s*any/.test(code)) return true
  return false
}

const perFile = new Map()
let total = 0
const notAllowed = []

for (const file of SOURCES.flatMap(sources).sort()) {
  const raw = readFileSync(join(root, file), 'utf8')
  const text = stripCommentsAndStrings(raw)
  const rawLines = raw.split(/\r?\n/)
  const lines = text.split(/\r?\n/)
  for (let idx = 0; idx < lines.length; idx += 1) {
    const code = lines[idx]
    const original = rawLines[idx] ?? ''
    if (!/\bany\b/.test(code)) continue
    if (isAllowed(code) || /any-ok:/.test(original)) continue
    const found = PATTERNS.filter(([re]) => re.test(code))
    if (found.length === 0) continue
    total += 1
    const entry = perFile.get(file) ?? []
    entry.push({ line: idx + 1, detail: original.trim() })
    perFile.set(file, entry)
    notAllowed.push(`${file}:${idx + 1}: ${original.trim()}`)
  }
}

if (process.argv.includes('--write')) {
  for (const [file, sites] of [...perFile.entries()].sort()) {
    console.log(`  ${String(sites.length).padStart(3)}  ${file}`)
    for (const s of sites) console.log(`         L${s.line}: ${s.detail}`)
  }
  console.log(`\n${total} total — update BUDGET in scripts/audit-explicit-any.mjs by hand (no --write-in-place).`)
  process.exit(0)
}

// Report before the gate so the failure is legible, not just a number.
console.log(`explicit-any sites: ${total} (budget ${BUDGET})`)
for (const [file, sites] of [...perFile.entries()].sort()) {
  console.log(`  ${String(sites.length).padStart(3)}  ${file}`)
  for (const s of sites) console.log(`         L${s.line}: ${s.detail}`)
}

const budget = process.argv.includes('--budget')
  ? Number(process.argv[process.argv.indexOf('--budget') + 1])
  : BUDGET

if (!(total <= budget)) {
  console.error(
    `\nFAIL explicit-any ratchet: ${total} sites, budget ${BUDGET}. ` +
      `The debt grew. Annotate the new sites, or take the increase deliberately by ` +
      `editing BUDGET in scripts/audit-explicit-any.mjs — silently, this is how ` +
      `1 becomes 40 and nobody notices.`,
  )
  process.exit(1)
}

// The count and the file must agree, or the budget above is meaningless: an
// allowed pattern that stopped matching would make this pass while real sites
// pile up. `relative` rather than a bare join so the message is path-stable.
void relative
