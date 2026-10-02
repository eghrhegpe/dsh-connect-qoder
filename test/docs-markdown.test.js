/**
 * Guard the converted Qoder-CN reference docs (`docs/docs-qoder-cn/*.md`)
 * against the class of corruption that produced them.
 *
 * Run: node --test test/docs-markdown.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * These `.md` files are generated: `convert-qoder-docs.ps1` cleans the raw
 * captures (MDX containers, tabs, inline tags) into plain Markdown, and the
 * original `.txt` sources were then deleted. That makes the conversion a
 * one-way door — nothing downstream can tell a faithful conversion from a
 * mangled one, and `docs-facts.test.js` does not read this directory at all
 * (it guards prose claims, not rendering). So the corruption that shipped in
 * 704c684 went unnoticed for exactly as long as it took someone to look:
 *
 *   1. `<!-- … -->` comments became `&amp;lt;!-- …`, because the escaper
 *      converted `<` to `&lt;` BEFORE converting `&` to `&amp;` — creating a
 *      fresh `&` on its way past. Two "Temporarily hidden … Keep for
 *      restoration" blocks in `Qwen 系列模型特惠折扣.md` rendered as literal
 *      text instead of staying hidden.
 *   2. Query separators in links became `\&amp;`, the same double-conversion
 *      applied to a legitimate Markdown `\&` escape — three subscription
 *      links in `计费说明.md` pointed at `…?tab=qoderwork-cli\&amp;type=…`.
 *
 * Both are silent: the file is still valid UTF-8, still opens, still renders
 * *something*. The fix is in the converter, but a converter is only ever run
 * by hand, so the guard has to live on the OUTPUT.
 *
 * WHAT IT CHECKS. Only the two shapes the escaper can actually damage, plus
 * the two structural properties whose loss would make the docs unusable. It
 * deliberately does NOT try to validate the prose or the tables: a rule that
 * guesses at content would fail on a faithful re-conversion of a changed
 * upstream page, and a gate that cries wolf gets deleted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOC_DIR = join(root, 'docs', 'docs-qoder-cn')

/**
 * Every converted doc, as `{ name, text }`.
 *
 * Read live from disk rather than from a hardcoded list, so a newly converted
 * page is guarded the moment it lands — the failure mode this file exists for
 * is "someone converted a page and nobody looked at the output".
 */
const docs = readdirSync(DOC_DIR)
  .filter((name) => name.endsWith('.md'))
  .map((name) => ({ name, text: readFileSync(join(DOC_DIR, name), 'utf8') }))

/**
 * The liveness guard.
 *
 * A gate over a glob is one `readdirSync` away from guarding nothing: rename
 * the directory, or land the conversion under a different extension, and every
 * loop below runs zero times and passes. This asserts the population itself,
 * so an empty directory fails loudly instead of going green.
 */
test('the converted docs are present and non-trivial', () => {
  assert.ok(
    docs.length >= 7,
    `expected at least 7 converted docs in docs/docs-qoder-cn, found ${docs.length} — ` +
      'the guard below would otherwise pass by iterating nothing',
  )
  for (const { name, text } of docs) {
    assert.ok(text.trim().length > 200, `${name} is suspiciously short (${text.trim().length} chars)`)
  }
})

/**
 * No double-escaped entities anywhere.
 *
 * `&amp;lt;` / `&amp;gt;` / `&amp;amp;` / `\&amp;` are the fingerprints of the
 * escaper's ordering bug: each one is an entity (or an escape) that was
 * converted a second time. A faithful conversion cannot produce them, because
 * the escaper now skips `&` that already begins an entity or is backslash-
 * escaped — so this pattern is a pure regression detector, not a style rule.
 */
