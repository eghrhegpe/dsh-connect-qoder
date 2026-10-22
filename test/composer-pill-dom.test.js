/**
 * 对话框用量胶囊的 DOM 行为，跑 SHIPPED 的 `lib/client.js`。
 *
 * Run: node --test test/composer-pill-dom.test.js
 *
 * 为什么另开一个文件：`composer-pill.test.js` 是纯模型层 + 静态断言（能 `node --test`
 * 直接跑），但「用户真的在输入框旁边看到 `Qoder CN · 1,034`、点开面板、Esc 能关」
 * 只能靠 `test/helpers/render-card.js` 把 `lib/client.js` 在 jsdom 里渲出来才证明。
 * 走同一个产物，CI 已 build 过，本文件不另建 bundling 假设。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadCardBundle, renderCards } from './helpers/render-card.js'

/** 一个应答 host 路由的 fetch 桩。 */
function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

const USAGE_BODY = {
  regions: [
    {
      region: 'qoder-cn',
      regionName: 'Qoder CN',
      available: true,
      userQuota: { used: 266, total: 1300, remaining: 1034, unit: 'credits', percentage: 0.2046 },
      addOnQuota: { used: 0, total: 100, remaining: 100, unit: 'credits', percentage: 0 },
      checkin: { active: true, todayCheckedIn: false, amount: 100 },
    },
  ],
}

/** 模型名册：qwen3.5-coder 带错峰窗口（全天，保证测试时刻必在窗口内）。 */
const MODELS_BODY = {
  models: [
    {
      id: 'qwen3.5-coder',
      name: 'Qwen3.5 Coder',
      region: 'qoder-cn',
      priceFactor: 0.5,
      promotion: {
        active: true,
        windowStart: '00:00:00',
        windowEnd: '23:59:59',
        timezone: 'Asia/Shanghai',
        discountFactor: 1,
        beforePromotionPriceFactor: 0.5,
      },
    },
  ],
}

const fetchStub = async (url) => {
  const path = String(url)
  if (path.includes('/plugins/dsh-connect-qoder/usage')) return jsonResponse(USAGE_BODY)
  if (path.includes('/plugins/dsh-connect-qoder/models')) return jsonResponse(MODELS_BODY)
  return jsonResponse({})
}

/** 找出 apply() 注册到 `conversation.input.right` 的那条座席。 */
function composerSlotOf(slots) {
  return slots.find((entry) => entry.slot?.name === 'conversation.input.right')
}

test('the shipped bundle registers the composer pill slot', async () => {
  const { slots } = await loadCardBundle({ fetchImpl: fetchStub })
  const slot = composerSlotOf(slots)
  assert.ok(slot, 'expected a conversation.input.right registration in lib/client.js')
  assert.equal(slot.slot.id, 'llm-qoder-composer-pill')
  assert.equal(typeof slot.card, 'function')
})

test('renders the region prefix and the primary remaining credits', async () => {
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: fetchStub })
  const card = composerSlotOf(slots)
  const { container, unmount } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    const text = container.textContent ?? ''
    assert.match(text, /Qoder CN/)
    assert.match(text, /1,034/)
    assert.ok(!/—/.test(text), 'expected a real reading, not the unknown dash')
  } finally {
    unmount()
  }
})

test('opens the panel on click and shows the raw quota detail', async () => {
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: fetchStub })
  const card = composerSlotOf(slots)
  const { container, unmount, react } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    const button = container.querySelector('button')
    assert.ok(button, 'expected a toggle button')
    assert.equal(button.getAttribute('aria-expanded'), 'false')
    await react.act(async () => {
      button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    assert.equal(button.getAttribute('aria-expanded'), 'true')
    const panel = container.querySelector('[role="dialog"]')
    assert.ok(panel, 'expected a popover dialog after opening')
    const text = panel.textContent ?? ''
    assert.match(text, /1,034/)
    assert.match(text, /100/)
    assert.match(text, /签到领/)
  } finally {
    unmount()
  }
})

