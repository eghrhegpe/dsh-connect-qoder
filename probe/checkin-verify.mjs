/**
 * End-to-end confirmation of the umid fix, against the plugin's own host
 * paths: claimableCampaignOf picks the round the card would claim, and
 * normalizeClaimResult shows what a POST would report — WITHOUT sending the
 * POST (a claim is a real account mutation; this probe stays read-only).
 *
 * Run: node probe/checkin-verify.mjs
 */
import { REGIONS, loadCredential } from '../lib/credentials.js'
import { readCampaigns, campaignsUrl } from '../lib/upstream.js'
import { checkinStateFrom, claimableCampaignOf, campaignIsClaimed } from '../lib/claim.js'

function redact(value) {
  return typeof value === 'string' && value.length > 0 ? `${value.slice(0, 8)}…(${value.length})` : '(none)'
}

function bareHeaders(credential) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${credential.token}`,
    'Cosy-ClientType': '10',
    'User-Agent': 'Qoder',
  }
}

for (const region of REGIONS) {
  const credential = loadCredential(region, process.env.APPDATA)
  if (credential === undefined) {
    console.log(`${region.id}: no credential on this machine — skipped`)
    continue
  }

  const preFix = await fetch(campaignsUrl(region), { method: 'GET', headers: bareHeaders(credential), redirect: 'error' }).then((r) => r.json())
  const postFix = await readCampaigns(region, credential)

  const pre = { campaigns: (preFix?.campaigns ?? []).map((c) => `${c.campaignKey}(${c.actionType})`), checkin: checkinStateFrom(preFix) }
  const post = { campaigns: (postFix?.campaigns ?? []).map((c) => `${c.campaignKey}(${c.actionType})`), checkin: checkinStateFrom(postFix) }

  console.log(`\n${region.id} (${credential.appName}):`)
  console.log('  pre-fix bare-bearer  :', JSON.stringify(pre))
  console.log('  post-fix readCampaigns:', JSON.stringify(post))

  const picked = claimableCampaignOf(postFix)
  if (picked?.campaignId !== undefined) {
    console.log(
      `  card would claim ${picked.campaignKey}${campaignIsClaimed(picked) ? ' (already claimed today)' : ' (claimable now)'}`,
    )
  } else {
    console.log('  card would render no check-in row')
  }
}
