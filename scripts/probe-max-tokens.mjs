#!/usr/bin/env node
/**
 * Live re-probe of the pinned output ceiling (`PROBED_MAX_TOKENS`).
 *
 * Run: node scripts/probe-max-tokens.mjs [--gap 60000]
 *
 * WHY THIS EXISTS
 *
 * `PROBED_MAX_TOKENS` (65536) in `src/host/pi-model.ts` is a pin, not a guess:
 * the platform states its own ceiling in a 400 body ("max_tokens 不能超过
 * 65536"). Pins drift when platforms change, so the value must be re-verified
 * on a machine that has real credentials. The rule the pin was written under
 * (the live-contract discipline the shared LLM guide pins, §5):
 *
 *   - the declared value must STILL be accepted;
 *   - twice the declared value must STILL be rejected.
 *
 * Either half failing means the pin is stale and `PROBED_MAX_TOKENS` needs
 * updating — this script exits 1 in that case so it can gate a PR.
 *
 * WHAT IT SENDS
 *
 * Two tiny non-thinking completions (prompt: one word, cost ≈ nothing) through
 * the plugin's own `streamChat`, spaced by `--gap` milliseconds (default 60 s):
 * the platform must not be probed in a burst. No thinking budget is spent, no
 * quota-heavy call is made.
 *
 * NOT IN CI. Like `verify-live.mjs` this needs a real sign-in (a local Qoder
 * app credential or a `QODER_API_KEY` / `QODERCN_API_KEY` env variable) and
 * real network access, neither of which a CI runner has.
 *
 * Token material is never printed.
 */

import { loadCredentialAsync, loadEnvCredential, REGIONS } from '../src/host/credentials.ts'
import { fetchModels, streamChat } from '../src/host/upstream.ts'
import { describeThrown, thrownFlag } from '../src/host/errors.ts'
import { PROBED_MAX_TOKENS } from '../src/host/pi-model.ts'

const GAP_MS = Number(process.argv[process.argv.indexOf('--gap') + 1]) || 60_000

/** Sleep so probes are spaced, not burst. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Ask for a one-word reply; this is the cheapest possible completion. */
const PROBE_PROMPT = 'Reply with the single word: ok'

function resolveCredential(region) {
  return loadCredentialAsync(region).then((app) => (app !== undefined ? app : loadEnvCredential(region) ?? undefined))
}

async function sendOnce(region, credential, model, maxTokens) {
  const controller = new AbortController()
  const hardStop = setTimeout(() => controller.abort(), 10 * 60_000)
  try {
    // A non-thinking, one-word turn: the stream finishes in seconds.
    const stream = streamChat(
      region,
      credential,
      {
        model: model.key,
        messages: [{ role: 'user', content: PROBE_PROMPT }],
        tools: [],
        maxTokens,
        enableThinking: false,
        alwaysThinking: model.alwaysThinking === true,
        reasoningEffort: undefined,
        sessionId: 'dsh-probe-max-tokens',
      },
      controller.signal,
    )
    for await (const chunk of stream) {
      // Drain: the verdict is "the stream completed", not the content.
      void chunk
    }
    return { accepted: true }
  } catch (error) {
    // A hard stop: the account is gone or the daily allowance is spent. Don't
    // spend the next day's allowance to finish a probe.
    if (thrownFlag(error, 'dailyLimit') === true || thrownFlag(error, 'signInExpired') === true) {
      return { accepted: false, fatal: true, message: describeThrown(error) }
    }
    // A queued answer is NOT a verdict: it says nothing about the ceiling.
    if (thrownFlag(error, 'retryable') === true) {
      return { accepted: false, queued: true, message: describeThrown(error) }
    }
    // The 10-minute hard stop: the stream stalled, not a platform answer.
    if (controller.signal.aborted === true) {
      return { accepted: false, timeout: true, message: 'probe timed out' }
    }
    // A platform rejection (the 131072 case): the error message carries the
    // platform's own body text, which is the evidence the pin needs.
    return { accepted: false, message: describeThrown(error) }
  } finally {
    clearTimeout(hardStop)
  }
}

