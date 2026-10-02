/**
 * Off-peak pricing arithmetic.
 *
 * Split out of lib/adapter.js because none of it touches pi-ai — it is clock
 * arithmetic over a catalog entry — while adapter.js cannot be imported without
 * its peer dependencies installed. That split is what lets a test assert the
 * real rules instead of a stand-in: an earlier version of the row-projection
 * test passed a hand-written `RATES` object, which meant nothing checked that
 * the stand-in agreed with the shipped `rateNow`, and the "22:00 rate flip"
 * behaviour was asserted against a fiction.
 *
 * The two things here that are easy to get wrong, and are therefore the two the
 * tests lean on: a window whose end is not after its start crosses midnight, and
 * the discounted rate is `before × discount` while `price_factor` alone is the
 * *discounted* figure — reading it directly understates the daytime cost by
 * several times.
 *
 * @module dsh-connect-qoder/offpeak
 */

/**
 * Seconds past local midnight in `timezone`, or `undefined` when the zone is
 * unusable.
 *
 * Every caller must spell the fallback out. A window Qoder publishes without a
 * zone (`22:00`-`08:00`) has to be read in Shanghai time, but `undefined` here
 * does NOT mean Shanghai — it means the *machine's* zone, so a host west of +08
 * would place the window eight hours off and invert the day. That went
 * unnoticed for as long as it did because a laptop in China is already on
 * `Asia/Shanghai`, which made the omission look correct; the `TZ=UTC` row of
 * CI is what caught it. `src/client/card.ts` carries the same fallback for the
 * card's copy of this arithmetic.
 *
 * `Intl` is used rather than a manual UTC offset because the promotion window is
 * declared in a named zone (`Asia/Shanghai`) and China has no DST — but a zone
 * that does would silently drift with a fixed offset.
 */
function localSecondsOf(date, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date)
    const read = (type) => Number(parts.find((part) => part.type === type)?.value ?? Number.NaN)
    const hour = read('hour') % 24
    const minute = read('minute')
    const second = read('second')
    if (![hour, minute, second].every(Number.isFinite)) return undefined
    return hour * 3600 + minute * 60 + second
  } catch {
    return undefined
  }
}

/** Parse `HH:MM` (or `HH:MM:SS`) into seconds past midnight. */
function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text).trim())
  if (match === null) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? 0)
  if (hour > 23 || minute > 59 || second > 59) return undefined
  return hour * 3600 + minute * 60 + second
}

/**
 * Whether `now` falls inside the clock window, ignoring any campaign state.
 *
 * Split out of `isOffPeakActive` because `upstream.normalizePromotion` needs
 * exactly this bare question: Qoder's `active` flag flips with the window, and
 * telling "window closed" from "campaign killed" requires evaluating the clock
 * before the flag is ever consulted.
 *
 * A window whose end is not after its start crosses midnight (`22:00`-`08:00`
 * is the case Qoder actually uses), so the test is a disjunction rather than a
 * range check.
 */
export function windowIsOpen(windowStart, windowEnd, timezone, now = new Date()) {
  const start = parseClock(windowStart)
  const end = parseClock(windowEnd)
  if (start === undefined || end === undefined || start === end) return false
  const seconds = localSecondsOf(now, timezone ?? 'Asia/Shanghai')
  if (seconds === undefined) return false
  return start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end
}

/**
 * Whether a model's off-peak discount is in effect right now.
 *
 * `entry.promotion.active` means "the campaign is on" — the producer
 * (`upstream.normalizePromotion`) is what turns Qoder's moment-in-time flag
 * into that meaning. Given a live campaign, the window itself is evaluated
 * locally, matching what the Qoder client does.
 *
 * @param entry - one catalog entry.
 * @param now - the instant to evaluate.
 * @returns true when the discount applies.
 */
export function isOffPeakActive(entry, now = new Date()) {
  const promotion = entry.promotion
  if (promotion === undefined || promotion.active !== true) return false
  return windowIsOpen(promotion.windowStart, promotion.windowEnd, promotion.timezone, now)
}

/**
 * The multiplier that actually applies right now.
 *
 * Qoder publishes `price_factor` as the **discounted** price and
 * `before_promotion_price_factor` as the price outside the window — the two are
 * related by exactly `before × discount_factor`, which is what the catalog
 * reports while the window is open. Reading `price_factor` alone therefore
 * understates the cost by the discount for most of the day: during working hours
 * these models bill at the *before* rate, which is 2.5x to 5x higher.
 *
 * The window is evaluated locally rather than trusted from the server, matching
 * what the Qoder client itself does, so the number is right on both sides of the
 * boundary regardless of when the catalog was fetched.
 *
 * @param entry - one catalog entry.
 * @param now - the instant to evaluate.
 * @returns the multiplier, or `NaN` when nothing usable is declared.
 */
export function effectiveRate(entry, now = new Date()) {
  const base = Number(entry.priceFactor)
  const promotion = entry.promotion
  if (promotion === undefined) return Number.isFinite(base) ? base : Number.NaN
  const before = Number(promotion.beforePromotionPriceFactor)
  const discount = Number(promotion.discountFactor)
  if (isOffPeakActive(entry, now)) {
    // Inside the window: the discounted price, which the catalog also reports as
    // `price_factor`. The product is preferred so a stale `price_factor` cannot
    // disagree with the window the name is annotated from.
    if (Number.isFinite(before) && Number.isFinite(discount)) return before * discount
    return Number.isFinite(base) ? base : Number.NaN
  }
  // Outside the window the discount does not apply.
  if (Number.isFinite(before)) return before
  return Number.isFinite(base) ? base : Number.NaN
}

/**
 * Seconds until the current off-peak window flips, or `undefined`.
 *
 * @param entry - one catalog entry.
 * @param now - the instant to evaluate.
 * @returns the countdown, or `undefined` when no window is in play.
 */
export function offPeakRemaining(entry, now = new Date()) {
  const promotion = entry.promotion
  if (promotion === undefined || promotion.active !== true) return undefined
  const start = parseClock(promotion.windowStart)
  const end = parseClock(promotion.windowEnd)
  if (start === undefined || end === undefined || start === end) return undefined
  const seconds = localSecondsOf(now, promotion.timezone ?? 'Asia/Shanghai')
  if (seconds === undefined) return undefined
  const active = start < end ? seconds >= start && seconds < end : seconds >= start || seconds < end
  const target = active ? end : start
  const delta = target >= seconds ? target - seconds : 86400 - seconds + target
  return delta
}

// Aliases for the rest of the plugin. The rest of the codebase imports these
// names; they are re-exported here rather than at each use site so that the
// mapping is visible in one place.
export const offPeakActive = isOffPeakActive
export const rateNow = effectiveRate
export const offPeakRemainingSeconds = offPeakRemaining