test('Escape closes the panel', async () => {
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: fetchStub })
  const card = composerSlotOf(slots)
  const { container, unmount, react } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    const button = container.querySelector('button')
    await react.act(async () => {
      button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    assert.ok(container.querySelector('[role="dialog"]'))
    await react.act(async () => {
      w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    assert.equal(container.querySelector('[role="dialog"]'), null)
  } finally {
    unmount()
  }
})

test('a non-Qoder provider renders nothing', async () => {
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: fetchStub })
  const card = composerSlotOf(slots)
  const { container, unmount } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'deepseek' } }) },
  })
  try {
    const text = container.textContent ?? ''
    assert.ok(!/Qoder/.test(text), 'a non-Qoder provider must not render the pill')
    assert.equal(container.querySelector('[role="dialog"]'), null)
  } finally {
    unmount()
  }
})

test('a missing region shows the dash, never a fabricated zero', async () => {
  // 桩里不含当前 region：读不到时胶囊必须显示 `—`（"还没查到"），不能写 0
  // （"你额度用完了"）。这是红线 1 的读数侧：把缺数据说成事实就是撒谎。
  const emptyStub = async (url) => {
    const path = String(url)
    if (path.includes('/plugins/dsh-connect-qoder/usage')) return jsonResponse({ regions: [] })
    return jsonResponse({})
  }
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: emptyStub })
  const card = composerSlotOf(slots)
  const { container, unmount } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    assert.match(container.textContent ?? '', /Qoder CN\s*·\s*—/)
    assert.ok(!/0\s*$/.test((container.textContent ?? '').trim()))
  } finally {
    unmount()
  }
})

test('the panel claims today\'s check-in and reflects it after the re-read', async () => {
  // 有状态的桩：第一次读 todayCheckedIn=false，POST /checkin 后置 true，下一次
  // GET /usage 返回已签到——复现「领取 → 重读 → 余额与状态一起更新」的真实链路。
  const calls = []
  let checkedIn = false
  const usageOf = () => ({
    regions: [
      {
        region: 'qoder-cn',
        available: true,
        userQuota: { used: 266, total: 1300, remaining: 1034, unit: 'credits', percentage: 0.2046 },
        addOnQuota: { used: 0, total: 100, remaining: 100, unit: 'credits', percentage: 0 },
        checkin: { active: true, todayCheckedIn: checkedIn, amount: 100 },
      },
    ],
  })
  const stub = async (url, options) => {
    const path = String(url)
    if (path.includes('/plugins/dsh-connect-qoder/checkin')) {
      calls.push({ path, method: options?.method ?? 'GET' })
      checkedIn = true
      return jsonResponse({ amount: 100 })
    }
    if (path.includes('/plugins/dsh-connect-qoder/usage')) return jsonResponse(usageOf())
    return jsonResponse({})
  }
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: stub })
  const card = composerSlotOf(slots)
  const { container, unmount, react } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    const toggle = container.querySelector('button')
    await react.act(async () => {
      toggle.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    const panel = container.querySelector('[role="dialog"]')
    assert.ok(panel, 'expected the popover')
    const claimButton = [...panel.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('签到领'))
    assert.ok(claimButton, 'expected a check-in claim button in the popover')
    assert.ok((claimButton.textContent ?? '').includes('100'))

    await react.act(async () => {
      claimButton.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    // 领取后组件会重读 usage；多让几条微任务落定。
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    assert.ok(calls.length >= 1, 'expected the check-in route to be called')
    assert.match(calls[0].path, /region=qoder-cn/)
    assert.match((panel.textContent ?? '') + (container.textContent ?? ''), /今日已签到/)
  } finally {
    unmount()
  }
})

test('the panel shows the off-peak block only for the selected model, and only inside its window', async () => {
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: fetchStub })
  const card = composerSlotOf(slots)
  const { container, unmount, react } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: {
      useProjection: () => ({ next: { provider: 'qoder-cn', model: 'qwen3.5-coder' } }),
    },
  })
  try {
    const button = container.querySelector('button')
    await react.act(async () => {
      button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    // 名册是异步读的，多让几条微任务落定。
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const panel = container.querySelector('[role="dialog"]')
    const text = panel.textContent ?? ''
    // 折扣挂在模型上，块里必须先说当前是哪个模型，再说费率与倒计时。
    assert.match(text, /Qwen3.5 Coder/)
    assert.match(text, /错峰折扣生效/)
    assert.match(text, /x0.50/)
    assert.match(text, /剩余/)
  } finally {
    unmount()
  }
})