test('no entity in the converted docs was escaped twice', () => {
  const DOUBLE = [
    [/&amp;(?:lt|gt|amp|quot|#\d+);/, 'an HTML entity was escaped a second time'],
    [/\\&amp;/, 'a backslash-escaped `&` was escaped a second time'],
  ]
  let scanned = 0
  for (const { name, text } of docs) {
    for (const [re, why] of DOUBLE) {
      const m = re.exec(text)
      scanned += 1
      assert.equal(
        m,
        null,
        `${name}: found ${JSON.stringify(m?.[0] ?? '')} — ${why}. ` +
          'Re-convert with convert-qoder-docs.ps1 (escape `&` before `<`), do not hand-patch only this line.',
      )
    }
  }
  assert.ok(scanned > 0, 'the double-escape patterns never ran')
})

/**
 * HTML comments are still comments.
 *
 * The converter's step 4 turns MDX `{/* … *\/}` into `<!-- … -->` precisely so
 * the block stays hidden — upstream writes "Temporarily hidden … Keep for
 * restoration" on the commented-out discount rows. An escaper that touches the
 * comment body defeats that, so every `<!--` must be a real comment opener
 * (i.e. not preceded by an escape) and must be closed on the same or a later
 * line.
 */
test('every HTML comment is a live comment, opened and closed', () => {
  let comments = 0
  for (const { name, text } of docs) {
    const lines = text.split('\n')
    let open = false
    for (const [i, line] of lines.entries()) {
      // An opener that the escaper mangled would read `&lt;!--`, which does not
      // match this pattern at all — so the assertions below only see real ones.
      if (line.includes('<!--')) {
        assert.ok(!open, `${name}:${i + 1}: a second <!-- opened while the previous one was still open`)
        open = true
        comments += 1
      }
      if (line.includes('-->')) {
        assert.ok(open, `${name}:${i + 1}: a --> closed a comment that was never opened`)
        open = false
      }
    }
    assert.equal(open, false, `${name}: an HTML comment is never closed — the rest of the file renders inside it`)
  }
  assert.ok(comments > 0, 'no HTML comment found in any converted doc — the pattern has gone stale')
})

/**
 * Code fences are balanced.
 *
 * An odd fence count means everything after the unclosed one renders as code.
 * The converter tracks fence state line by line, so an unbalanced output is a
 * converter bug by construction. Both the opening and closing forms may be
 * indented, which is why this uses the same `^\s*``` ` shape the converter
 * does rather than a bare `^```` — matching the wrong shape here is exactly
 * how a previous manual audit produced a false alarm on this very directory.
 */
test('code fences are balanced in every converted doc', () => {
  let fences = 0
  for (const { name, text } of docs) {
    const count = text.split('\n').filter((line) => /^\s*```/.test(line)).length
    fences += count
    assert.equal(
      count % 2,
      0,
      `${name}: ${count} code fences — an odd count leaves the rest of the file inside a code block`,
    )
  }
  assert.ok(fences > 0, 'no code fence found in any converted doc — the pattern has gone stale')
})

/**
 * No MDX leftovers.
 *
 * The conversion exists to remove `<Warning>` / `<Tab>` / `<CodeGroup>` style
 * containers. A stray one means a page was converted by a rule that did not
 * cover it — and it renders as visible angle-bracket noise, since the escaper
 * only escapes what is left *after* the container pass.
 */
test('no MDX container tag survived the conversion', () => {
  const MDX = /<(?:Warning|Note|Tip|Tabs|Tab|CodeGroup|Accordion|Card|Steps|ul|li|b|i)\b[^>]*>/
  let scanned = 0
  for (const { name, text } of docs) {
    scanned += 1
    // Fenced code may legitimately contain such text (a sample snippet), so
    // only the prose is checked — same exclusion the converter itself uses.
    let inFence = false
    for (const [i, line] of text.split('\n').entries()) {
      if (/^\s*```/.test(line)) { inFence = !inFence; continue }
      if (inFence) continue
      const m = MDX.exec(line)
      assert.equal(m, null, `${name}:${i + 1}: MDX tag survived the conversion: ${JSON.stringify(m?.[0] ?? '')}`)
    }
  }
  assert.ok(scanned > 0, 'the MDX scan never ran')
})