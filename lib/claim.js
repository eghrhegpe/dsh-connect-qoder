/**
 * The daily check-in: deciding whether the upstream has anything to claim,
 * and reading back what a claim returned.
 *
 * Qoder hands each account a fresh campaign every day at 10:00 (UTC+8) — a
 * new `campaignId` each round, always carrying a 100-Credit benefit — and the
 * account claims it once per round. Everything this module needs is already
 * answered by the route the usage panel reads (`GET /sash/api/v1/me/campaigns`),
 * so no extra shape of request is invented here: the same payload that feeds
 * the promotional copy also carries `actionType` and `claimStatus`.
 *
 * Two filters matter, and field evidence (2026-09-27, both regions) is why:
 *
 * - **`actionType`** must be `CLAIM_BENEFIT`. The very same account carries a
 *   second campaign of type `VIEW_DETAILS` (a subscription promotion with no
 *   benefit at all) that nevertheless reports `claimStatus: "CLAIMED"`. Judging
 *   by status alone would send a claim POST at a campaign that has nothing to
 *   hand out.
 * - **`claimStatus`** is what distinguishes a claimable round from a claimed
 *   one. The payload's own top-level `claimable` flag answers `false` for both
 *   "already claimed today" and "nothing is running", and `claimable` on the
 *   campaign itself does not exist as a field at all, so neither can be trusted
 *   as the gate.
 *
 * An unknown `claimStatus` is treated as claimable rather than as claimed.
 * The upstream makes claiming idempotent (a repeat answers `replayed: true`
 * and grants nothing), so the cost of being optimistic is one wasted request,
 * while the cost of being pessimistic is hiding the feature permanently the
 * day Qoder renames its statuses.
 *
 * A list that carries no `CLAIM_BENEFIT` round at all reads as
 * `active: false` by design — that is not a missing feature the selector
 * failed to find. The international campaigns endpoint answers requests
 * without the desktop app's umid machine identity with the evergreen
 * `VIEW_DETAILS` banner only (verified 2026-09-27 against the live endpoint);
 * the daily round lists itself to machine-identified reads, which is what
 * `readCampaigns` now sends (`lib/upstream.js`, `openApiHeaders`). A reduced
 * list is therefore the upstream's answer to a request it could not bind to
 * a machine, not a selector bug; this module cannot distinguish the two, and
 * must not pretend to.
 *
 * Nothing here touches the network, and nothing here carries a campaign id to
 * the caller that would let it claim a stale round: the claim route re-reads
 * the campaigns for itself, which is the order the upstream requires.
 *
 * @module dsh-connect-qoder/claim
 */
import { toEpochMs } from './time.js'

/** MIME-free label for the one campaign type that actually pays out. */
export const CLAIM_BENEFIT_ACTION = 'CLAIM_BENEFIT'
/** Status of a round this account has already collected. */
export const CLAIMED_STATUS = 'CLAIMED'

/**
 * The benefit a campaign would pay out.
 *
 * Amounts the upstream may carry elsewhere describe what was granted, not what
 * is left, so only the benefit attached to a `CLAIM_BENEFIT` action is read —
 * the same restraint the usage panel applies to promotional amounts.
 *
 * @param {object} campaign - one raw campaign record.
 * @returns `{ amount, kind, validDays }` when it has a numeric amount.
 */
export function benefitOf(campaign) {
  const benefit = campaign?.benefit
  if (benefit === null || typeof benefit !== 'object') return undefined
  const amount = Number(benefit.amount)
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  const validityDays = Number(benefit.validity?.days)
  return {
    amount,
    kind: typeof benefit.kind === 'string' ? benefit.kind : 'CREDITS',
    ...(Number.isFinite(validityDays) && validityDays > 0 ? { validDays: validityDays } : {}),
  }
}

/**
 * Is this campaign's window open at `nowMs`?
 *
 * A campaign whose window has closed is not claimable even though the upstream
 * still lists it: the previous round stays visible until the next one is
 * published. A record with no usable window is treated as open, because an
 * absent window means the upstream is not gating the round rather than that
 * the round has ended.
 */