/** Find the first region that can answer, and probe exactly it. */
async function main() {
  console.log(`dsh-connect-qoder maxTokens 探针（声明值 ${PROBED_MAX_TOKENS}，双倍 ${PROBED_MAX_TOKENS * 2}）`)
  console.log('花费极小（两条单字、非思考请求），但仍是真实凭据与真实网络。')

  let credential
  let region
  let model
  for (const candidate of REGIONS) {
    const cred = await resolveCredential(candidate)
    if (cred === undefined) {
      console.log(`  ${candidate.displayName}: 跳过（无凭据）`)
      continue
    }
    const models = await streamModels(candidate, cred)
    const pick = pickModel(models)
    if (pick === undefined) {
      console.log(`  ${candidate.displayName}: 有凭据但没有可用模型（${models.length} 个目录行）`)
      continue
    }
    region = candidate
    credential = cred
    model = pick
    console.log(`  ${region.displayName}: 用 ${model.name}（key=${model.key}，rate=${model.priceFactor}x，reasoning=${model.isReasoning === true}）`)
    break
  }

  if (model === undefined) {
    console.log('\n没有可用的凭据或模型——请先在本机登录 Qoder，或设置 QODER_API_KEY / QODERCN_API_KEY，再重跑。')
    process.exitCode = 1
    return
  }

  // 1. The declared value must still be accepted.
  const pinned = await sendOnce(region, credential, model, PROBED_MAX_TOKENS)
  if (report('声明值 ' + PROBED_MAX_TOKENS, pinned) === 'stop') return
  if (pinned.queued === true || pinned.timeout === true) {
    console.log('\n⚠ 未取得判定（排队或超时）。错开平台高峰重跑；在拿到判定前，别把 PROBED_MAX_TOKENS 当作已复核。')
    process.exitCode = 1
    return
  }

  // 2. Twice it must still be rejected — spaced, not burst.
  if (GAP_MS > 0) {
    console.log(`  … 间隔 ${GAP_MS} ms …`)
    await sleep(GAP_MS)
  }
  const doubled = await sendOnce(region, credential, model, PROBED_MAX_TOKENS * 2)
  if (report('双倍 ' + PROBED_MAX_TOKENS * 2, doubled) === 'stop') return

  const pinnedOk = pinned.accepted === true
  const doubleOk = doubled.accepted === false && doubled.queued !== true && doubled.timeout !== true
  if (pinnedOk && doubleOk) {
    console.log(`\n✓ 钉值仍成立：${PROBED_MAX_TOKENS} 被接受、${PROBED_MAX_TOKENS * 2} 被拒绝。`)
    return
  }
  if (doubled.queued === true || doubled.timeout === true) {
    console.log('\n⚠ 双倍未取得判定（排队或超时）。错开平台高峰重跑。')
    process.exitCode = 1
    return
  }
  console.log(
    `\n✗ 钉值漂移：声明值${pinned.accepted ? '仍被接受' : '已被拒绝'}，双倍${doubled.accepted ? '被接受（平台上限已上调）' : '被拒绝'}。` +
      ` 若上限已变，按平台 400 原文更新 src/host/pi-model.ts 的 PROBED_MAX_TOKENS 并同步本注释。`,
  )
  process.exitCode = 1
}

/** Log one probe result. Returns 'stop' for the hard stops (never continue). */
function report(label, result) {
  if (result.fatal === true) {
    console.log(`  ✗ ${label} 命中硬停（登录过期或日限额）：${describeWhy(result)} — 停止，不再发`)
    process.exitCode = 1
    return 'stop'
  }
  const state = result.accepted
    ? '✓ 接受'
    : result.queued === true
      ? '⚠ 排队中（不是判定）'
      : result.timeout === true
        ? '⚠ 超时（不是判定）'
        : '✗ 拒绝：' + describeWhy(result)
  console.log(`  ${label} → ${state}`)
  return 'ok'
}

/** Read the catalog once; a failure here means there is nothing to probe. */
async function streamModels(region, credential) {
  try {
    return await fetchModels(region, credential)
  } catch (error) {
    console.log(`  ✗ 模型目录: ${describeThrown(error)}`)
    return []
  }
}

/** Cheapest reasoning model first: reasoning-capable pool, then lowest rate. */
function pickModel(models) {
  if (models.length === 0) return undefined
  const reasoned = models.filter((m) => m.isReasoning === true)
  const pool = reasoned.length > 0 ? reasoned : models
  return [...pool].sort((a, b) => (Number(a.priceFactor) || 0) - (Number(b.priceFactor) || 0))[0]
}

function describeWhy(result) {
  return result.message?.length > 160 ? `${result.message.slice(0, 160)}…` : result.message
}

main().catch((error) => {
  console.error('探针自身出错:', describeThrown(error))
  process.exitCode = 1
})
