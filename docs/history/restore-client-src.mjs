/**
 * Split the shipped client bundle back into `src/client/*.ts`.
 *
 * Run: node scripts/restore-client-src.mjs
 *
 * WHY THIS IS A SCRIPT AND NOT A HAND TRANSCRIPTION
 *
 * `lib/client.js` is a 2004-line esbuild output with no sourcemap and no
 * sources in this repository (docs/issues/03, docs/issues/17). Re-typing it
 * by hand would be a second source of truth: every dropped semicolon would
 * show up later as an unexplained byte diff when the build is wired up. This
 * script copies the bundle's own text instead, so the only differences
 * between `src/` and `lib/` are the ones the bundler itself introduced —
 * which is exactly the set we need to reproduce.
 *
 * WHAT IT UNDOES
 *
 * - strips the two-tab indent the `factory:` wrapper adds to every line
 * - drops the CommonJS scaffolding esbuild emitted (`var module`,
 *   `var exports`, the `Symbol.toStringTag` tagging)
 * - turns `let x = require("y")` back into `import * as x from "y"`
 * - turns `exports.foo = foo` back into a single `export { ... }`
 * - discards the `//#region` markers, which are bundler output, not source
 *
 * WHAT IT DOES NOT DO
 *
 * - Type annotations. esbuild erased them and they cannot be recovered; the
 *   restored files are type-free TypeScript that compiles as-is. Restoring
 *   the signatures by hand is a separate pass (docs/issues/17).
 * - Any restructuring. `copy.ts` stays one 1575-line file it currently is,
 *   so the first build can be verified byte-for-byte before it is split.
 *
 * The `.ts` extension on `copy.ts` is deliberate even though the file holds
 * JSX: the bundle's region marker says `src/client/copy.ts`, and reproducing
 * the shipped bytes means reproducing that path. The build therefore loads
 * `.ts` as TSX, and `tsc` is not run over it until the file is renamed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const OPEN = '\tfactory: (require) => {\n'
const CLOSE = '\t\treturn module.exports;'

const start = bundle.indexOf(OPEN)
const end = bundle.indexOf(CLOSE)
if (start === -1 || end === -1) {
  throw new Error('lib/client.js is not shaped like a __ModuleLoader factory — the bundle was restructured')
}
const body = bundle.slice(start + OPEN.length, end)

/** One file's worth of restored source. */
const files = []
/** Lines before the first region: the require/import block. */
const pre = []
/** Lines after the last region: the unmarked module body plus the export block. */
const post = []
let current = null
let sawRegion = false

for (const raw of body.split('\n')) {
  const line = raw.replace(/^\t\t/, '')
  const region = /^\/\/#region (.+)$/.exec(line)
  if (region !== null) {
    sawRegion = true
    current = { path: region[1], lines: [] }
    files.push(current)
    continue
  }
  if (line === '//#endregion') {
    current = null
    continue
  }
  if (current !== null) current.lines.push(line)
  else if (sawRegion) post.push(line)
  else pre.push(line)
}

/** `let x = require("y")` back to a namespace import. */
const imports = []
/** `exports.foo = foo` back to a named export. */
const exports3 = []
for (const line of pre) {
  const req = /^let (\w+) = require\("([^"]+)"\);$/.exec(line)
  if (req !== null) {
    imports.push(`import * as ${req[1]} from "${req[2]}"`)
    continue
  }
  if (/^var (module|exports) = /.test(line) || line.startsWith('Object.defineProperty(exports')) continue
  if (line.trim() === '') continue
  throw new Error(`unhandled pre-region line: ${line}`)
}
/**
 * The unmarked module body.
 *
 * Between `copy.ts`'s closing marker (line 511) and `index.ts`'s opening one
 * (line 1904) sit 1390 lines — `IMAGE_MODES`, every formatting helper and all
 * five components — with NO `//#region` of their own. Whatever emitted this
 * bundle did not attribute them to a file, so restoring them means naming a
 * file the rebuild can produce the same way. `card.ts` is that placeholder;
 * the build reproduces the missing marker by loading `.ts` as TSX, which is
 * also the only reading under which a file holding JSX is named `.ts` at all.
 */
