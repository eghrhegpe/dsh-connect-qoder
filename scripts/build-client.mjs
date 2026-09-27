/**
 * Rebuild `lib/client.js` from `src/client/*.ts` and compare it byte for byte
 * with the copy this repository ships.
 *
 * Run: node scripts/build-client.mjs [--write]
 *
 * `--write` overwrites `lib/client.js`; without it the bundle is emitted to
 * `.build/client.js` and the script only reports whether it matches. The
 * default is deliberately non-destructive: until the build reproduces the
 * shipped bytes, writing them would silently replace a working artifact with
 * a guess.
 *
 * The comparison is the point of this script. `lib/client.js` is the only
 * copy of the card's code this repository has (docs/issues/03), so a build
 * that merely "succeeds" proves nothing — what proves the restored sources
 * are faithful is that rebuilding them reproduces the same file. Any diff
 * printed here is either a build setting that is still wrong or a place
 * where the shipped bundle was edited by hand.
 *
 * The bundler comes from this package's own devDependencies, so a fresh clone
 * can run `npm install && npm run build`. The test suite still runs on a bare
 * `node --test` with nothing installed — that guarantee belongs to `npm test`,
 * not to `npm run build`, and conflating them is what kept this script
 * pointing at one machine's private directory. `TSDOWN_WORKSPACE` remains as
 * an escape hatch for building without installing.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const localRequire = createRequire(import.meta.url)

/** Load a bundler from this package, falling back to an external workspace. */
async function loadBundler(name) {
  try {
    return localRequire(name)
  } catch {
    const workspace = process.env.TSDOWN_WORKSPACE ?? process.env.ESBUILD_WORKSPACE
    if (workspace === undefined) {
      throw new Error(
        `${name} is not installed. Run \`npm install\`, or point TSDOWN_WORKSPACE at a directory that has it.`,
      )
    }
    return localRequire(join(workspace, 'node_modules', name))
  }
}

/**
 * Two bundlers are wired up because they disagree on the one thing that
 * decides whether the shipped bytes are reproducible: esbuild inlines an
 * imported `const` into its use sites and drops the declaration, while
 * rolldown (via tsdown) keeps it — and the shipped bundle keeps it. `--tsdown`
 * picks the latter; the default stays on esbuild only because it is the
 * smaller of the two installs.
 */
