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
 */
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(root, 'lib', 'index.js')

rmSync(BUNDLE, { force: true })
