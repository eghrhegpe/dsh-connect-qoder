/**
 * Detect a deployed copy of this plugin that has drifted from this checkout.
 *
 * Run: npm run verify:deploy
 *
 * WHY THIS EXISTS
 *
 * One machine can hold several installs of the same plugin, and they do not
 * move together. A `link:` install is a symlink to this checkout and is always
 * current; a registry install is a *copy*, frozen at whatever was published
 * when it was added. Nothing re-syncs them, and both copies report the same
 * `version` from package.json — so every upgrade tool that compares versions
 * concludes "already up to date" while the user is running code from weeks ago.
 *
 * That is not hypothetical: this script was written after finding a deployed
 * copy that lacked the off-peak `active` gate (the card would show a discount
 * the user is never charged) and lacked the `/account` routes entirely, while
 * carrying the same version number as the checkout that had both.
 *
 * WHAT IT COMPARES
 *
 * Content hashes of `lib/**`, file presence, and three markers that each began
 * as a real defect. A version comparison is reported separately, because
 * "same version, different content" is precisely the trap.
 *
 * Exit status: 0 when every install is in sync (or none exists), 1 on drift,
 * 2 on a usage problem. Pure comparison logic is exported so a test can build a
 * fake profile tree and assert what counts as drift.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** sha256 of a file's bytes, or `undefined` when it cannot be read. */
export function hashFile(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return undefined
  }
}

/** The `version` field of a package.json, or `undefined` when unreadable. */
function readVersion(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

/** Every file under `dir`, as posix-style relative paths, sorted. */
function listFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

/**
 * The markers that each started as a shipped defect.
 *
 * They are literal source strings rather than hashes so the report can say
 * *what* is stale instead of only *that* something is — "the off-peak gate is
 * missing" is actionable, "client.js differs" is not.
 */
export const MARKERS = [
  {
    file: 'lib/client.js',
    needle: 'promo.active !== true',
    meaning: 'the off-peak gate (the card would render a discount for a promotion Qoder switched off)',
  },
  {
    file: 'lib/account-state.js',
    needle: 'export',
    meaning: 'the account-state panel (a region that failed at activation can only be fixed by restarting)',
  },
  {
    file: 'lib/index.js',
    needle: '/plugins/dsh-connect-qoder/account',
    meaning: 'the account/reload routes',
  },
]

/**
 * Compare one deployed install against this checkout.
 *
 * @param options.repoRoot - the checkout being compared against.
 * @param options.installRoot - the deployed `dsh-connect-qoder` directory.
 * @returns a plain report: `kind` (`link`/`sync`/`drift`), `version` fields,
 *   and one entry per difference (`missing`, `extra`, `changed`, `marker`).
 */
export function compareInstall({ repoRoot, installRoot }) {
  const report = {
    installRoot,
    kind: 'sync',
    repoVersion: readVersion(repoRoot),
    installedVersion: readVersion(installRoot),
    differences: [],
  }

  const stat = lstatSync(installRoot, { throwIfNoEntry: false })
  if (stat === undefined) {
    report.kind = 'missing'
    return report
  }
  if (stat.isSymbolicLink()) {
    report.kind = 'link'
    report.target = realpathSync(installRoot)
    report.linkMatchesRepo = resolve(report.target) === resolve(repoRoot)
    // A link into ANOTHER checkout is the same hazard as a stale copy.
    if (!report.linkMatchesRepo) report.kind = 'drift'
    return report
  }

  // File paths are reported as `lib/...` — the same spelling the markers use —
  // so one report line always names a path the reader can open.
  const prefix = (files) => files.map((file) => `lib/${file}`)
  const repoFiles = prefix(listFiles(join(repoRoot, 'lib')))
  const installedFiles = prefix(listFiles(join(installRoot, 'lib')))
  const repoSet = new Set(repoFiles)
  const installedSet = new Set(installedFiles)

  for (const file of repoFiles) {
    if (!installedSet.has(file)) {
      report.differences.push({ kind: 'missing', file })
      continue
    }
    if (hashFile(join(repoRoot, file)) !== hashFile(join(installRoot, file))) {
      report.differences.push({ kind: 'changed', file })
    }
  }
  for (const file of installedFiles) {
    if (!repoSet.has(file)) report.differences.push({ kind: 'extra', file })
  }

  for (const marker of MARKERS) {
    let haystack
    try {
      haystack = readFileSync(join(installRoot, marker.file), 'utf8')
    } catch {
      haystack = ''
    }
    if (!haystack.includes(marker.needle)) {
      report.differences.push({ kind: 'marker', file: marker.file, meaning: marker.meaning })
    }
  }

  if (report.differences.length > 0) {
    report.kind = 'drift'
    // The version trap, called out because it is what hides the drift: an
    // upgrade path keying on version will never move a copy like this.
    report.sameVersion = report.repoVersion !== undefined && report.repoVersion === report.installedVersion
  }
  return report
}

/** Render one report for the terminal. */
function format(report, repoRoot) {
  const label = relative(repoRoot, report.installRoot) || report.installRoot
  switch (report.kind) {
    case 'missing':
      return `  ${label}: not installed`
    case 'link':
      return `  ${label}: dev link -> ${report.target} (in sync by construction)`
    case 'sync':
      return `  ${label}: in sync (v${report.installedVersion ?? '?'})`
    default: {
      const versionNote = report.sameVersion
        ? `  [same version ${report.repoVersion} as the checkout — version-based upgrades will not notice]`
        : `  (installed v${report.installedVersion ?? '?'}, checkout v${report.repoVersion ?? '?'})`
      const lines = report.differences.map((d) => {
        if (d.kind === 'marker') return `      MISSING MARKER in ${d.file}: ${d.meaning}`
        if (d.kind === 'changed') return `      changed: ${d.file}`
        if (d.kind === 'missing') return `      missing:  ${d.file}`
        return `      only deployed: ${d.file}`
      })
      return [`  ${label}: DRIFT${versionNote}`, ...lines].join('\n')
    }
  }
}

/** The profile directories under a DSH home, or `[]` when there are none. */
export function profilesIn(home) {
  const dir = join(home, 'profiles')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name))
    .sort()
}

/** CLI entry point. */
function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
  const profiles = profilesIn(home)
  if (profiles.length === 0) {
    console.log(`check-deploy-drift: no profiles under ${home} — nothing deployed to compare.`)
    return 0
  }

  const reports = profiles
    .map((profile) => join(profile, 'node_modules', 'dsh-connect-qoder'))
    .filter((install) => lstatSync(install, { throwIfNoEntry: false }) !== undefined)
    .map((installRoot) => compareInstall({ repoRoot, installRoot }))

  if (reports.length === 0) {
    console.log('check-deploy-drift: the plugin is not installed in any profile.')
    return 0
  }

  console.log(`check-deploy-drift: comparing ${reports.length} install(s) against ${repoRoot}`)
  for (const report of reports) console.log(format(report, repoRoot))

  const drifted = reports.filter((report) => report.kind === 'drift')
  if (drifted.length === 0) {
    console.log('OK: every deployed copy matches this checkout.')
    return 0
  }
  console.log(
    `\n${drifted.length} copy/copies are stale. Reinstall them, or point the profile at this checkout:\n` +
      '  dsh plugin add <this repo path> --profile <profile>',
  )
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main()
}
