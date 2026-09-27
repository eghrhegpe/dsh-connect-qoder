/**
 * The per-region credential cache.
 *
 * Split out of lib/index.js so the behaviour this plugin sells — "a re-sign-in
 * is picked up without restarting DSH" — can be asserted against the real code.
 * The two predicates on that path (`isStaleCredentialError`, `isCredentialUsable`)
 * were already testable, but the wiring between them was not: the flag that
 * turns a sign-in rejection into a re-read lived in a class that cannot be
 * imported, because lib/index.js pulls in the Cordis peer dependencies. Two
 * tested parts and one untested connection is still no test.
 *
 * Everything external is injected, so this module has no imports beyond
 * `isCredentialUsable` and no peer dependencies.
 *
 * @module dsh-connect-qoder/credential-cache
 */
import { isCredentialUsable } from './credentials.js'

export class CredentialCache {
  /**
   * @param options.loadApp - `() => credential | undefined`, reading the app's store.
   * @param options.loadEnv - `() => credential | undefined`, the PAT fallback.
   * @param options.exchangePat - `(credential) => { token, refreshToken, expiresAt }`,
   *   called only for a PAT source; absent when PATs are not supported.
   */
  constructor({ loadApp, loadEnv, exchangePat }) {
    this.loadApp = loadApp
    this.loadEnv = loadEnv
    this.exchangePat = exchangePat
    /**
     * The cached record: an app credential as read, or a PAT after exchange.
     * Named `cached` rather than `credential` because the plugin's own field was
     * written on every resolve and read by nothing.
     */
    this.cached = undefined
    /**
     * Set when a request is rejected with a sign-in failure, so the next
     * `resolve` forces a re-read from disk. Without this, a cached app
     * credential whose token has expired stays cached for the process's life —
     * its `expired` flag was computed when it was read, not at request time —
     * and every request 401s until DSH is restarted.
     */
    this.invalid = false
    /** How many times the underlying store was actually read; asserted in tests. */
    this.reads = 0
    /** How many times a PAT was exchanged for a job token. */
    this.exchanges = 0
  }

  /**
   * Resolve the credential to use for a request.
   *
   * A cached value is reused while it is still usable (see
   * `isCredentialUsable`); otherwise the app store is read, falling back to a
   * PAT, and a PAT is exchanged once for a job token.
   *
   * @returns the credential, or `undefined` when this machine has no sign-in.
   */
  async resolve() {
    // A request was rejected with a sign-in failure; force a re-read so a
    // freshly re-signed-in app is picked up without a DSH restart.
    if (this.invalid) {
      this.invalid = false
      this.cached = undefined
    }
    // The two sources expire on different clocks: an app credential by the
    // `expired` flag its own store computed, an env PAT by the wall clock on
    // the job token it was exchanged for.
    if (isCredentialUsable(this.cached)) return this.cached

    this.reads += 1
    const fromApp = this.loadApp()
    const credential = fromApp ?? this.loadEnv()
    if (credential === undefined) {
      this.cached = undefined
      return undefined
    }
    if (credential.source === 'env-pat') {
      if (this.exchangePat === undefined) {
        // No exchange available: the raw PAT is still better than nothing, and
        // the gateway is the one that will reject it if it is unusable.
        this.cached = credential
        return credential
      }
      this.exchanges += 1
      const exchanged = await this.exchangePat(credential)
      this.cached = {
        ...credential,
        token: exchanged.token,
        refreshToken: exchanged.refreshToken,
        expiresAt: exchanged.expiresAt,
      }
      return this.cached
    }
    this.cached = credential
    return credential
  }

  /**
   * Invalidate the cached credential after an upstream sign-in rejection.
   *
   * The next `resolve` re-reads the app's store, so a re-sign-in is picked up
   * without a restart. Called from the shim when the upstream answers with a
   * sign-in failure.
   */
  invalidate() {
    this.invalid = true
  }
}
