/**
 * Read-only probe: what does Qoder's daily-billing-limit refusal actually say?
 *
 * Run: node probe/daily-limit-probe.mjs
 *
 * WHY: a user hit `502 {"message":"Qoder upstream error 110: Billing daily count
 * exceeded"}` and the plugin retried it with `Retry-After: 7350`, i.e. it treated
 * a spent daily allowance as a queue. This probe exists so the fix is written
 * against the REAL envelope rather than against the one string in that message.
 *
 * It sends exactly one request, the same one a turn sends, and reports the
 * status, the headers that matter and the body shape — never any token. If the
 * account has allowance left the answer will be a success, which is itself
 * useful: it tells us the limit is not hit from a probe alone, so the diagnosis
 * has to come from the code path rather than from here.
 */
import { REGIONS, loadCredential, appDataRootFor } from '../lib/credentials.js'
import { chatUrl, authHeaders } from '../lib/upstream.js'

/** The minimum body a chat call needs, aimed at the cheapest model available. */
const BODY = Buffer.from(
  JSON.stringify({
    model: 'Qwen3.7-Plus',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    max_tokens: 1,
  }),
  'utf8',
)

for (const region of REGIONS) {
  const credential = loadCredential(region, appDataRootFor())
  if (credential === undefined) {
    console.log(`${region.id}: no credential on this machine — skipped`)
    continue
  }
  const url = chatUrl(region)
  const headers = authHeaders(BODY, url, credential)
  headers['Content-Type'] = 'application/json'

  try {
    const response = await fetch(url, { method: 'POST', headers, body: BODY })
    const text = await response.text()
    console.log(`${region.id}:`)
    console.log(`  HTTP ${response.status} ${response.statusText}`)
    // The headers that decide how the plugin classifies this. `retry-after` is
    // the one that made it look like a queue.
    for (const name of ['retry-after', 'x-ratelimit-reset', 'x-ratelimit-remaining', 'x-billing-reset']) {
      const value = response.headers.get(name)
      console.log(`  ${name}: ${value === null ? '(absent)' : value}`)
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      console.log(`  body is not JSON: ${text.slice(0, 200)}`)
      continue
    }
    // Shape only: the keys, and any error object inside.
    console.log(`  top-level keys: ${Object.keys(parsed).join(', ') || '(none)'}`)
    const err = parsed.error ?? parsed
    if (err !== null && typeof err === 'object') {
      console.log(`  error keys: ${Object.keys(err).join(', ')}`)
      console.log(`  code: ${JSON.stringify(err.code)}`)
      console.log(`  type: ${JSON.stringify(err.type)}`)
      console.log(`  message: ${JSON.stringify(String(err.message).slice(0, 200))}`)
    }
  } catch (error) {
    console.log(`  probe failed: ${error?.message ?? String(error)}`)
  }
}
