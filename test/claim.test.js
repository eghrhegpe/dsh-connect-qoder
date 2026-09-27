/**
 * Tests for the daily check-in logic.
 *
 * Run: node --test test/claim.test.js
 *
 * The fixtures are the real campaigns this account returned on 2026-09-27
 * (ids kept, nothing secret in them): one `CLAIM_BENEFIT` round already claimed,
 * and one `VIEW_DETAILS` subscription promotion. That second one is the whole
 * reason this file exists — it reports `claimStatus: "CLAIMED"` while carrying
 * no benefit at all, so any check-in that selects its campaign by status alone
 * would happily claim nothing and report success.
 *
 * Assertions therefore target the selectors directly, and each one has been
 * chosen so that deleting its guard turns something here red rather than
 * merely changing a number.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  benefitOf,
  campaignIsClaimed,
  checkinStateFrom,
  claimableCampaignOf,
  normalizeClaimResult,
} from '../lib/claim.js'

/**
 * The daily 100-Credit round, as the upstream published it.
 *
 * Window 2026-09-26 10:00 → 2026-09-27 09:59 (UTC+8), which is the "one round
 * per day, refreshed at 10:00" cadence the panel's own copy advertises.
 */
const DAILY_ROUND_START_S = 1790388000
const DAILY_ROUND_END_S = 1790474340

/** A clock inside the real round's window: 2026-09-26 11:00 UTC+8. */
const INSIDE_WINDOW_MS = (DAILY_ROUND_START_S + 3600) * 1000
/** A clock after the round closed: 2026-09-27 10:30 UTC+8. */
const AFTER_WINDOW_MS = (DAILY_ROUND_END_S + 1800) * 1000

/** The claimable-benefit campaign, mid-round. `status` is swapped per test. */
const dailyRound = (claimStatus) => ({
  campaignId: '01a0cd41-eaea-76a8-9ab7-44d4666ba41d',
  campaignKey: 'act-20260923-267',
  actionType: 'CLAIM_BENEFIT',
  startAt: DAILY_ROUND_START_S,
  endAt: DAILY_ROUND_END_S,
  claimStatus,
  benefit: {
    kind: 'CREDITS',
    amount: 100,
    modelScope: { modelSeries: { key: 'ALL_MODELS' } },
    validity: { mode: 'RELATIVE_DAYS', days: 30 },
  },
  placements: [
    {
      type: 'USAGE',
      content: {
        zh: {
          title: '每天领 100 Credits',
          description: '每日 10:00（UTC+8）刷新，领取后 30 天有效',
          detailUrl: 'https://docs.qoder.cn/events/100credits',
        },
      },
    },
  ],
})

/**
 * The September subscription promotion: advertised the same way, shares a
 * `USAGE` placement, and carries a `CLAIMED` status — but no benefit.
 */
const VIEW_DETAILS_CAMPAIGN = {
  campaignId: '01a05bbf-5668-7031-83d6-91545f97ec05',
  campaignKey: 'act-20260901-922',
  actionType: 'VIEW_DETAILS',
  startAt: 1788243600,
  endAt: 1790783940,
  claimStatus: 'CLAIMED',
  placements: [
    {
      type: 'USAGE',
      content: { zh: { title: '9月限时福利，专业版/高级版首月 Credits 翻倍' } },
    },
  ],
}

/** Both campaigns, in the order the upstream returned them. */
const payloadWith = (...campaigns) => ({ uid: '019ec931', showCampaign: true, claimable: false, campaigns })

test('the claimable round is picked over the view-details promotion', () => {
  const found = claimableCampaignOf(payloadWith(dailyRound('CLAIMABLE'), VIEW_DETAILS_CAMPAIGN), INSIDE_WINDOW_MS)
  assert.equal(found?.campaignKey, 'act-20260923-267')
})

test('a campaign with no benefit is never picked, even when it reports CLAIMED', () => {
  // Regression: ordering alone does not protect this. If the selector ever
  // drops the `actionType` filter it lands here first and the card would offer
  // a check-in button for a promotion that pays nothing.
  const onlyViewDetails = payloadWith(VIEW_DETAILS_CAMPAIGN)
  assert.equal(claimableCampaignOf(onlyViewDetails, INSIDE_WINDOW_MS), undefined)
  assert.deepEqual(checkinStateFrom(onlyViewDetails, INSIDE_WINDOW_MS), { active: false, todayCheckedIn: false })
})

test('a round whose window has closed is not claimable', () => {
  const found = claimableCampaignOf(payloadWith(dailyRound('CLAIMABLE')), AFTER_WINDOW_MS)
  assert.equal(found, undefined)
  assert.deepEqual(checkinStateFrom(payloadWith(dailyRound('CLAIMABLE')), AFTER_WINDOW_MS), {
    active: false,
    todayCheckedIn: false,
  })
})