const useTsdown = process.argv.includes('--tsdown')
let body
if (useTsdown) {
  const tsdown = await loadBundler('tsdown')
  const outDir = join(root, '.build', 'tsdown')
  await tsdown.build({
    entry: [join(root, 'src', 'client', 'index.ts')],
    format: ['cjs'],
    // `browser` is what makes the CommonJS shim appear. Under the default
    // (node) platform tsdown assumes a real `module` binding exists and emits
    // a bare `module.exports = ...`, which the host loader cannot run — the
    // factory is handed only `require`, so `module` would be an unresolved
    // reference the moment the card mounts. The shipped bundle opens with
    // `var module = { exports: {} }` for exactly this reason.
    platform: 'browser',
    target: 'es2022',
    external: ['react', 'react/jsx-runtime'],
    outDir,
    dts: false,
    clean: true,
    silent: true,
  })
  const emitted = readdirSync(outDir).find((name) => /\.(cjs|js)$/.test(name))
  if (emitted === undefined) throw new Error('tsdown produced no output')
  body = readFileSync(join(outDir, emitted), 'utf8')
} else {
  const esbuild = await loadBundler('esbuild')
  const result = await esbuild.build({
    entryPoints: [join(root, 'src', 'client', 'index.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: ['react', 'react/jsx-runtime'],
    write: false,
    logLevel: 'warning',
  })
  body = result.outputFiles[0].text
}
/**
 * The CommonJS bindings the host loader does not provide.
 *
 * The factory is called with `require` and nothing else, but a CJS bundle
 * assigns to `exports` and returns `module.exports`. Neither bundler emits
 * these declarations (rolldown assumes the runtime supplies them; esbuild
 * too), so the wrapper supplies them — the same three lines the shipped
 * bundle opens with, and the same three `dsh-connect-workbuddy` opens with.
 * Without them the factory throws `module is not defined` before it mounts.
 */
const SHIM = [
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  // rolldown emits the `Module` tag itself when building for the browser;
  // esbuild does not. Add it only when it is missing, so the two bundlers
  // produce the same head instead of a duplicated line.
  ...(/Object\.defineProperty\(exports, Symbol\.toStringTag/.test(body)
    ? []
    : ['\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });']),
].join('\n')

/**
 * A pointer for whoever opens the artifact next.
 *
 * For the whole life of this plugin `lib/client.js` was the only copy of the
 * card's code, so it had to be edited by hand and its comments were the
 * documentation. Now that `src/client/` exists, this file is an output — and
 * the one thing a reader must not do is edit it and lose the change on the
 * next build.
 */
const HEADER =
  '/** Generated from src/client by scripts/build-client.mjs — edit the sources, not this file. */'

const bundle = [
  HEADER,
  'window.__ModuleLoader__.load({',
  '\tid: "dsh-connect-qoder",',
  '\tfactory: (require) => {',
  SHIM,
  body
    .split('\n')
    .map((line) => (line === '' ? '' : `\t\t${line}`))
    .join('\n'),
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')

/**
 * Strings the artifact must contain before it may replace the shipped one.
 *
 * This gate exists because a build can succeed while dropping everything that
 * matters. It already happened: the first attempt emitted 84 lines, because
 * `src/client/index.ts` imported nothing and the bundler treeshook every
 * module away — and exited 0. A bundle that "builds" but no longer contains
 * the card is silent, and it would overwrite a working artifact with a shell.
 *
 * Each needle below is one thing that must survive: the gate whose loss is
 * invisible, the card itself, the routes it reads, and the two bindings the
 * host does not provide (see SHIM and the jsx-runtime external).
 */
const REQUIRED = [
  ['function offPeakState(', 'the off-peak rule the card prices models with'],
  ['promo.active !== true', 'the gate that hides a discount Qoder has switched off'],
  ['function QoderPluginCard(', 'the card component'],
  ['function QoderAccountPanel(', 'the account panel component'],
  ['function installStyles(', 'the stylesheet injection'],
  ['function writeSettingsField(', 'the write-then-read-back settings path'],
  ['/plugins/dsh-connect-qoder/models', 'the model route the card renders rows from'],
  ['/plugins/dsh-connect-qoder/account/confirm', 'the sign-in confirmation route'],
  ['require("react/jsx-runtime")', 'the JSX runtime, which the host supplies'],
  ['var module = { exports: {} }', 'the CommonJS bindings the loader does not provide'],
]

const absent = REQUIRED.filter(([needle]) => !bundle.includes(needle))
if (absent.length > 0) {
  for (const [needle, why] of absent) console.error(`  absent: ${why}  (${JSON.stringify(needle)})`)
  throw new Error(
    `the build is incomplete — ${absent.length} required string(s) missing. ` +
      'Nothing was written; lib/client.js is untouched.',
  )
}

const shipped = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const write = process.argv.includes('--write')

if (write) {
  writeFileSync(join(root, 'lib', 'client.js'), bundle, 'utf8')
  console.log('wrote lib/client.js from src/client/')
} else {
  mkdirSync(join(root, '.build'), { recursive: true })
  writeFileSync(join(root, '.build', 'client.js'), bundle, 'utf8')
}

if (bundle === shipped) {
  console.log('MATCH: the rebuilt bundle is byte-for-byte identical to lib/client.js')
  process.exit(0)
}

/**
 * Lines that carry no source meaning, so a rebuilt bundle can be compared to
 * the shipped one on content rather than on ordering: bundler scaffolding,
 * the loader wrapper, and the `//#region` markers (which are emitted per
 * module and therefore shift whenever module order does).
 */
const noise = (trimmed) => {
  if (trimmed === '') return true
  // Per-module markers: `//#region src/...` (shipped) and `// src/...` (esbuild).
  if (trimmed === '//#endregion' || /^\/\/#region /.test(trimmed) || /^\/\/ src\//.test(trimmed)) {
    return true
  }
  // Bundler scaffolding. esbuild emits helper declarations and a CommonJS
  // export table; the shipped bundle has the loader's three-line preamble
  // instead. Neither is source.
  if (/^var __/.test(trimmed) || /^(__|\()/.test(trimmed)) return true
  if (/__(export|defProp|copyProps|toCommonJS|toESM|create)\(/.test(trimmed)) return true
  if (/^\(?\d+ && \(?module\.exports/.test(trimmed)) return true
  if (trimmed.startsWith('module.exports') || /^(var )?\w+_exports = /.test(trimmed)) return true
  if (/^(var module|var exports) = /.test(trimmed)) return true
  if (trimmed.startsWith('Object.defineProperty(exports')) return true
  if (/^\w+: \(\) => \w+,?$/.test(trimmed)) return true
  // The loader wrapper itself.
  if (trimmed.startsWith('window.__ModuleLoader__') || trimmed.startsWith('id: ')) return true
  if (trimmed.startsWith('factory: ') || trimmed === 'return module.exports;') return true
  if (trimmed === '}' || trimmed === '});') return true
  return false
}

const content = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !noise(line))

const onlyIn = (a, b) => {
  const counts = new Map()
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1)
  const out = []
  for (const line of a) {
    const left = counts.get(line) ?? 0
    if (left === 0) out.push(line)
    else counts.set(line, left - 1)
  }
  return out
}

const builtLines = content(bundle)
const shippedLines = content(shipped)
const missing = onlyIn(shippedLines, builtLines)
const extra = onlyIn(builtLines, shippedLines)
console.log(
  `CONTENT: ${builtLines.length} vs ${shippedLines.length} meaningful lines — ` +
    `${missing.length} only in shipped, ${extra.length} only in built`,
)
for (const line of missing.slice(0, 8)) console.log(`  shipped only: ${JSON.stringify(line).slice(0, 140)}`)
for (const line of extra.slice(0, 8)) console.log(`  built only:   ${JSON.stringify(line).slice(0, 140)}`)

const built = bundle.split('\n')
const target = shipped.split('\n')
console.log(`DIFF: ${built.length} lines built vs ${target.length} shipped`)
let shown = 0
for (let i = 0; i < Math.max(built.length, target.length) && shown < 15; i++) {
  if (built[i] === target[i]) continue
  console.log(`\n  @${i + 1}`)
  console.log(`  - built:   ${JSON.stringify(built[i] ?? '<eof>').slice(0, 160)}`)
  console.log(`  + shipped: ${JSON.stringify(target[i] ?? '<eof>').slice(0, 160)}`)
  shown++
}
process.exit(1)
