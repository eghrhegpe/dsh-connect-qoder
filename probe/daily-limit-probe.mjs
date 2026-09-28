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
 * WHAT THE FIRST ATTEMPT TAUGHT, because it is the reason this reads the catalog
 * first: the model name was hardcoded, Qoder did not recognise it, and the reply
 * was an unrelated Java stack trace in an `event:error` frame. A probe that
 * cannot reach the code path it is about is worse than no probe — it "verifies"
 * something else and reports it as the shape of this failure. So the model is
 * read from the live catalog and the reply is inspected whatever it is.
 *
 * One request per region beyond the catalog read, and it spends at most one
 * token of allowance when the account has any left.
 */
import { REGIONS, loadCredential, appDataRootFor } from '../lib/credentials.js'
import { chatUrl, authHeaders, fetchModels, encodeBody } from '../lib/upstream.js'

for (const region of REGIONS) {
  const credential = loadCredential(region, appDataRootFor())
  if (credential === undefined) {
    console.log(`${region.id}: no credential on this machine — skipped`)
    continue
  }

  // The model must come from the account's own catalog or the answer is about
  // an unknown model, not about the billing limit.
  let model
  try {
    const models = await fetchModels(region, credential)
    const cheapest = models
      .filter((m) => m.isVL !== true)
      .sort((a, b) => (a.priceFactor || 0) - (b.priceFactor || 0))[0]
    model = cheapest?.key ?? models[0]?.key
    console.log(`${region.id}: probing with ${model ?? '(no models — cannot reach the chat route)'}`)
  } catch (error) {
    console.log(`  catalog read failed: ${error?.message ?? String(error)}`)
    continue
  }
  if (model === undefined) continue

  // `chatUrl` carries `Encode=1`, which means the body must be the PERMUTED
  // base64 the real client sends — a plain JSON body is not merely ignored, it
  // reaches the server's base64 decoder and comes back as a Java stack trace.
  // (That is exactly what the second attempt at this probe produced, and why
  // the encoder is called here rather than assuming the server copes.)
  const plain = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    max_tokens: 1,
  })
  const body = Buffer.from(encodeBody(plain), 'utf8')
  const url = chatUrl(region)
  const headers = authHeaders(body, url, credential)
  headers['Content-Type'] = 'application/json'

  try {
    const response = await fetch(url, { method: 'POST', headers, body })
    const text = await response.text()
    console.log(`  HTTP ${response.status} ${response.statusText}`)
    // The headers that decide how the plugin classifies this. `retry-after` is
    // the one that made a spent allowance look like a queue.
    for (const name of ['retry-after', 'x-ratelimit-reset', 'x-ratelimit-remaining', 'x-billing-reset']) {
      const value = response.headers.get(name)
      console.log(`  ${name}: ${value === null ? '(absent)' : value}`)
    }
    // Errors arrive as `data:` frames, not as a JSON envelope, so both shapes
    // are accepted and the shape is reported rather than assumed.
    const payload = text.startsWith('data:') ? text.slice(text.indexOf('data:') + 5).trim() : text
    let parsed
    try {
      parsed = JSON.parse(payload)
    } catch {
      console.log(`  body (raw, first 300): ${text.slice(0, 300).replace(/\n/g, '\\n')}`)
      continue
    }
    console.log(`  top-level keys: ${Object.keys(parsed).join(', ') || '(none)'}`)
    const err = parsed.error ?? parsed
    if (err !== null && typeof err === 'object') {
      console.log(`  error keys: ${Object.keys(err).join(', ')}`)
      console.log(`  code: ${JSON.stringify(err.code)}`)
      console.log(`  type: ${JSON.stringify(err.type)}`)
      console.log(`  message: ${JSON.stringify(String(err.message).slice(0, 300))}`)
    }
  } catch (error) {
    console.log(`  probe failed: ${error?.message ?? String(error)}`)
  }
}