function windowOpenAt(campaign, nowMs) {
  const startAt = toEpochMs(campaign?.startAt ?? campaign?.beginAt)
  const endAt = toEpochMs(campaign?.endAt)
  if (startAt !== undefined && nowMs < startAt) return false
  if (endAt !== undefined && nowMs > endAt) return false
  return true
}

/**
 * The one campaign that pays out and is open right now.
 *
 * @param {unknown} payload - the raw `GET /sash/api/v1/me/campaigns` body.
 * @param {number} [nowMs] - clock, injected for testing.
 * @returns the raw record, or `undefined` when there is none.
 */
export function claimableCampaignOf(payload, nowMs = Date.now()) {
  const list = payload?.campaigns
  if (!Array.isArray(list)) return undefined
  for (const campaign of list) {
    if (campaign === null || typeof campaign !== 'object') continue
    if (campaign.actionType !== CLAIM_BENEFIT_ACTION) continue
    if (!windowOpenAt(campaign, nowMs)) continue
    return campaign
  }
  return undefined
}

/**
 * Whether this account has already collected the current round.
 *
 * @param {object} campaign - the record from {@link claimableCampaignOf}.
 * @returns true when its status says so.
 */
export function campaignIsClaimed(campaign) {
  return campaign?.claimStatus === CLAIMED_STATUS
}

/**
 * The card-facing check-in state.
 *
 * Shaped after `dsh-connect-workbuddy`'s `status.checkin`, which is the
 * contract this family of cards already reads: `active` says the upstream has
 * a round running, `todayCheckedIn` says this account collected it. The card
 * renders a button and never derives either one itself — see the "one fact, one
 * place" rule that off-peak pricing cost this plugin once already.
 *
 * No campaign id is published. The host re-reads the campaigns before every
 * claim, so a stale id could never be clicked from this state even if it were
 * shown.
 *
 * @param {unknown} payload - the raw campaigns body.
 * @param {number} [nowMs] - clock, injected for testing.
 * @returns `{ active, todayCheckedIn, amount?, unit?, validDays?, endsAt? }`.
 */
export function checkinStateFrom(payload, nowMs = Date.now()) {
  const campaign = claimableCampaignOf(payload, nowMs)
  if (campaign === undefined) return { active: false, todayCheckedIn: false }
  const benefit = benefitOf(campaign)
  const endsAt = toEpochMs(campaign.endAt)
  return {
    active: true,
    todayCheckedIn: campaignIsClaimed(campaign),
    ...(benefit !== undefined
      ? {
          amount: benefit.amount,
          unit: benefit.kind === 'CREDITS' ? 'credits' : benefit.kind.toLowerCase(),
          ...(benefit.validDays !== undefined ? { validDays: benefit.validDays } : {}),
        }
      : {}),
    ...(endsAt !== undefined ? { endsAt } : {}),
  }
}

/**
 * Read back what a claim answered.
 *
 * The upstream distinguishes a fresh grant (`replayed: false`) from a repeat
 * that granted nothing (`replayed: true`) rather than failing the second call,
 * so both are success — they just mean different things to the person pressing
 * the button. The amount is taken from the response, falling back to what the
 * campaign advertised, so "received 100 Credits" is never printed from memory
 * when the upstream said otherwise.
 *
 * @param {unknown} payload - the raw claim response body.
 * @param {object|undefined} [campaign] - the campaign that was claimed.
 * @returns `{ claimed, replayed, amount?, expiresAt? }`. `amount` is present
 *   only when this call actually paid out: a `replayed` answer granted nothing,
 *   so reporting what the campaign advertises would claim a gain that did not
 *   happen.
 */
export function normalizeClaimResult(payload, campaign) {
  const body = payload?.data !== null && typeof payload?.data === 'object' ? payload.data : payload
  const status = typeof body?.status === 'string' ? body.status : ''
  const replayed = body?.replayed === true
  const granted = status === CLAIMED_STATUS || replayed || body?.success === true
  const amountValue = Number(body?.benefit?.amount ?? (typeof campaign !== 'undefined' ? benefitOf(campaign)?.amount : undefined))
  const expiresAt = toEpochMs(body?.expiresAt)
  return {
    claimed: granted,
    replayed,
    ...(!replayed && Number.isFinite(amountValue) && amountValue > 0 ? { amount: amountValue } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  }
}
