#!/usr/bin/env node
/**
 * Live acceptance against the real Qoder upstream.
 *
 * Run: npm run test:live
 *
 * Modeled on dsh-connect-workbuddy's `scripts/verify-e2e.mjs`, which does the
 * same for that plugin. This is the ONLY thing that answers the question the
 * whole plugin is at risk of failing silently: **is the cloned private protocol
 * still the one Qoder speaks?** A 403 or a reshaped envelope arrives here as a
 * readable failure with the HTTP status and body, not as a two-minute queue
 * that the card quietly waits out.
 *
 * READ-ONLY: model catalog + credits + one tiny user-info read. A minimal chat
 * is deliberately NOT included — it is the one call that spends real quota, and
 * `streamChat` is the riskiest surface to probe unattended.
 *
 * NOT IN CI. This needs a real sign-in on this machine (a local Qoder app
 * credential or a `QODER_API_KEY` / `QODERCN_API_KEY` environment variable) and
 * real network access to Qoder. A CI runner has neither, so wiring it into
 * GitHub Actions would make the build depend on credentials nobody commits.
 *
 * Token material is never printed. The only thing printed for a credential is
 * where it came from and whether it expired.
 */

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { loadCredentialAsync, loadEnvCredential, REGIONS } from '../src/host/credentials.ts'
import { fetchModels, fetchUsage, fetchUserInfo } from '../src/host/upstream.ts'

/**
 * Keep anything that looks like a token or key off the terminal.
 *
 * `auth.v1.dat` carries a base64 blob that can be long; the PATs and the
 * decrypted bearer are long too. Anything 24+ characters of `[\w-]` is likely
 * one of those, so it is redacted rather than guessed at field by field.
 */
function redact(value) {
  if (typeof value !== 'string') return value
  if (/^[\w-]{24,}$/.test(value)) return `<redacted len=${value.length}>`
  return value
}

/** Print one section header, so the log reads as a checklist. */
function section(title) {
  console.log(`\n=== ${title} ===`)
}

/** `loaded` may be a credential or `undefined`; say which. */
function describeLoaded(region, credential) {
  if (credential === undefined) return `  ${region.displayName}: 无本地凭据`
  const lines = [
    `  ${region.displayName}: 已加载`,
    `    来源:   ${redact(credential.source)}`,
    `    过期:   ${credential.expired === true ? '已过期' : '有效'}`,
  ]
  if (credential.filePath !== undefined) lines.push(`    文件:   ${credential.filePath}`)
  return lines.join('\n')
}

/** Resolve a credential for one region: app credential first, then env PAT. */
async function resolveCredential(region) {
  const app = await loadCredentialAsync(region)
  if (app !== undefined) return app
  const env = loadEnvCredential(region)
  return env ?? undefined
}

let failures = 0
/** Record a failed probe and continue, so one dead region never hides the other. */
function fail(message) {
  failures += 1
  console.log(`  ✗ ${message}`)
}

async function main() {
  console.log('dsh-connect-qoder 实测验收（只读，不产生计费请求）')

  section('1. 凭据发现')
  const resolved = new Map()
  for (const region of REGIONS) {
    const credential = await resolveCredential(region)
    console.log(describeLoaded(region, credential))
    if (credential !== undefined) resolved.set(region.id, credential)
  }
  if (resolved.size === 0) {
    console.log('\n没有可用的凭据——请先在本机登录 Qoder，或设置 QODER_API_KEY / QODERCN_API_KEY。')
    process.exitCode = 1
    return
  }

  section('2. 模型目录')
  for (const region of REGIONS) {
    const credential = resolved.get(region.id)
    if (credential === undefined) {
      console.log(`  ${region.displayName}: 跳过（无凭据）`)
      continue
    }
    try {
      const models = await fetchModels(region, credential)
      console.log(`  ${region.displayName}: ${models.length} 个模型`)
      for (const entry of models.slice(0, 12)) {
        const rate = entry.priceFactor === undefined ? '-' : `${entry.priceFactor}x`
        const window = entry.defaultContextWindow
          ? `${entry.defaultContextWindow}`
          : '-'
        const offPeak = entry.promotion?.active === true ? ' 错峰' : ''
        console.log(
          `    ${String(entry.key).padEnd(22)} ${String(entry.name).padEnd(24)} ` +
            `in=${window.padEnd(8)} rate=${rate.padEnd(6)} vl=${String(entry.isVL).padEnd(5)}${offPeak}`,
        )
      }
      if (models.length > 12) console.log(`    … 还有 ${models.length - 12} 个`)
    } catch (error) {
      fail(`${region.displayName} 模型目录: ${errorMessage(error)}`)
    }
  }

  section('3. 用量')
  for (const region of REGIONS) {
    const credential = resolved.get(region.id)
    if (credential === undefined) continue
    try {
      const usage = await fetchUsage(region, credential)
      console.log(`  ${region.displayName}: 读取到用量（字段见 src/host/upstream.ts 的 fetchUsage）`)
      console.log(`    ${JSON.stringify(summarizeUsage(usage)).slice(0, 240)}`)
    } catch (error) {
      fail(`${region.displayName} 用量: ${errorMessage(error)}`)
    }
  }

  section('4. 账号信息（userInfo）')
  for (const region of REGIONS) {
    const credential = resolved.get(region.id)
    if (credential === undefined) continue
    try {
      const info = await fetchUserInfo(region, credential)
      console.log(`  ${region.displayName}: userID=${redact(info.userID)}  name=${redact(info.name)}`)
      if (info.email !== '') console.log(`    email: ${redact(info.email)}`)
    } catch (error) {
      fail(`${region.displayName} userInfo: ${errorMessage(error)}`)
    }
  }

  console.log('\n' + (failures === 0 ? '✓ 全部通过' : `✗ ${failures} 项失败`))
  if (failures > 0) process.exitCode = 1
}

/**
 * A short, printable summary of the usage snapshot, without dumping every
 * field. `fetchUsage` returns a `UsageSnapshot` — the same shape the card's
 * usage panel renders, so this is what a human wants to eyeball.
 */
function summarizeUsage(usage) {
  if (usage === null || typeof usage !== 'object') return { shape: typeof usage }
  const out = {}
  if (typeof usage.userType === 'string' && usage.userType !== '') out.userType = usage.userType
  if (usage.userQuota && typeof usage.userQuota.remaining === 'number') out.userRemaining = usage.userQuota.remaining
  if (usage.addOnQuota && typeof usage.addOnQuota.remaining === 'number') out.addOnRemaining = usage.addOnQuota.remaining
  if (Array.isArray(usage.dedicatedPackages)) out.dedicated = usage.dedicatedPackages.length
  if (Array.isArray(usage.campaigns)) out.campaigns = usage.campaigns.length
  if (usage.checkin && typeof usage.checkin === 'object') {
    out.checkin = `${usage.checkin.enabled === true ? 'enabled' : 'off'} today=${usage.checkin.todayCheckedIn === true ? 'checked' : 'open'}`
  }
  if (usage.isQuotaExceeded === true) out.exceeded = true
  return Object.keys(out).length > 0 ? out : { keys: Object.keys(usage) }
}

/** `describeThrown` is not exported; keep the one-liner this script needs. */
function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}

/**
 * Run only when invoked as a command, never when imported.
 *
 * `await main()` at module scope meant importing this file performed live
 * network probes against the Qoder endpoints — with the user's real credential
 * — as a side effect of the import. A module that reads is one thing; a module
 * whose import talks to a third party is a trap for anything that touches it.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}