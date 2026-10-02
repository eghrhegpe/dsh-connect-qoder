/**
 * Position gate #3 — the card's class names must line up with its stylesheet
 * in BOTH directions.
 *
 * Run: node --test test/class-name-parity.test.js
 *
 * `card.tsx` and its two panels put `dsm-qoder-*` / `dsm-plugin-card-*` classes
 * on the DOM, and `styles.ts` is the only place they are styled. Neither
 * direction is safe to drift:
 *
 * - a class applied to the DOM but never defined in `styles.ts` is SILENTLY
 *   unstyled — the node renders, the modifier does nothing, and nothing flags
 *   it. That is exactly the `.dsm-qoder-badge-offer` bug this gate caught on
 *   its first run: `card.tsx` applied it to the off-peak badge, `styles.ts`
 *   had never defined it, so an active promotion looked identical to a normal
 *   badge. `typecheck` could not see it; a status code could not see it.
 * - a style rule never applied to anything is dead CSS, and it invites a later
 *   reader to trust a name that no DOM node carries.
 *
 * The "referenced" set is read from STRING and TEMPLATE literals only, so a
 * class name that appears in a comment does not count as a usage. `styles.ts`
 * is excluded from that scan: it is the definition source, and its own strings
 * name the `@keyframes` animations (`dsm-qoder-shimmer`, `dsm-qoder-flash`) —
 * those are animation names, not class names, and would otherwise look like
 * usages.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const CLASS_TOKEN = /(dsm-(?:qoder|plugin-card)[-\w]+)/g

/**
 * Every dsm-* class token inside a string or template literal.
 *
 * A fresh regex per call: `matchAll` needs a global flag, and a module-level
 * `/g` regex carries `lastIndex` state that would leak across callers.
 */
function literals(source) {
  return source.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g)
}

/** Class names applied by the client source (all files but `styles.ts`). */
function referencedClasses() {
  const out = new Set()
  for (const f of readdirSync(join(root, 'src/client'))) {
    if (f === 'styles.ts') continue
    if (!/\.(?:ts|tsx)$/.test(f)) continue
    for (const lit of literals(read(`src/client/${f}`))) {
      for (const m of lit[0].matchAll(CLASS_TOKEN)) out.add(m[1])
    }
  }
  return out
}

/** Class selectors defined in the stylesheet's string table. */
function definedClasses() {
  const out = new Set()
  for (const m of read(STYLES).matchAll(/"\.((?:dsm-qoder|dsm-plugin-card)[-\w]+)/g)) out.add(m[1])
  return out
}

const STYLES = 'src/client/styles.ts'

test('every class the card puts on the DOM is styled', () => {
  const used = referencedClasses()
  const defined = definedClasses()
  const missing = [...used].filter((c) => !defined.has(c))
  assert.deepEqual(
    missing,
    [],
    `these classes are applied but have no style rule: ${missing.join(', ')}`,
  )
})

test('every style rule is applied by the card', () => {
  const used = referencedClasses()
  const defined = definedClasses()
  const orphan = [...defined].filter((c) => !used.has(c))
  assert.deepEqual(
    orphan,
    [],
    `these style rules are never applied by the card: ${orphan.join(', ')}`,
  )
})
