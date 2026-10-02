/**
 * Upstream timestamp coercion, shared by the two modules that read them.
 *
 * Qoder is not consistent about how it spells a time, even inside one flow:
 *
 * - The campaign records publish their window as **second-precision integers**
 *   (`startAt: 1790388000`).
 * - The very claim endpoint for those campaigns answers with **RFC 3339
 *   strings** (`"expiresAt":"2026-10-26T03:38:29.310161Z"`).
 *
 * Both used to be parsed by copies of this function living in `upstream.js` and
 * `claim.js`. The copies disagreed — one accepted strings, the other did not,
 * and they drew the seconds/milliseconds line at different thresholds — which
 * is exactly how a old-as-1973 threshold stays invisible until a field arrives
 * in the shape neither copy expected. One definition, one behaviour.
 *
 * @module dsh-connect-qoder/time
 */

/** Anything below this epoch-millisecond value must be seconds (1e12 ms ≈ 2001). */
const SECONDS_BOUNDARY_MS = 1e12

/**
 * Coerce one upstream timestamp into epoch milliseconds.
 *
 * @param {unknown} value - the raw value: seconds, milliseconds, or an RFC 3339
 *   string.
 * @returns epoch milliseconds, or `undefined` when it is not a usable time.
 */
export function toEpochMs(value) {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined
    return value < SECONDS_BOUNDARY_MS ? Math.floor(value * 1000) : Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}
