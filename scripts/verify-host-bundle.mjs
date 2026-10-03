/**
 * Prove `lib/index.js` is a faithful, current build of `src/host/`.
 *
 * Run: npm run verify:host  (also part of `npm run verify`)
 *
 * WHY THIS EXISTS
 *
 * Before the TypeScript migration the host half WAS `lib/*.js`: the files the
 * suite imported were the files that shipped, so a stale artifact was
 * impossible. Now `src/host/*.ts` is the source of truth and `lib/index.js` is
 * a build artifact, which introduces a failure mode the old layout could not
 * have — edit the source, forget to rebuild, and the deployed plugin runs last
 * week's code with a version number that says otherwise. `lib/` is versioned
 * (docs/issues/19), so a fresh build and the committed bytes are compared
 * directly rather than leaving the check to git's ignore rules.
 *
 * WHAT IT CHECKS
 *
 * 1. PRESENT — `lib/index.js` exists and is non-empty. A checkout that was
 *    never built fails here rather than shipping an empty entry point.
 * 2. FRESH — rebuilding from `src/host/` reproduces the artifact byte-for-byte.
 *    The build is deterministic (single entry, `splitting: false`, no minify,
 *    no sourcemap), so any difference means the committed-into-the-working-tree
 *    artifact is stale.
 * 3. ENTRY — the bundle keeps the plugin's public surface: it still exports
 *    `Config` and `apply`, and it still declares the three peer packages the
 *    runtime resolves rather than bundling them. This is what catches a
 *    `deps.neverBundle` regression that would otherwise inline a Host package
 *    into the plugin and break at activation.
 *
 * A machine without dev dependencies (no `tsdown`) prints a loud SKIP and exits
 * 0: the suite is deliberately installable-free, and a missing devDependency is
 * not a regression.
 *
 * That path is reached by a bare checkout running `node scripts/verify-host-bundle.mjs`
 * directly, NOT by CI. Both jobs in `.github/workflows/test.yml` run
 * `npm install` and `npm run build` first, so `tsdown` is always present there
 * and the FRESH checks always execute; and `npm run verify` could not reach the
 * SKIP anyway, because its own `build` step needs tsdown and fails first. The
 * earlier wording here claimed "CI's offline job always takes that path", which
 * described a job that does not exist.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(root, 'lib', 'index.js')

const results = []
const check = (name, pass, detail = '') => {
  // `detail` is the failure explanation; it is recorded on every outcome but
  // only ever PRINTED when the check failed, so a passing run stays readable.
  results.push({ name, pass, detail: pass ? '' : detail })
  if (!pass) console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const fresh = existsSync(BUNDLE) ? readFileSync(BUNDLE, 'utf8') : null

// 1. the artifact exists at all
check('lib/index.js exists', fresh !== null, 'run `npm run build` first')
check('lib/index.js is non-empty', fresh !== null && fresh.trim().length > 0)

if (fresh === null) {
  console.log(JSON.stringify(results, null, 2))
  process.exit(1)
}

// 2. freshness — only meaningful when the builder is installed.
if (!existsSync(join(root, 'node_modules', 'tsdown', 'package.json'))) {
  process.stderr.write(
    '\n[verify:host] SKIPPED the freshness check — tsdown is not installed.\n' +
    '[verify:host]   Bootstrap dev deps with: npm i -D tsdown --legacy-peer-deps\n' +
    '[verify:host]   (this package\'s peerDependencies are Host-runtime packages and do\n' +
    '[verify:host]   not resolve from a registry, so a plain `npm install` cannot run here).\n' +
    '[verify:host]   The existing artifact was checked for presence and shape only.\n\n',
  )
} else {
  // A single command string avoids Node's DEP0190 warning about passing an
  // args array together with `shell: true`.
  const build = spawnSync('npm run build:host', {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: 180_000,
  })
  check(
    'npm run build:host exits 0',
    !build.error && build.status === 0,
    String(build.stderr ?? build.error ?? '').slice(-2000),
  )

  if (!build.error && build.status === 0) {
    const rebuilt = readFileSync(BUNDLE, 'utf8')
    check(
      'lib/index.js is fresh (a rebuild reproduces it byte-for-byte)',
      rebuilt === fresh,
      'the artifact is stale — rebuild with `npm run build` and ship the result',
    )
  }
}

// 3. the public surface survived bundling
check('bundle declares the Config schema export', /\bConfig\b/.test(fresh))
check('bundle declares the apply entry point', /\bapply\b/.test(fresh))
check('bundle keeps the node: builtins external', /from\s*["']node:/.test(fresh))
for (const peer of ['@deepseek-ai/dsh-llm', '@deepseek-ai/schemastery', '@earendil-works/pi-ai']) {
  check(
    `peer ${peer} resolves from the Host runtime, never bundled`,
    fresh.includes(peer),
    `the bundle no longer mentions ${peer} — deps.neverBundle may have lost it`,
  )
}
check(
  'the client artifact was not emitted into the host bundle',
  !/__ModuleLoader__/.test(fresh),
  'the host bundle carries the browser loader shell — the two entries have crossed',
)

console.log(JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.pass)
if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} check(s) FAILED`)
  process.exit(1)
}
console.log(`\nall ${results.length} checks passed`)
