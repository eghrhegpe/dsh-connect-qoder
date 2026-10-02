/**
 * Whether one region may be published as a provider.
 *
 * A region is published only when it can actually answer. Registering a
 * provider whose sign-in is missing or expired puts a dead route in the model
 * picker: selecting it sends a request the gateway answers with 403, which the
 * UI reports as "the provider rejected this request" — blaming the user's
 * account for a channel this plugin should never have offered. Skipping the
 * region leaves the other one working and the picker honest.
 *
 * Split out of `startRegion` (lib/index.js) because that function cannot be
 * imported by a test, and this is the decision it makes: three distinct
 * refusals, each of which must be distinguishable by the operator reading the
 * log, and each of which leads to a DIFFERENT user action (sign in, renew an
 * expired token, or look at an unwrap failure). Collapsing them into one
 * boolean would lose exactly the information the log exists to carry.
 *
 * @module dsh-connect-qoder/region-gate
 */
import type { Region, ResolvedCredential } from './domain.ts'

/**
 * Decide from a resolved credential.
 *
 * @param credential - the resolved credential, or `undefined` when none exists.
 * @param region - the region descriptor, for the message.
 * @returns `{ ok: true }`, or `{ ok: false, level, message }` where `level` is
 *   `'warn'` for something the user must act on and `'info'` for the ordinary
 *   "not signed in yet" case.
 */
export function regionPublishDecision(
  credential: ResolvedCredential | undefined | null,
  region: Region,
): { ok: true } | { ok: false; level: 'info' | 'warn'; message: string } {
  if (credential === undefined || credential === null) {
    return {
      ok: false,
      level: 'info',
      message: `dsh-connect-qoder: ${region.displayName} has no local sign-in; region not registered`,
    }
  }
  // Only an explicit `true` counts as expired. A truthy-but-not-true value (the
  // string "true", a number) is not something this plugin produces, and treating
  // it as expired would refuse to publish a working region over a malformed
  // field — the same rule the per-region switch uses, for the same reason.
  if (credential.expired === true) {
    return {
      ok: false,
      level: 'warn',
      message:
        `dsh-connect-qoder: ${region.displayName} sign-in has expired; region not registered ` +
        `(open the ${region.displayName} app to renew it, then re-read from the Qoder card ` +
        `or restart DSH)`,
    }
  }
  return { ok: true }
}

/**
 * The refusal for a sign-in that could not even be read.
 *
 * Separate from {@link regionPublishDecision} because it is a THROW, not an
 * absent credential: the unwrap layer failed in a way it could report, and the
 * error object is the diagnosis. The two are deliberately not merged — a
 * missing sign-in is the normal state of a fresh install and is logged at info,
 * while an unreadable one is a problem the user has to see.
 *
 * @param region - the region descriptor, for the message.
 * @returns the `{ level, message }` pair describing the refusal.
 */
export function unreadableSignInDecision(
  region: Region,
): { level: 'warn'; message: string } {
  return {
    level: 'warn',
    message: `dsh-connect-qoder: ${region.displayName} sign-in is unusable; region not registered`,
  }
}
