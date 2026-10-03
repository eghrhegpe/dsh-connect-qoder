#!/usr/bin/env node
/**
 * Live contract probe for the chat `parameters` Qoder accepts — run
 * deliberately, never by default.
 *
 * Run: npm run probe:params [--gap 60000]
 *
 * WHY THIS EXISTS
 *
 * The plugin sends four fields inside the chat request's `parameters` object,
 * and the whole thing is a CLONED private protocol with no negotiation:
 *
 *   - `enable_thinking`  (boolean)
 *   - `reasoning_effort` (a level string: low|medium|high|xhigh|max ...)
 *   - `max_tokens`       (the pinned ceiling)
 *
 * `src/host/upstream.ts` assembles them under a strict rule:
 *
 *   - `enableThinking === true` → `enable_thinking: true`, plus `reasoning_effort`
 *     when a level string is given;
 *   - a model that CAN disable thinking and is not asked to think →
 *     `enable_thinking: false`;
 *   - a model that ALWAYS thinks (`alwaysThinking`) → neither key is sent at
 *     all, because sending `enable_thinking: false` makes the gateway reject the
 *     turn with `provider_error` 1210 ("该模型始终思考，不支持关闭思考").
 *
 * `test/shim.test.js` already covers the SHIM→`streamChat` request assembly
 * against a local fake, but that proves only the in-process mapping — it never
 * asks the real platform whether the level strings it spells are the ones Qoder
 * still accepts, whether a bogus level is rejected rather than silently
 * ignored, or whether the 1210 rule still holds on the live endpoint. That is
 * exactly the "model-param contract" gap the sibling plugin's
 * `test/live-contract.mjs` closes for SenseNova, and the one this probe fills.
 *
 * The rules the probe holds the platform to (the live-contract discipline the
 * shared LLM guide pins, §5: pinned values are probed, not documented):
 *
 *   - a level the catalog advertises MUST still be accepted;
 *   - a bogus level the catalog never lists MUST still be rejected;
 *   - an always-thinking model MUST still reject `enable_thinking: false`
 *     (the 1210 rule);
 *   - the pinned `max_tokens` ceiling MUST still be accepted.
 *
 * Any half failing means a contract drift and `PROBED_*` / the assembly rule
 * in `upstream.ts` needs updating — this script exits 1 in that case so it can
 * gate a PR.
 *
 * WHAT IT SENDS
 *
 * One tiny non-thinking completion (prompt: one word, cost ≈ nothing) per case,
 * through the plugin's own `streamChat`, spaced by `--gap` milliseconds
 * (default 60 s): the platform must not be probed in a burst. No thinking
 * budget is spent on a thinking-ON case beyond the platform's own minimum.
 *
 * NOT IN CI. Like `verify-live.mjs` / `probe-max-tokens.mjs` this needs a real
 * sign-in (a local Qoder app credential or a `QODER_API_KEY` / `QODERCN_API_KEY`
 * env variable) and real network access, neither of which a CI runner has.
 *
 * Token material is never printed.
 *
 * The pure helpers (`buildParamCases`, `classifyOutcome`) are exported so a
 * node --test unit (`test/params-probe.test.js`) can assert the case
 * generation and the verdict logic WITHOUT a network — that is what keeps the
 * "is this a parameter rejection or just a queue?" decision under the default
 * suite rather than only ever eyeballed on a machine with credentials.
 */

import { loadCredentialAsync, loadEnvCredential, REGIONS } from '../src/host/credentials.ts'
import { fetchModels, streamChat } from '../src/host/upstream.ts'
import { describeThrown, isProtocolShapeChangedError, thrownFlag } from '../src/host/errors.ts'
import { PROBED_MAX_TOKENS } from '../src/host/pi-model.ts'

const GAP_MS = Number(process.argv[process.argv.indexOf('--gap') + 1]) || 60_000

/** Sleep so probes are spaced, not burst. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Ask for a one-word reply; this is the cheapest possible completion. */
const PROBE_PROMPT = 'Reply with the single word: ok'

/**
 * Build the parameter-contract cases for one model.
 *
 * Every case is `{ label, enableThinking, alwaysThinking, reasoningEffort, maxTokens }` —
 * the exact shape `streamChat` reads off a turn request. Separated from the
 * network so a unit test can assert the matrix without a live platform, and so
 * the SAME matrix is what the probe sends for real.
 *
 * `advertisedLevels` is the set the catalog published for this model
 * (`effortLevels`); `reasoning`/`alwaysThinking` come from the catalog too.
 * The four rule classes above are each represented:
 *
 *   - `advertised` level accepted (only when the model advertises levels);
 *   - `bogus` level rejected (only when the model advertises levels);
 *   - always-thinking `enable_thinking:false` rejected (only when always-thinking);
 *   - the pinned `max_tokens` ceiling accepted (every reasoning model).
 *
 * @param {object} model - one normalized catalog entry.
 * @returns {Array<object>} the cases to send.
 */
