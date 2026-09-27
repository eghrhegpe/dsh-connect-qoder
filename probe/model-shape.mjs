/**
 * Read-only probe of the model-list envelope's real SHAPE (not its contents).
 *
 * Run: node probe/model-shape.mjs
 *
 * WHY: issue 04 (empty-catalog freeze) wants `fetchModels` to replace the
 * catalog even when it returns 0 models. Issue 10 (protocol drift) says a
 * changed envelope ALSO arrives as "0 models" today (`data?.chat` missing →
 * return []). Before removing the `entries.length > 0` guard we must know what
 * a genuine response looks like: does `chat` always exist? are there sibling
 * groups? is the payload ever an array or a wrapper? Otherwise the fix trades
 * a stale catalog for a wiped one.
 *
 * This sends ONE GET per region — the same request the plugin's own 30-minute
 * refresh timer sends — and reports only structural facts: top-level type,
 * key names, group value types, counts. No model names, no tokens.
 */
import { REGIONS, loadCredential } from '../lib/credentials.js'
import { modelListUrl, authHeaders } from '../lib/upstream.js'

/** Structural summary of one envelope: types and key names, never values. */
function shapeOf(data) {
  if (data === null || typeof data !== 'object') return { type: typeof data }
  if (Array.isArray(data)) return { type: 'array', length: data.length }
  const groups = {}
  for (const [key, value] of Object.entries(data)) {
    groups[key] = value === null ? 'null'
      : Array.isArray(value) ? `array(${value.length})`
      : typeof value === 'object' ? `object(${Object.keys(value).length})`
      : typeof value
  }
  return { type: 'object', keys: groups }
}

for (const region of REGIONS) {
  const credential = loadCredential(region, process.env.APPDATA)
  if (credential === undefined) {
    console.log(`${region.id}: no credential on this machine — skipped`)
    continue
  }
  const url = modelListUrl(region)
  const headers = authHeaders(Buffer.alloc(0), url, credential)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      redirect: 'error',
    })
    const text = await response.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      console.log(`${region.id}: HTTP ${response.status}, body is NOT JSON (${text.slice(0, 120)})`)
      continue
    }
    console.log(`${region.id}: HTTP ${response.status}`)
    console.log(`  envelope: ${JSON.stringify(shapeOf(parsed))}`)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const group of ['chat', 'developer', 'quest']) {
        if (group in parsed) {
          console.log(`  ${group}: ${JSON.stringify(shapeOf(parsed[group]))}`)
        } else {
          console.log(`  ${group}: ABSENT`)
        }
      }
    }
  } catch (error) {
    console.log(`${region.id}: probe failed — ${error?.message ?? String(error)}`)
  }
}
