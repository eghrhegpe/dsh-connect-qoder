/**
 * Read-only probe: is THIS checkout compatible with the DSH host installed on
 * this machine, and — if not — what range would be?
 *
 * Run: node probe/host-compat.mjs
 *      node probe/host-compat.mjs --grep includePrerelease
 *      node probe/host-compat.mjs --grep satisfies --in dsh-app-boot
 *      node probe/host-compat.mjs --asar <path/to/app.asar>
 *
 * WHY THIS EXISTS
 *
 * A DSH desktop upgrade is invisible from inside this repository: nothing here
 * pins a host version, and the failure mode when the host moves on is a red
 * row in the plugin manager reading "incompatible-version" — with no log line
 * saying which range failed or why. Answering that question by hand means
 * opening the Electron app's `app.asar` (the shipped code lives in one binary
 * archive, not in a folder), finding the host's own copy of `semver`, and
 * evaluating the ranges with THAT copy rather than with intuition — because
 * `semver` desugars `<0.2` into `<0.2.0-0`, which is the whole reason a
 * pre-release like `0.2.0-rc.1` was rejected.
 *
 * This probe does all of it, and never writes anywhere but a temp dir.
 *
 * WHAT IT DOES
 *
 *   1. finds the installed host (or takes --asar)
 *   2. reads its `app.asar` header and lists every @deepseek-ai package version
 *   3. extracts the host's own `semver` into a temp dir and imports it, so the
 *      ranges are judged by the same library the host judges them with
 *   4. reports this checkout's peer ranges against the live runtime version,
 *      and against the versions a range would have to survive
 *
 * `--grep` instead searches the host's source, which is how the judging code
 * was located in the first place (`dsh-app-boot`, `includePrerelease`).
 */
import { openSync, readSync, closeSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')

const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? null : args[at + 1]
}
const has = (name) => args.includes(name)

/* ---------------------------------------------------------------- asar ---- */

/**
 * The archive is an Electron "pickle": 16 bytes of header framing followed by
 * a JSON tree. The header length is the uint32 at offset 12 — NOT at offset 4,
 * which is what an 8-byte-framing guess reads and what makes the whole parse
 * fail with a confusing JSON error. Files are addressed by `offset` relative
 * to `base`, and the offsets in the tree are strings.
 */
function openAsar(archive) {
  const fd = openSync(archive, 'r')
  const frame = Buffer.alloc(16)
  readSync(fd, frame, 0, 16, 0)
  const headerSize = frame.readUInt32LE(12)
  const headerBuf = Buffer.alloc(headerSize)
  readSync(fd, headerBuf, 0, headerSize, 16)
  closeSync(fd)
  const tree = JSON.parse(headerBuf.toString('utf8'))
  // The body starts after the header, padded up to a 4-byte boundary.
  const base = 16 + Math.ceil(headerSize / 4) * 4
  return { fd: null, archive, tree, base }
}

function readNode({ archive, base }, node) {
  const fd = openSync(archive, 'r')
  const buf = Buffer.alloc(Number(node.size))
  readSync(fd, buf, 0, Number(node.size), base + Number(node.offset))
  closeSync(fd)
  return buf
}

function walk(node, prefix = '', out = new Map()) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name
    if (child.files) walk(child, path, out)
    else if (typeof child.offset === 'string') out.set(path, child)
  }
  return out
}

const textOf = (handle, node) => readNode(handle, node).toString('utf8')

/* ------------------------------------------------------------- locating ---- */

function findAsar() {
  const explicit = flag('--asar')
  if (explicit) return existsSync(explicit) ? explicit : null
  const env = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const roots = [join(env, 'Programs'), '/Applications', join(homedir(), 'Applications')]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      if (!/deepseek|harness/i.test(entry)) continue
      for (const rel of ['resources/app.asar', 'Contents/Resources/app.asar']) {
        const p = join(root, entry, rel)
        if (existsSync(p)) return p
      }
    }
  }
  return null
}

/* --------------------------------------------------- the host's own semver -- */

/**
 * Judging a range with a *different* semver than the host's would be exactly
 * the "hand-copied rule" this repository distrusts, so the host's own copy is
 * unpacked and imported. It is a multi-file package, hence the temp dir.
 */
async function hostSemver(handle, files) {
  const entry = [...files.keys()].find((p) => /(^|\/)node_modules\/semver\/package\.json$/.test(p))
  if (!entry) return null
  const prefix = entry.slice(0, -'package.json'.length)
  const dest = join(tmpdir(), `dsh-host-semver-${process.pid}`)
  for (const [path, node] of files) {
    if (!path.startsWith(prefix)) continue
    const target = join(dest, path.slice(prefix.length))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, readNode(handle, node))
  }
  const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'))
  const main = pkg.main ?? 'index.js'
  const mod = await import(pathToFileURL(join(dest, main)).href)
  return { semver: mod.default ?? mod, version: pkg.version, dest }
}

/* ------------------------------------------------------------------ main --- */

const archive = findAsar()
if (!archive) {
  console.error('no DSH host found. Pass one explicitly:  --asar <path/to/app.asar>')
  process.exit(1)
}

const handle = openAsar(archive)
const files = walk(handle.tree)
console.log(`host archive: ${archive}`)
console.log(`             ${files.size} files, header read at offset 12 (16-byte framing)`)

