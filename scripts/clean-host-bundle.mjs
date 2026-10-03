/**
 * Remove the host bundle before rebuilding it.
 *
 * Run: `npm run build:host` (which chains this with tsdown).
 *
 * WHY THIS EXISTS
 *
 * `tsdown.config.mjs` runs with `clean: false` on purpose: `lib/` also holds
 * `lib/client.js`, and `scripts/build-client.mjs` needs the PREVIOUS client
 * artifact as the baseline for its byte-for-byte freshness check. A wholesale
 * `rm -rf lib/` would delete that baseline and silently downgrade the check to
 * "no baseline, wrote the bundle".
 *
 * The host build emits exactly one deterministic filename (`lib/index.js` —
 * single entry, `splitting: false`), so removing exactly that file gives the
 * same "no stale output survives a rebuild" guarantee as `clean: true` without
 * touching the client artifact. `build:client` then runs with its baseline
 * intact.
 *
 * Not a general-purpose cleaner: it deletes one known path and nothing else.
 *
 * The deletion lives in `main()` behind the entry-point guard every other
 * script here uses, rather than at module scope. At module scope merely
 * IMPORTING this file removed `lib/index.js` — a versioned artifact (docs/issues/19)
 * — which is a trap for any tooling or test that reaches it by import rather
 * than by the `npm run build:host` command line. Measured, not hypothetical:
 * an exploration session imported it and had to restore the file.
 */
import { rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(root, 'lib', 'index.js')

/** Delete the host bundle. Exported so a caller can invoke it deliberately. */
export function main() {
  rmSync(BUNDLE, { force: true })
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main()
}