export function buildParamCases(model) {
  const levels = Array.isArray(model.effortLevels) ? model.effortLevels : []
  const reasoning = model.isReasoning === true
  const always = model.alwaysThinking === true
  const cases = []

  if (reasoning && levels.length > 0) {
    // A level the catalog itself offers — the platform must still take it.
    cases.push({ label: `level=${levels[0]} (advertised)`, enableThinking: true, alwaysThinking: always, reasoningEffort: levels[0], maxTokens: undefined })
    // A level the catalog never listed — the platform must still refuse it
    // (a silent "ignore" would let a mistyped picker level pass through).
    const bogus = 'not-a-real-effort'
    cases.push({ label: `level=${bogus} (bogus)`, enableThinking: true, alwaysThinking: always, reasoningEffort: bogus, maxTokens: undefined })
  }

  if (always) {
    // The 1210 rule: an always-thinking model rejects an explicit off.
    cases.push({ label: 'enable_thinking:false on always-thinking', enableThinking: false, alwaysThinking: true, reasoningEffort: undefined, maxTokens: undefined })
  }

  if (reasoning) {
    // The pinned ceiling must still be accepted.
    cases.push({ label: `max_tokens=${PROBED_MAX_TOKENS} (pinned)`, enableThinking: true, alwaysThinking: always, reasoningEffort: undefined, maxTokens: PROBED_MAX_TOKENS })
  }

  return cases
}

/**
 * Classify one completed probe send into a verdict the live check can reason about.
 *
 * The decision is deliberately narrow — it answers ONLY "did the platform
 * accept this parameter combination, reject it as a parameter, or give an
 * answer that is not a verdict at all?" It is exported so the unit test pins
 * the boundaries; the probe never invents a verdict from a queue.
 *
 *   - `accepted`        — the stream completed (a parameter rejection would
 *                         have thrown before any chunk).
 *   - `param-rejected`  — the platform refused the parameters: anything that is
 *                         NOT a retryable queue, NOT a spent daily allowance,
 *                         NOT a stale sign-in, and NOT a shape change. A
 *                         `provider_error` 1210 ("不支持关闭思考") lands here.
 *   - `shape-changed`   — the wire moved; reported as its own red.
 *   - `non-verdict`     — queue / daily-limit / sign-in-expired: a RHYTHM
 *                         answer, not a level verdict. The probe records it and
 *                         does NOT fail the run — re-run after the window.
 *
 * @param {unknown} error - the value `streamChat` threw, or `undefined` on success.
 * @returns {{ kind: 'accepted'|'param-rejected'|'shape-changed'|'non-verdict', message?: string }}
 */
export function classifyOutcome(error) {
  if (error === undefined) return { kind: 'accepted' }

  if (isProtocolShapeChangedError(error)) {
    return { kind: 'shape-changed', message: describeThrown(error) }
  }

  // Rhythm answers — never a parameter verdict. A queue (10605) and a spent
  // daily allowance (110) both arrive with retry hints; a stale sign-in (105)
  // means the cached credential is gone. Treating any of these as a "level
  // unsupported" red would teach readers to ignore reds, which is the one
  // thing a drift guard must never do.
  if (thrownFlag(error, 'retryable') === true) return { kind: 'non-verdict', message: describeThrown(error) }
  if (thrownFlag(error, 'dailyLimit') === true) return { kind: 'non-verdict', message: describeThrown(error) }
  if (thrownFlag(error, 'signInExpired') === true) return { kind: 'non-verdict', message: describeThrown(error) }

  // Everything else — including a parameter-level refusal (e.g. 1210) — is a
  // real rejection of what we sent.
  return { kind: 'param-rejected', message: describeThrown(error) }
}

/** Send one case; returns the classified outcome (never throws for platform refusals). */
async function sendOnce(region, credential, model, spec) {
  const controller = new AbortController()
  const hardStop = setTimeout(() => controller.abort(), 10 * 60_000)
  try {
    const stream = streamChat(
      region,
      credential,
      {
        model: model.key,
        messages: [{ role: 'user', content: PROBE_PROMPT }],
        tools: [],
        maxTokens: spec.maxTokens,
        enableThinking: spec.enableThinking,
        alwaysThinking: spec.alwaysThinking,
        reasoningEffort: spec.reasoningEffort,
        sessionId: 'dsh-probe-params',
      },
      controller.signal,
    )
    for await (const _chunk of stream) {
      // Drain: the verdict is "the stream completed", not the content.
    }
    return classifyOutcome(undefined)
  } catch (error) {
    return classifyOutcome(error)
  } finally {
    clearTimeout(hardStop)
  }
}

/** Pick the cheapest reasoning model: reasoning pool, always-thinking first, then lowest rate. */
function pickReasoningModel(models) {
  const reasoned = models.filter((m) => m.isReasoning === true)
  if (reasoned.length === 0) return undefined
  const pool = reasoned.sort((a, b) => {
    const aAlways = a.alwaysThinking === true ? 0 : 1
    const bAlways = b.alwaysThinking === true ? 0 : 1
    if (aAlways !== bAlways) return aAlways - bAlways
    return (Number(a.priceFactor) || 0) - (Number(b.priceFactor) || 0)
  })
  return pool[0]
}