test('todayCheckedIn follows the round status, not the payload summary flags', () => {
  // The upstream's own top-level `claimable` was false in the very payload where
  // the round had been claimed, so it cannot separate "claimed" from "nothing
  // is running" — proving those summary flags are not what drives the state.
  const claimedPayload = { claimable: true, campaigns: [dailyRound('CLAIMED')] }
  assert.equal(checkinStateFrom(claimedPayload, INSIDE_WINDOW_MS).todayCheckedIn, true)

  const openPayload = { claimable: false, campaigns: [dailyRound('CLAIMABLE')] }
  assert.equal(checkinStateFrom(openPayload, INSIDE_WINDOW_MS).todayCheckedIn, false)
})

test('the card-facing state carries the amount and window, and no campaign id', () => {
  const state = checkinStateFrom(payloadWith(dailyRound('CLAIMED')), INSIDE_WINDOW_MS)
  assert.deepEqual(state, {
    active: true,
    todayCheckedIn: true,
    amount: 100,
    unit: 'credits',
    validDays: 30,
    endsAt: DAILY_ROUND_END_S * 1000,
  })
  // A campaign id in card state would let the card claim a round the host has
  // not re-read; the claim route always re-reads, so there is nothing to send.
  assert.equal('campaignId' in state, false)
})

test('an unknown claim status is treated as claimable rather than claimed', () => {
  // Renaming a status upstream must not silently hide the feature. The claim
  // itself is idempotent, so the optimistic reading costs one wasted request.
  const state = checkinStateFrom(payloadWith(dailyRound('READY_TO_CLAIM')), INSIDE_WINDOW_MS)
  assert.equal(state.active, true)
  assert.equal(state.todayCheckedIn, false)
  assert.equal(campaignIsClaimed(dailyRound('READY_TO_CLAIM')), false)
})

test('missing, empty and malformed campaign payloads all read as inactive', () => {
  const inert = { active: false, todayCheckedIn: false }
  assert.deepEqual(checkinStateFrom(undefined), inert)
  assert.deepEqual(checkinStateFrom(null), inert)
  assert.deepEqual(checkinStateFrom({}), inert)
  assert.deepEqual(checkinStateFrom({ campaigns: null }), inert)
  assert.deepEqual(checkinStateFrom({ campaigns: [null, 42, 'x'] }), inert)
})

test('campaigns published with millisecond timestamps are read the same way', () => {
  const inMillis = {
    campaigns: [{ ...dailyRound('CLAIMABLE'), startAt: DAILY_ROUND_START_S * 1000, endAt: DAILY_ROUND_END_S * 1000 }],
  }
  assert.equal(claimableCampaignOf(inMillis, INSIDE_WINDOW_MS)?.campaignKey, 'act-20260923-267')
  assert.equal(checkinStateFrom(inMillis, AFTER_WINDOW_MS).active, false)
})

test('a campaign with no window is treated as open, not closed', () => {
  const noWindow = { campaigns: [{ campaignKey: 'k', actionType: 'CLAIM_BENEFIT', claimStatus: 'CLAIMABLE' }] }
  assert.equal(claimableCampaignOf(noWindow, INSIDE_WINDOW_MS)?.campaignKey, 'k')
})

test('benefitOf reads only a real positive amount', () => {
  assert.deepEqual(benefitOf(dailyRound('CLAIMED')), { amount: 100, kind: 'CREDITS', validDays: 30 })
  assert.equal(benefitOf(VIEW_DETAILS_CAMPAIGN), undefined)
  assert.equal(benefitOf({ benefit: { amount: 0 } }), undefined)
  assert.equal(benefitOf({ benefit: { amount: 'x' } }), undefined)
})

test('a fresh grant and a replayed one are both successes, but mean different things', () => {
  const fresh = normalizeClaimResult(
    { status: 'CLAIMED', replayed: false, benefit: { kind: 'CREDITS', amount: 100 }, expiresAt: 1790474340000 },
    dailyRound('CLAIMABLE'),
  )
  assert.deepEqual(fresh, { claimed: true, replayed: false, amount: 100, expiresAt: 1790474340000 })

  const replay = normalizeClaimResult({ status: 'CLAIMED', replayed: true }, dailyRound('CLAIMED'))
  assert.deepEqual(replay, { claimed: true, replayed: true })
})

test('the amount falls back to what the campaign advertised', () => {
  const result = normalizeClaimResult({ status: 'CLAIMED' }, dailyRound('CLAIMABLE'))
  assert.equal(result.amount, 100)
})

test('an unanswered claim is not reported as a success', () => {
  assert.equal(normalizeClaimResult({ status: 'FAILED' }, dailyRound('CLAIMABLE')).claimed, false)
  assert.equal(normalizeClaimResult(undefined, dailyRound('CLAIMABLE')).claimed, false)
})

test('a claim response wrapped under data is read the same way', () => {
  const wrapped = { code: 0, data: { status: 'CLAIMED', replayed: true } }
  assert.deepEqual(normalizeClaimResult(wrapped), { claimed: true, replayed: true })
})