test('a selected model outside the roster draws no off-peak block (no guessing)', async () => {
  // `projection.model` 不在名册里：面板照常显示余额与签到，但绝不声称某条模型在打折。
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: fetchStub })
  const card = composerSlotOf(slots)
  const { container, unmount, react } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: {
      useProjection: () => ({ next: { provider: 'qoder-cn', model: 'not-in-roster' } }),
    },
  })
  try {
    const button = container.querySelector('button')
    await react.act(async () => {
      button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    // 等名册加载完再断言：若名册已到位仍不画块，才是「匹配不上不猜」；还没加载
    // 就断言没块，测的不是这个裁定。
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const panel = container.querySelector('[role="dialog"]')
    const text = panel.textContent ?? ''
    assert.match(text, /1,034/)
    assert.ok(!/错峰/.test(text), 'expected no off-peak block for an unmatched model')
  } finally {
    unmount()
  }
})

test('a failed check-in shows a red failure with the route\'s detail, and frees the button', async () => {
  // 签到 POST 失败的红色 `pill.checkinFailed` 路径此前零测试（审核 P2-3）。
  // 桩带 {error, detail}：detail 必须穿透到面板（审核 P2-1 在签到侧的同款防线），
  // 用户看到的是「为什么失败」，不是一个裸错误码。
  const stub = async (url, options) => {
    const path = String(url)
    if (path.includes('/plugins/dsh-connect-qoder/checkin')) {
      return { ok: false, status: 500, json: async () => ({ error: 'checkin-failed', detail: '服务端开小差了' }) }
    }
    if (path.includes('/plugins/dsh-connect-qoder/usage')) return jsonResponse(USAGE_BODY)
    if (path.includes('/plugins/dsh-connect-qoder/models')) return jsonResponse(MODELS_BODY)
    return jsonResponse({})
  }
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: stub })
  const card = composerSlotOf(slots)
  const { container, unmount, react } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    await react.act(async () => {
      container.querySelector('button').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    const panel = container.querySelector('[role="dialog"]')
    const claimButton = [...panel.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('签到领'))
    assert.ok(claimButton, 'expected a check-in claim button')
    await react.act(async () => {
      claimButton.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const text = panel.textContent ?? ''
    assert.match(text, /签到失败/)
    assert.match(text, /服务端开小差了/, 'the route detail must reach the panel')
    assert.ok(!claimButton.disabled, 'a failed claim must not leave the button busy forever')
  } finally {
    unmount()
  }
})

test('a failed re-read keeps the old number but marks it possibly stale', async () => {
  // 红线 1 的读数侧（审核 P2-4）：刷新失败时保留上次数值，但必须说得出这是旧数。
  // 第一次 GET /usage 成功，签到后的重读失败——面板仍显示 1,034，同时出现过期标注。
  let usageCalls = 0
  const stub = async (url) => {
    const path = String(url)
    if (path.includes('/plugins/dsh-connect-qoder/checkin')) return jsonResponse({ amount: 100 })
    if (path.includes('/plugins/dsh-connect-qoder/usage')) {
      usageCalls += 1
      if (usageCalls > 1) {
        return { ok: false, status: 503, json: async () => ({ error: 'usage-unavailable', detail: '上游没应答' }) }
      }
      return jsonResponse(USAGE_BODY)
    }
    if (path.includes('/plugins/dsh-connect-qoder/models')) return jsonResponse(MODELS_BODY)
    return jsonResponse({})
  }
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: stub })
  const card = composerSlotOf(slots)
  const { container, unmount, react } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    await react.act(async () => {
      container.querySelector('button').dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    const panel = container.querySelector('[role="dialog"]')
    assert.ok((panel.textContent ?? '').includes('1,034'))
    assert.ok(!/过期/.test(panel.textContent ?? ''), 'a fresh read must not be labelled stale')

    const claimButton = [...panel.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('签到领'))
    await react.act(async () => {
      claimButton.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const text = panel.textContent ?? ''
    assert.ok(usageCalls > 1, 'the claim path must have triggered the re-read')
    assert.match(text, /1,034/, 'the failed re-read must not blank or zero the last good number')
    assert.match(text, /数据可能已过期/)
  } finally {
    unmount()
  }
})

/* ------------------------------------------------------------------ */
/* 新模型标记：真的渲染出来才算数                                        */
/* ------------------------------------------------------------------ */

/** 一份带新模型 id 的名册：qwen3.5-coder 老、qwen4-coder 新。 */
const MODELS_BODY_WITH_NEW = {
  models: [
    { id: 'qwen3.5-coder', name: 'Qwen3.5 Coder', region: 'qoder-cn', priceFactor: 0.5 },
    { id: 'qwen4-coder', name: 'Qwen4 Coder', region: 'qoder-cn', priceFactor: 0.4 },
  ],
  newModelIds: ['qwen4-coder'],
}

/**
 * 按名册响应替换 `/models` 的桩，其余同 fetchStub。
 *
 * @param {string[]} newModelIds
 */
function stubWithNewModels(newModelIds) {
  return async (/** @type {unknown} */ url) => {
    const path = String(url)
    if (path.includes('/plugins/dsh-connect-qoder/usage')) return jsonResponse(USAGE_BODY)
    if (path.includes('/plugins/dsh-connect-qoder/models')) {
      return jsonResponse({ ...MODELS_BODY_WITH_NEW, newModelIds })
    }
    return jsonResponse({})
  }
}

test('the pill marks a new model and names it in the panel', async () => {
  const { slots, window: w, registered, scope } = await loadCardBundle({
    fetchImpl: stubWithNewModels(['qwen4-coder']),
  })
  const card = composerSlotOf(slots)
  const { container, unmount, react } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    const button = container.querySelector('button')
    assert.match(button.textContent ?? '', /1 新模型/, 'the pill body must carry the count')
    assert.match(button.textContent ?? '', /Qoder CN · 1,034/, 'the existing two readings must survive')

    await react.act(async () => {
      button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    })
    const panel = container.querySelector('[role="dialog"]')
    const text = panel.textContent ?? ''
    assert.match(text, /本机新见/)
    assert.match(text, /Qwen4 Coder/)
    assert.ok(!text.includes('Qwen3.5 Coder'), 'an old model must not be named in the new-model row')
  } finally {
    unmount()
  }
})

test('no new-model field renders the pill exactly as before', async () => {
  // The backward-compatible shape: an old host sends no `newModelIds`, and the
  // pill must stay the two readings it always was — no "0 新模型".
  const { slots, window: w, registered, scope } = await loadCardBundle({ fetchImpl: fetchStub })
  const card = composerSlotOf(slots)
  const { container, unmount } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    const text = container.querySelector('button').textContent ?? ''
    assert.ok(!/新模型/.test(text), 'no marker when there is nothing new')
  } finally {
    unmount()
  }
})

test('a new id outside the rendered roster is not counted', async () => {
  // The host already filters these, and the client filters again: the marker
  // must never point at a row that is not on screen.
  const { slots, window: w, registered, scope } = await loadCardBundle({
    fetchImpl: stubWithNewModels(['qwen4-coder', 'not-in-roster']),
  })
  const card = composerSlotOf(slots)
  const { container, unmount } = await renderCards({
    card,
    registered,
    scope,
    window: w,
    props: { useProjection: () => ({ next: { provider: 'qoder-cn' } }) },
  })
  try {
    assert.match(container.querySelector('button').textContent ?? '', /1 新模型/)
  } finally {
    unmount()
  }
})