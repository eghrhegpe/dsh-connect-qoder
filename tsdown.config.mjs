// @ts-check
/**
 * Build configuration — the mainstream layout: source in `src/`, runtime in
 * `lib/`, nothing hand-edited in `lib/`.
 *
 * `src/` holds ALL sources (host + client); `lib/` is a pure build artifact,
 * git-ignored, and fully rebuildable from `src/` via `npm run build` (the
 * `prepack` hook runs it, so a published tarball still carries the artifacts).
 *
 * ONE entry here:
 *
 * HOST — `src/host/index.ts` bundled to a single `lib/index.js` (esm, node).
 * A single bundle is deliberate: the published surface is one entry point
 * (`package.json#main` + `exports["."]`), and the offline suites import the
 * SOURCES directly (`../src/host/*.ts`; Node strips types natively on 22.19+/24),
 * so no per-module `lib/` output is needed by either the runtime or the tests.
 * Every peer package stays external so it resolves from the Host runtime.
 *
 * The CLIENT is NOT built here. The browser card is emitted by
 * `scripts/build-client.mjs`, which wraps the tsdown bundle in the
 * `window.__ModuleLoader__.load(...)` shell this plugin's loader ABI expects and
 * runs the REQUIRED-string gate. That script owns the client's loader ABI; do
 * not duplicate it here.
 *
 * `clean: false` is load-bearing, not an oversight: `lib/` also holds the
 * client artifact, which `build-client.mjs` has just written — and whose
 * byte-for-byte freshness check needs the PREVIOUS build as its baseline. A
 * wholesale `clean` of `lib/` would delete that baseline before it could be
 * read, silently downgrading the check to "no baseline". The host emits one
 * deterministic filename, so `build:host` removes exactly that file first and
 * no stale chunk can accumulate.
 */
import { defineConfig } from 'tsdown'

/** Peer packages that must resolve from the Host runtime, never be bundled. */
const NEVER_BUNDLE = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/schemastery',
  '@earendil-works/pi-ai',
]

export default defineConfig([
  {
    name: 'host',
    entry: ['src/host/index.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2023',
    // The published surface is one entry point, so one self-contained file —
    // no code-splitting, no per-module `lib/` output.
    splitting: false,
    clean: false,
    minify: false,
    sourcemap: false,
    dts: false,
    outExtensions: () => ({ js: '.js' }),
    deps: { neverBundle: [...NEVER_BUNDLE] },
  },
])