const appPkgPath = [...files.keys()].find((p) => /(^|\/)package\.json$/.test(p) && !p.includes('node_modules'))
const appVersion = appPkgPath ? JSON.parse(textOf(handle, files.get(appPkgPath))).version : '(unknown)'
console.log(`app version : ${appVersion}`)

const hostPkgs = [...files.entries()]
  .filter(([p]) => /@[^/]+\/[^/]+\/package\.json$/.test(p))
  .map(([p, node]) => [/@[^/]+\/[^/]+(?=\/package\.json$)/.exec(p)[0], JSON.parse(textOf(handle, node)).version])
  .sort()

const bundled = new Map(hostPkgs.map(([n, v]) => [n, v]))
// Only the @deepseek-ai/dsh-* family is versioned as one runtime; other scopes
// bundle their own independent packages, which is why the short name is not
// enough to tell them apart.
const dshVersions = [...new Set(hostPkgs.filter(([n]) => n.startsWith('@deepseek-ai/dsh-')).map(([, v]) => v))]
const runtime = dshVersions.length === 1 ? dshVersions[0] : (hostPkgs.find(([n]) => n.startsWith('@deepseek-ai/dsh-'))?.[1] ?? appVersion)
console.log(`\nbundled packages: ${new Set(hostPkgs.map(([n]) => n)).size} distinct names (${hostPkgs.filter(([n]) => n.startsWith('@deepseek-ai/')).length} under @deepseek-ai)`)
console.log(`dsh-* runtime version: ${runtime}${dshVersions.length > 1 ? `  ! NOT in lockstep: ${dshVersions.join(', ')}` : ' (all @deepseek-ai/dsh-* in lockstep)'}`)
if (has('--all')) {
  console.log('\nall bundled scoped packages:')
  for (const [name, version] of bundled.entries()) console.log(`  ${name.padEnd(40)} ${version}`)
}

if (has('--grep')) {
  const needle = flag('--grep')
  const scope = flag('--in')
  console.log(`\ngrep ${JSON.stringify(needle)}${scope ? ` in ${scope}` : ''}:`)
  let hits = 0
  for (const [path, node] of files) {
    if (scope && !path.includes(scope)) continue
    if (!/\.(js|mjs|cjs|ts|json|yml|yaml)$/.test(path)) continue
    if (Number(node.size) > 2_000_000) continue
    const text = textOf(handle, node)
    const at = text.indexOf(needle)
    if (at === -1) continue
    const line = text.slice(0, at).split('\n').length
    const excerpt = text.split('\n')[line - 1].trim().slice(0, 220)
    console.log(`  ${path}:${line}\n      ${excerpt}`)
    hits += 1
    if (hits >= 25) {
      console.log('  … (truncated at 25 hits)')
      break
    }
  }
  if (hits === 0) console.log('  (no hits)')
  process.exit(0)
}

const loaded = await hostSemver(handle, files)
if (!loaded) {
  console.error('\nno semver inside the host archive — cannot judge ranges without guessing')
  process.exit(1)
}
const { semver, version: semverVersion } = loaded
const options = { includePrerelease: true }

const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const peers = Object.entries(manifest.peerDependencies ?? {})

/**
 * Two populations, judged differently, because that is what the host does:
 * the compatibility gate iterates the `@deepseek-ai/dsh-*` peers and compares
 * each against ONE runtime version, while every other peer is just a module
 * the plugin imports — it is satisfied or not by whatever copy is bundled.
 */
const isDshPeer = (name) => name.startsWith('@deepseek-ai/dsh-')
const versionFor = (name) => bundled.get(name) ?? null

console.log(`\npeer check — judged by the host's own semver ${semverVersion}`)
console.log(`            semver.satisfies(version, range, { includePrerelease: true })\n`)
let failures = 0
console.log(`  the ${peers.filter(([n]) => isDshPeer(n)).length} peers the host's gate checks, against runtime ${runtime}:`)
for (const [name, range] of peers.filter(([n]) => isDshPeer(n))) {
  const ok = semver.satisfies(runtime, range, options)
  if (!ok) failures += 1
  console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${name.replace('@deepseek-ai/', '').padEnd(30)} ${range}`)
}
console.log(`\n  the other peers, against the copy the host actually bundles:`)
for (const [name, range] of peers.filter(([n]) => !isDshPeer(n))) {
  const version = versionFor(name)
  if (version === null) {
    console.log(`    ?     ${name.padEnd(38)} ${range}  (not bundled — nothing to judge)`)
    continue
  }
  const ok = semver.satisfies(version, range, options)
  if (!ok) failures += 1
  console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(38)} ${range}  <- ${version}`)
}

console.log(`\nwhat each dsh-* range would admit (the same judgement, other runtimes):`)
const probes = ['0.1.7', '0.2.0-rc.1', '0.2.0', '0.2.7', '0.3.0', '1.0.0']
console.log(`  ${'range'.padEnd(22)} ${probes.map((p) => p.padStart(11)).join('')}`)
for (const range of new Set(peers.filter(([n]) => isDshPeer(n)).map(([, r]) => r))) {
  const row = probes.map((p) => (semver.satisfies(p, range, options) ? 'yes' : 'no').padStart(11)).join('')
  console.log(`  ${range.padEnd(22)} ${row}`)
}
console.log(`\n  (a range that admits 0.3.0 has lost its guardrail — the point of the`)
console.log(`   upper bound is to stop before the next breaking generation)`)

process.exit(failures === 0 ? 0 : 1)
