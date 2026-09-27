/**
 * Tests for the per-platform application-data root.
 *
 * Run: node --test test/app-data-root.test.js
 *
 * This is the half of cross-platform support that is unambiguously correct and
 * verifiable here, taken separately from the keystore work that is not
 * (docs/KNOWN_GAPS.md item 6（跨平台凭据链未实现（macOS / Linux）)). Reading
 * `process.env.APPDATA` directly is why this plugin has never worked off
 * Windows: the variable does not exist on macOS, so every probe got `''`, found
 * no app directory, and reported "not signed in" for a user who plainly was.
 *
 * The point of doing this first is what it makes true, not what it makes
 * possible. Off Windows the unwrap still cannot run, so a sign-in is still not
 * READABLE — but the app directory is now FOUND, which means the account panel
 * can say "the app is installed here and this build cannot read its key" instead
 * of denying the app exists, and the keystore side lands on a correct path
 * rather than a wrong one.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { appDataRootFor } from '../lib/credentials.js'

const HOME = '/home/ada'
const WINDOWS_ENV = { APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' }

test('Windows uses %APPDATA%, the roaming root Electron defaults to', () => {
  assert.strictEqual(appDataRootFor('win32', WINDOWS_ENV, 'C:\\Users\\Ada'), WINDOWS_ENV.APPDATA)
})

test('macOS uses ~/Library/Application Support', () => {
  // Electron's documented `userData` on darwin. Note the env is empty on
  // purpose: `%APPDATA%` must not leak into this answer, which is exactly the
  // bug — a variable that exists on the test machine and not on a user's.
  //
  // Compared as a path rather than as a string, because this suite runs on
  // Windows too and `join('/home/ada', …)` produces backslashes there.
  assert.deepStrictEqual(
    appDataRootFor('darwin', {}, HOME),
    join(HOME, 'Library', 'Application Support'),
  )
})

test('Linux prefers $XDG_CONFIG_HOME and falls back to ~/.config', () => {
  assert.strictEqual(
    appDataRootFor('linux', { XDG_CONFIG_HOME: '/custom/cfg' }, HOME),
    '/custom/cfg',
  )
  assert.strictEqual(appDataRootFor('linux', {}, HOME), join(HOME, '.config'))
  // An EMPTY variable is not a value: Electron would fall back, and so must this.
  assert.strictEqual(appDataRootFor('linux', { XDG_CONFIG_HOME: '' }, HOME), join(HOME, '.config'))
})

test('every platform answers with a real path, never the env var that does not exist', () => {
  // The regression, stated as a property: on a non-Windows platform the answer
  // must not be empty and must not be Windows-shaped, because an empty root is
  // indistinguishable from "no app installed".
  for (const [platform, expected] of [
    ['darwin', join(HOME, 'Library', 'Application Support')],
    ['linux', join(HOME, '.config')],
    // Anything unix-like follows the same XDG rule as Linux, which is the whole
    // reason it is not `process.platform === 'linux'`.
    ['freebsd', join(HOME, '.config')],
  ]) {
    const root = appDataRootFor(platform, { APPDATA: WINDOWS_ENV.APPDATA }, HOME)
    assert.notStrictEqual(root, '', `${platform} must resolve a real root`)
    assert.notStrictEqual(root, WINDOWS_ENV.APPDATA, `${platform} must not answer with %APPDATA%`)
    assert.deepStrictEqual([root], [expected], `${platform} must resolve the documented root, got ${root}`)
  }
})

test('Windows with no %APPDATA% is empty, which reads as "no app here"', () => {
  // The one case where empty IS the right answer, and it must not become a
  // Windows-shaped guess: a fabricated path would make every probe miss silently
  // and for a different reason than intended.
  assert.strictEqual(appDataRootFor('win32', {}, HOME), '')
})

test('this host resolves to its own real root', () => {
  // The no-argument call is what production uses, so it is asserted against the
  // running platform rather than only against injected values.
  const root = appDataRootFor()
  assert.strictEqual(typeof root, 'string')
  if (process.platform === 'win32') {
    assert.strictEqual(root, process.env.APPDATA ?? '')
  } else {
    assert.notStrictEqual(root, '', `on ${process.platform} the real root must resolve`)
  }
})
