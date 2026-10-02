/**
 * Render the shipped card in a real DOM and assert on what the user sees.
 *
 * Run: node --test test/card-dom.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `test/client-bundle.test.js` guards two pure functions it extracts from the
 * bundle text, and says plainly what that cannot cover: "Everything around the
 * gate — the JSX rendering, the clock interval, the fetch of the host route, the
 * settings write. Those need a browser." This file IS that browser, without
 * launching one: jsdom provides the DOM, real `react`/`react-dom` render the
 * component, and `fetch` is stubbed to answer the host's own routes.
 *
 * It drives `lib/client.js` — the artifact the host ships — through its own
 * loader contract (`window.__ModuleLoader__.load`) and its own client context
 * (`slots.register`), so a card that loses its roster in a rebuild fails here
 * even though every other test stays green.
 *
 * WHAT IT PINS
 *
 * - the card renders the models the route answers, with rates and off-peak
 *   badges;
 * - an off-peak promotion inside its window shows the countdown, and one that
 *   upstream switched off does not;
 * - the region strip, the usage panel and the check-in row are present;
 * - a save that the host endpoint refuses surfaces the reason instead of a
 *   "已保存" banner (issue 06).
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadCardBundle, renderCards } from './helpers/render-card.js'

/** The most recently mounted card, so `afterEach` can release its timers. */
let mountedRoot = null
afterEach(() => {
  mountedRoot?.unmount()
  mountedRoot = null
})

/** A row the host's models route would serve, mirroring `projectModelRow`. */
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

/** A fetch stub answering the plugin's own routes from an in-memory model. */
function routeStub({ models = [model({})], accountRegions = REGIONS, usageRegions = [], saveStatus = 200 } = {}) {
  const calls = []
  const seen = (url) => { calls.push(String(url)); return calls }
  const json = (value) => ({
    ok: true,
    status: 200,
    json: async () => value,
  })
  const fetch = async (url, init) => {
    seen(url)
    const path = String(url)
    if (path.includes('/models')) {
      return json({
        models,
        imageOverrides: {},
        enabledModelIds: {},
        useMaximumContextWindow: false,
        refreshedAt: 1750000000000,
      })
    }
    if (path.includes('/account')) {
      return json({ regions: accountRegions, enabledRegions: Object.fromEntries(accountRegions.map((r) => [r.region, r.enabled !== false])) })
    }
    if (path.includes('/usage')) {
      return json({ regions: usageRegions })
    }
    if (path.includes('/__save')) {
      return {
        ok: saveStatus >= 200 && saveStatus < 300,
        status: saveStatus,
        json: async () => (saveStatus < 300 ? { ok: true, value: init?.body } : { ok: false, errorName: 'SettingsSaveError', error: 'refused' }),
      }
    }
    throw new Error(`unexpected fetch: ${path}`)
  }
  fetch.calls = calls
  return fetch
}

/** Mount the card once per test with a fresh route stub. */
async function mount(options = {}) {
  const fetchImpl = options.fetch ?? routeStub(options)
  const loaded = await loadCardBundle({ fetchImpl, scopePersist: options.scopePersist })
  const rendered = await renderCards({ ...loaded, card: loaded.slots[0] })
  mountedRoot = rendered
  return { ...loaded, ...rendered }
}

