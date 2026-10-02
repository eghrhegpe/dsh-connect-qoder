/**
 * Position gate #1 — the card body must render its three surfaces in the
 * fixed order the WorkBuddy layout was modelled on: the account strip +
 * sign-in card FIRST, the usage panel SECOND, the model list LAST.
 *
 * Run: node --test test/card-position.test.js
 *
 * WHY A SEPARATE GATE
 *
 * The card was just split into `account-panel.tsx` / `usage-panel.tsx`, each a
 * self-contained container, assembled by the thin `QoderPluginCard` in
 * `card.tsx`. That split is exactly the kind of change where a container gets
 * re-ordered by accident — and the order is NOT cosmetic: the region strip is
 * the body's header (it scopes the whole body), so the usage panel and model
 * list must sit below it. A test that only checks "all three are present"
 * would stay green if the usage panel were hoisted above the strip and broke
 * the header semantics. This gate checks ORDER, against the shipped artifact,
 * so a rebuild that reorders the card fails even though every other test
 * passes.
 *
 * It reuses the jsdom harness that renders `lib/client.js` itself, so it
 * exercises the code the user actually sees — not a transcription.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadCardBundle, renderCards } from './helpers/render-card.js'

let mountedRoot = null
afterEach(() => {
  mountedRoot?.unmount()
  mountedRoot = null
})

const model = (overrides) => ({
  id: 'qwen3-coder',
  region: 'qoder-cn',
  name: 'Qwen3 Coder',
  contextWindowLabel: '200K',
  priceFactor: 1.0,
  promotion: undefined,
  isVL: false,
  ...overrides,
})

const REGIONS = [
  { region: 'qoder-cn', regionName: 'Qoder CN', state: 'ok', source: 'env-pat', appName: 'Qoder', enabled: true, identity: { name: 'test@example.com', expiresAt: 0 } },
  { region: 'qoder', regionName: 'Qoder', state: 'ok', source: 'env-pat', appName: 'Qoder', enabled: true, identity: { name: 'test@example.com', expiresAt: 0 } },
]

function routeStub({ models = [model({})], accountRegions = REGIONS, usageRegions = [], saveStatus = 200 } = {}) {
  const calls = []
  const handler = (url, init = {}) => {
    calls.push({ url, method: (init.method ?? 'GET').toUpperCase() })
    const text = String(url)
    if (text.includes('/models')) {
      return Promise.resolve({ ok: true, json: async () => ({ models }) })
    }
    if (text.includes('/account') && text.includes('confirm')) {
      return Promise.resolve({ ok: true, json: async () => ({ confirmed: true }) })
    }
    if (text.includes('/account/reload')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
    }
    if (text.includes('/account')) {
      return Promise.resolve({ ok: true, json: async () => ({ regions: accountRegions, enabledRegions: Object.fromEntries(accountRegions.map((r) => [r.region, r.enabled !== false])) }) })
    }
    if (text.includes('/checkin')) {
      return Promise.resolve({ ok: true, json: async () => ({ granted: true, amount: 50 }) })
    }
    if (text.includes('/usage')) {
      return Promise.resolve({ ok: true, json: async () => ({ regions: usageRegions }) })
    }
    if (init.method === 'POST' || init.method === undefined) {
      if (text.includes('settings') || init.method === 'POST') {
        return Promise.resolve({ ok: saveStatus >= 200 && saveStatus < 300, status: saveStatus, json: async () => (saveStatus >= 200 && saveStatus < 300 ? ({ ok: true }) : ({ error: 'refused' })) })
      }
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }
  return { fetch: (url, init) => handler(url, init), calls }
}

// The card body's surface children, in the order the JSX emits them.
// `QoderPluginCard` mounts (inside `.dsm-qoder-body`): account panel
// (strip + sign-in) → usage panel → model list. Anything else here means the
// assembly was reordered.
const EXPECTED_SURFACES = [
  'dsm-qoder-account', // region strip + selected-region sign-in (account-panel.tsx)
  'dsm-qoder-usage-row', // usage panel (usage-panel.tsx)
  'dsm-qoder-models', // model list (card.tsx)
]

test('card body renders account → usage → models in that fixed order', async () => {
  const stub = routeStub()
  const loaded = await loadCardBundle({ fetchImpl: stub.fetch })
  const card = loaded.slots[0]
  const rendered = await renderCards({ card, registered: loaded.registered, scope: loaded.scope, window: loaded.window })
  mountedRoot = rendered

  const body = rendered.container.querySelector('.dsm-qoder-body')
  assert.ok(body !== null, 'the card body (dsm-qoder-body) must render')
  const present = EXPECTED_SURFACES.filter((cls) => body.querySelector(`.${cls}`) !== null)
  assert.deepEqual(
    present,
    EXPECTED_SURFACES,
    `all body surfaces must render; missing: ${EXPECTED_SURFACES.filter((c) => !present.includes(c)).join(', ')}`,
  )

  // Walk the body's child element order, collecting the known surface markers
  // in document order, and assert the sequence matches.
  const order = []
  for (const child of body.children) {
    const cls = String(child.className ?? '')
    if (cls.includes('dsm-qoder-account')) order.push('account')
    else if (cls.includes('dsm-qoder-usage-row')) order.push('usage')
    else if (cls.includes('dsm-qoder-models')) order.push('models')
  }
  assert.deepEqual(
    order,
    ['account', 'usage', 'models'],
    `body surfaces must sit in order account → usage → models; saw: ${order.join(', ')}`,
  )
})