const unmarked = []
for (const line of post) {
  const exp = /^exports\.(\w+) = \w+;$/.exec(line)
  if (exp !== null) {
    exports3.push(exp[1])
    continue
  }
  if (line.trim() === '' && unmarked.length === 0) continue
  unmarked.push(line)
}
while (unmarked.length > 0 && unmarked[unmarked.length - 1].trim() === '') unmarked.pop()
if (unmarked.length > 0) {
  files.splice(files.length - 1, 0, { path: 'src/client/card.ts', lines: unmarked })
}

if (files.length === 0) throw new Error('no //#region markers found — nothing to restore')

// The import block belongs to whichever file actually reaches for react;
// esbuild hoisted it to the top of the bundle, so its position in the
// restored source is free as long as it is in a file the entry imports.
const consumer = files.find((file) => /react(?:_jsx_runtime)?\./.test(file.lines.join('\n')))
if (consumer === undefined) throw new Error('no file references react — the import block has nowhere to go')
consumer.lines.unshift('', ...imports)

const entry = files[files.length - 1]
entry.lines.push('', `export { ${exports3.join(', ')} }`)

// --- Rebuild the import graph that bundling erased -------------------------
// A bundle has no imports: every module's text is concatenated in dependency
// order. Restoring files therefore means restoring the edges too, which this
// derives instead of guessing — a symbol a file uses but does not declare
// must have come from whichever file declares it.

/**
 * Names too generic to infer an import from.
 *
 * The entry exports `name` / `inject` / `apply`, and `name` in particular
 * appears as a local variable all over the card. Treating those occurrences
 * as cross-file references invents a dependency on the entry from every
 * module — a cycle the original source cannot have had.
 */
const AMBIGUOUS = new Set(['name', 'inject', 'apply'])

/** Top-level names one file declares, in declaration order. */
const declared = (lines) => [
  ...new Set(
    [
      ...lines
        .join('\n')
        .matchAll(/^(?:export )?(?:async function|function|const|let|var|class) (\w+)/gm),
    ].map(
      (m) => m[1],
    ),
  ),
]

/** Symbols each file needs from elsewhere: `{ path, syms }`. */
const wanted = new Map()
for (const file of files) {
  const own = new Set(declared(file.lines))
  // Blank out string literals before looking for references: `"en-US"` is a
  // locale tag, not a use of the `en` copy table, and matching inside strings
  // invents imports that were never there.
  // Same-line only: a quote that opens a multi-line template literal must not
  // swallow the rest of the file, or the search below stops seeing the
  // identifiers inside it.
  const text = file.lines
    .join('\n')
    .replace(/"[^"\n]*"/g, '""')
    .replace(/'[^'\n]*'/g, "''")
  const needs = []
  for (const other of files) {
    if (other === file) continue
    const syms = declared(other.lines).filter(
      (sym) => !own.has(sym) && !AMBIGUOUS.has(sym) && new RegExp(`\\b${sym}\\b`).test(text),
    )
    if (syms.length > 0) needs.push({ from: other.path, syms })
  }
  wanted.set(file, needs)
}

/** Names each file has to export, i.e. the ones some other file borrows. */
const borrowedBy = new Map(files.map((file) => [file, new Set()]))
for (const needs of wanted.values()) {
  for (const need of needs) {
    const owner = files.find((file) => file.path === need.from)
    for (const sym of need.syms) borrowedBy.get(owner).add(sym)
  }
}

for (const file of files) {
  const needs = wanted.get(file)
  const borrowed = borrowedBy.get(file)
  // Mark the borrowed declarations as exported in their own file.
  file.lines = file.lines.map((line) => {
    const m = /^(async function|function|const|let|var|class) (\w+)/.exec(line)
    return m !== null && borrowed.has(m[2]) ? `export ${line}` : line
  })
  if (needs.length === 0) continue
  const stmts = needs.map(
    (n) => `import { ${n.syms.join(', ')} } from "./${n.from.replace(/^src\/client\//, '').replace(/\.ts$/, '')}"`,
  )
  // Keep the module's own imports (react) above the restored ones; the
  // bundler hoists them anyway, so their position is cosmetic.
  let at = 0
  file.lines.forEach((line, i) => {
    if (line.startsWith('import ')) at = i + 1
  })
  file.lines.splice(at, 0, ...stmts)
}

for (const file of files) {
  const target = join(root, file.path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${file.lines.join('\n').replace(/\n+$/, '\n')}`, 'utf8')
  console.log(`${file.path}: ${file.lines.length} lines`)
}
console.log(`${files.length} files restored into src/client/`)