/** The visible text of a node, with its hidden parents filtered out. */
const text = (node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim()

/** Run one React state update and let the resulting microtasks settle. */
async function update(react, action) {
  await react.act(async () => {
    action()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

test('the card renders the models the host route answers', async () => {
  const { container } = await mount({
    models: [
      model({ id: 'm1', name: 'Alpha', priceFactor: 0.5, isVL: false }),
      model({ id: 'm2', name: 'Beta', priceFactor: 0, isVL: true }),
    ],
  })

  const names = [...container.querySelectorAll('.dsm-qoder-name')].map((n) => n.textContent)
  assert.ok(names.includes('Alpha'), 'Alpha model row missing')
  assert.ok(names.includes('Beta'), 'Beta model row missing')

  const free = container.querySelector('.dsm-qoder-rate-free')
  assert.ok(free !== null, 'a zero-factor model must be labelled free')
  assert.equal(free.textContent, '免费')
})

test('the region strip lists every known region', async () => {
  const { container } = await mount()
  const tabs = [...container.querySelectorAll('.dsm-qoder-region-name')].map((n) => n.textContent)
  assert.deepEqual(tabs, ['Qoder CN', 'Qoder'])
})

test('a live off-peak promotion renders a ticking countdown badge', async () => {
  const { container } = await mount({
    models: [
      model({
        id: 'm1',
        promotion: {
          active: true,
          windowStart: '22:00',
          windowEnd: '08:00',
          timezone: 'Asia/Shanghai',
        },
      }),
    ],
  })
  const countdown = [...container.querySelectorAll('.dsm-qoder-badge')]
    .find((b) => /\d{2}:\d{2}:\d{2}/.test(b.textContent ?? ''))
  assert.ok(countdown !== undefined, 'no countdown badge for a live off-peak window')
})

test('a promotion Qoder has switched off never shows the discount', async () => {
  const { container } = await mount({
    models: [
      model({
        id: 'm1',
        promotion: {
          active: false,
          windowStart: '22:00',
          windowEnd: '08:00',
          timezone: 'Asia/Shanghai',
        },
      }),
    ],
  })
  const offer = container.querySelector('.dsm-qoder-badge-offer')
  assert.equal(offer, null, 'a switched-off promotion must not render the discount badge')
})

test('the usage panel renders the active region and the check-in row', async () => {
  const { container } = await mount({
    usageRegions: [
      {
        region: 'qoder-cn',
        available: true,
        userQuota: { used: 10, total: 100, remaining: 90, percentage: 0.1, unit: 'credits' },
        addOnQuota: { used: 0, total: 1000, remaining: 1000, percentage: 0, unit: 'credits' },
        checkin: { active: true, todayCheckedIn: false, amount: 50 },
      },
    ],
  })
  const bars = container.querySelectorAll('.dsm-qoder-bar')
  assert.equal(bars.length, 2, 'expected the plan and the add-on quota bars')
  const figures = [...container.querySelectorAll('.dsm-qoder-usage-figures')].map((n) => text(n))
  assert.ok(
    figures.some((f) => f.startsWith('10 / 100')),
    `expected the plan quota figures, got ${JSON.stringify(figures)}`,
  )
  const checkinButton = [...container.querySelectorAll('.dsm-qoder-button')]
    .find((b) => /签到/.test(text(b)))
  assert.ok(checkinButton !== undefined, 'no check-in button rendered')
  assert.equal(checkinButton.disabled, false, 'an unclaimed round must offer the claim button')
})

test('a save the host endpoint refuses surfaces the reason, not a "saved" banner', async () => {
  // The 0.1.7 silent-failure mode: the host endpoint is refused (503) AND the
  // settings scope resolves without persisting. The card must report the
  // failure rather than trust a resolved `set()`.
  const { container, react } = await mount({ saveStatus: 503, scopePersist: false })

  // Toggle one model's picker checkbox: that is the minimal edit that makes the
  // card dirty and enables the save button.
  const first = container.querySelector('.dsm-qoder-pick input[type="checkbox"]')
  assert.ok(first !== null, 'no picker checkbox rendered')
  await update(react, () => first.click())

  const save = [...container.querySelectorAll('button')].find((b) => text(b) === '保存')
  assert.ok(save !== undefined, 'no save button')
  await update(react, () => save.click())
  // `save()` awaits three sequential writes; yield enough turns for the chain.
  for (let i = 0; i < 6; i++) await update(react, () => {})

  const states = [...container.querySelectorAll('.dsm-qoder-state')].map((n) => text(n))
  assert.ok(
    states.some((s) => s.startsWith('保存失败')),
    'a refused save must show a failure banner, not "已保存"',
  )
  assert.ok(
    !states.includes('已保存'),
    'the card must not claim a save that never persisted',
  )
})