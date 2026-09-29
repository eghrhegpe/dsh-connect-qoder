/**
 * Read-only probe: does the gateway ACCEPT a darwin `Cosy-Machineos` value?
 *
 * Run: node probe/machineos-probe.mjs
 *
 * WHY: issue 10 (protocol drift) notes that MACHINE_OS falls back to
 * `x86_64_linux` on darwin, and its acceptance criteria want a darwin branch.
 * But this repository's rule is measured-not-assumed: before adding
 * `x86_64_darwin`/`aarch64_darwin` we must know the gateway does not reject
 * them (403 / empty catalog). One GET per value, same request the plugin's
 * own refresh timer sends, one header differs.
 */
import { REGIONS, loadCredential } from '../lib/credentials.js'
import { modelListUrl, authHeaders } from '../lib/upstream.js'

const VALUES = ['x86_64_linux', 'x86_64_darwin', 'aarch64_darwin', 'aarch64_linux']

for (const region of REGIONS) {
  const credential = loadCredential(region, process.env.APPDATA)
  if (credential === undefined) {
    console.log(`${region.id}: no credential — skipped`)
    continue
  }
  const url = modelListUrl(region)
  console.log(`${region.id}:`)
  for (const value of VALUES) {
    const headers = { ...authHeaders(Buffer.alloc(0), url, credential), 'Cosy-Machineos': value }
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        redirect: 'error',
      })
      const text = await response.text()
      let chatCount = 'n/a'
      try {
        const parsed = JSON.parse(text)
        const chat = parsed?.chat
        chatCount = Array.isArray(chat) ? String(chat.length) : typeof chat
      } catch {
        chatCount = 'not-json'
      }
      console.log(`  Cosy-Machineos=${value.padEnd(14)} -> HTTP ${response.status}, chat=${chatCount}`)
    } catch (error) {
      console.log(`  Cosy-Machineos=${value.padEnd(14)} -> ERROR ${error?.message ?? String(error)}`)
    }
  }
}