/** Resolve a credential for one region: app credential first, then env PAT. */
function resolveCredential(region) {
  return loadCredentialAsync(region).then((app) => (app !== undefined ? app : loadEnvCredential(region) ?? undefined))
}

/** Log one case result; returns the verdict for the summary. */
function report(region, label, outcome) {
  const tag =
    outcome.kind === 'accepted'
      ? '✓ 接受'
      : outcome.kind === 'param-rejected'
        ? '✗ 参数拒绝'
        : outcome.kind === 'shape-changed'
          ? '✗ 协议漂移'
          : '⚠ 非判定（队列/日限额/登录过期）'
  console.log(`    ${region.displayName} · ${label} → ${tag}${outcome.message ? `：${(outcome.message || '').slice(0, 160)}` : ''}`)
  return outcome.kind
}

async function main() {
  console.log('dsh-connect-qoder 参数契约探针（最小单字请求，真实凭据与真实网络）')
  console.log('验证 enable_thinking / reasoning_effort 各档 / max_tokens 钉值 在真平台仍被按既有规则接受或拒绝。')

  let credential
  let region
  let model
  for (const candidate of REGIONS) {
    const cred = await resolveCredential(candidate)
    if (cred === undefined) {
      console.log(`  ${candidate.displayName}: 跳过（无凭据）`)
      continue
    }
    const models = await safeModels(candidate, cred)
    const pick = pickReasoningModel(models)
    if (pick === undefined) {
      console.log(`  ${candidate.displayName}: 有凭据但没有推理模型（${models.length} 个目录行）`)
      continue
    }
    region = candidate
    credential = cred
    model = pick
    console.log(`  ${region.displayName}: 用 ${model.name}（key=${model.key}，rate=${model.priceFactor}x，alwaysThinking=${model.alwaysThinking === true}，levels=${(model.effortLevels || []).join('/') || '-'}）`)
    break
  }

  if (model === undefined) {
    console.log('\n没有可用的凭据或推理模型——请先在本机登录 Qoder，或设置 QODER_API_KEY / QODERCN_API_KEY，再重跑。')
    process.exitCode = 1
    return
  }

  const cases = buildParamCases(model)
  if (cases.length === 0) {
    console.log('\n该模型无可验证的参数契约用例（既非推理模型也无档位），跳过。')
    process.exitCode = 1
    return
  }

  let reds = 0
  let nonVerdict = 0
  for (let i = 0; i < cases.length; i++) {
    const spec = cases[i]
    if (i > 0 && GAP_MS > 0) {
      console.log(`  … 间隔 ${GAP_MS} ms …`)
      await sleep(GAP_MS)
    }
    const outcome = await sendOnce(region, credential, model, spec)
    const verdict = report(region, spec.label, outcome)
    if (verdict === 'param-rejected') {
      // A parameter rejection is a red ONLY when the case was SUPPOSED to be
      // accepted. The bogus-level and always-thinking-off cases are SUPPOSED
      // to be rejected; an acceptance there is the drift.
      if (spec.label.includes('(advertised)') || spec.label.includes('(pinned)')) reds += 1
    } else if (verdict === 'shape-changed') {
      reds += 1
    } else if (verdict === 'accepted') {
      // An acceptance that should have been a rejection is the other red.
      if (spec.label.includes('(bogus)') || spec.label.includes('always-thinking')) reds += 1
    } else {
      nonVerdict += 1
    }
  }

  if (nonVerdict > 0 && reds === 0) {
    console.log('\n⚠ 未取得判定（队列/日限额/登录过期）。错开平台高峰重跑；在拿到判定前，别把参数契约当作已复核。')
    process.exitCode = 1
    return
  }
  if (reds === 0) {
    console.log('\n✓ 参数契约成立：广告档位与钉值被接受，伪造档位与 always-thinking:false 被拒绝。')
    return
  }
  console.log(
    `\n✗ 参数契约漂移：${reds} 项与既有规则不符。` +
      ' 若平台已改字段名/档位/上限，按 live 原文更新 src/host/upstream.ts 的组装规则（及 pi-model.ts 的 PROBED_MAX_TOKENS）并同步相关注释。',
  )
  process.exitCode = 1
}

/** Read the catalog once; a failure here means there is nothing to probe. */
async function safeModels(region, credential) {
  try {
    return await fetchModels(region, credential)
  } catch (error) {
    console.log(`  ✗ 模型目录: ${describeThrown(error)}`)
    return []
  }
}

// Run only when executed directly (`node scripts/probe-params.mjs`), not when
// imported by the offline unit test (`test/params-probe.test.js`) that pins
// the exported pure helpers. Importing the module must not spin up a live
// probe — the test has no credentials and must not fail the suite for it.
//
// `process.argv[1]` is a (possibly relative) path from the shell, while
// `import.meta.url` is an absolute `file://` URL, so the two are normalised to
// the same absolute path before comparing — a bare template string would never
// match a relative `scripts/…` argument and would silently skip `main`.
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (isMain) {
  main().catch((error) => {
    console.error('探针自身出错:', describeThrown(error))
    process.exitCode = 1
  })
}
