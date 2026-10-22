# Issue 草稿

> **你是带着一个"现象"来的，不是带着编号来的？** 这份索引按**编号与状态**排，
> 对症状没有入口。先去 [`../howto/symptom-triage.md`](../howto/symptom-triage.md)
> —— 那份按界面原文排，能直接落到结论（或落到这里的某个 NN）。

从 [`../PLAN.md`](../PLAN.md) 拆出来的可直接提交的 issue 草稿。优先级与规模见每份文件顶部。

**提交方式**（本机 `gh` 已登录 `eghrhegpe`，仓库即本 fork）：

```sh
# 一次性建标签（已存在会报错，可忽略）
for l in P0 P1 P2 P3; do gh label create "$l" --repo eghrhegpe/dsh-connect-qoder --force; done

# 逐条建 issue
gh issue create --repo eghrhegpe/dsh-connect-qoder --label P0 --title "$(head -1 01-sweep-junction-zeroing.md | sed 's/^# //')" --body-file 01-sweep-junction-zeroing.md
```

| 文件 | 优先级 | 一句话 |
|---|---|---|
| [01-sweep-junction-zeroing.md](01-sweep-junction-zeroing.md) | ~~P0~~ **已修** | sweep 跟随目录联接，把插件目录之外的文件清成 NUL |
| [02-plaintext-key-residue.md](02-plaintext-key-residue.md) | ~~P0~~ **部分修复** | 明文 `key.b64` 残留，回收只靠下次启动（Windows 锁定场景无法截断，见文） |
| [03-client-bundle-guard.md](03-client-bundle-guard.md) | ~~P0~~ **已修** | 产物被桩不报错 → `src/client` 已入库、`build:client` REQUIRED 闸门、CI 新鲜度门禁 + 从产物提取执行的守门（issue 17/19 配套落地） |
| [04-empty-catalog-freeze.md](04-empty-catalog-freeze.md) | ~~P0~~ **已修** | 刷新成功但 0 模型时目录冻结 |
| [05-refreshedat-not-truthful.md](05-refreshedat-not-truthful.md) | ~~P0~~ **已修** | "已更新（时间）"在刷新失败时照显 |
| [06-save-route-and-false-saved.md](06-save-route-and-false-saved.md) | ~~P0~~ **已修** | 假"已保存" + 不可达的 503 → `__save` 只 gate `webServer`，503 可达，回退仅限 legacy 404（`save-route-wiring.test.js` 文本守门） |
| [07-credential-read-blocks-event-loop.md](07-credential-read-blocks-event-loop.md) | ~~P1~~ **已修**（异步化已做：`runUnwrap` + `execFile`，29 ms vs 490 ms 实测） | 账号路由同步起 PowerShell（上限 30 s） |
| [08-keycache-staleness.md](08-keycache-staleness.md) | ~~P1~~ **已修** | `keyCache` 无失效路径 → 重装后永久 needs-app |
| [09-card-mirrors-host-logic.md](09-card-mirrors-host-logic.md) | ~~P1~~ **已修**（错峰为必要重复，已有产物级门禁） | 卡片自算错峰价/窗口标签，与宿主分歧 |
| [10-protocol-drift-probe.md](10-protocol-drift-probe.md) | ~~P1~~ **已修**（chat + usage/campaigns/userinfo 分诊全部落地；6 小时周期探测按"目录刷新已等价"不单做） | 上游协议漂移与"没登录"不可区分 |
| [11-coverage-denominator.md](11-coverage-denominator.md) | ~~P2~~ **大部分已修**（module mocks 实测不可行，改走抽纯模块；`handlers.ts` 与 `publish-regions.ts` 两轮已进分母） | 44.7% 的 lib 代码不在覆盖率分母里 |
| [12-small-fixes-batch.md](12-small-fixes-batch.md) | ~~P2~~ **大部分已修** | 12 处小时级小口子：0.5.0 关 3，后续批次关 8（405/HEAD、Origin 带端口、no-store、`readJsonBodyOr400`、死码、lastSaveError 读取端、reload 形状、0 区域启动）；仅剩 `__hide-all__` 收拢为命名常量 `HIDE_ALL_MODELS` 但仍以哨兵形式存在 |
| [13-lifecycle-dispose.md](13-lifecycle-dispose.md) | ~~P2~~ **已修**（宿主语义无法确认，按两种都对的方式处理） | dispose 两条尾巴（在途刷新、路由未注销） |
| [14-namespace-convergence.md](14-namespace-convergence.md) | ~~P2~~ **大部分已修**（跨 bundle 共享不可行，改为对拍 + 失配显式报错） | 设置命名空间四套说法 → 已收敛为两套（`resolveNamespace` 与 `settingsNamespaceOf` 共享精确候选对，`__save` 候选去重）；`PROVIDER_NS` 现由 `plugin-identity.test.js` 钉在 `cordis.patch.yml` 行 id 上，失配时 `console.error` 显式报错 |
| [15-delivery-docs-curation.md](15-delivery-docs-curation.md) | ~~P3~~ **已结案**（交付漂移检查已于 2026-10-20 删除；当前装法见 [AGENTS.md](../../AGENTS.md)） | 交付漂移、文档与事实不符、默认不策展 |
| [16-silent-failure-policy.md](16-silent-failure-policy.md) | **P2 门禁已落地**（2026-10-17） | 门禁：新代码不得再新增静默失败分支——`test/failure-reporting.test.js`（凭据层/目录层各注入一次失败、断言 ≥1 条上报）+ `docs/PLAN.md` P2-5 规则 + `.github/pull_request_template.md` 勾选 |
| [17-client-source-restore.md](17-client-source-restore.md) | ~~P1~~ **已修**（产物去留已由 19 拍板：`lib/` 入库 + CI 新鲜度门禁） | `src/client` 已机械还原（内容等价）；字节一致经实测不可达——这不是未决项，19 已替它决策 |
| [18-account-expired-link-no-context.md](18-account-expired-link-no-context.md) | ~~P2~~ **已修** | 账号失效提示裸链接跳官网无说明 → 已改为「先提示客户端重登/下载 + 带说明的下载链接」（issue 文件即验收基线） |
| [19-lib-committed-github-install.md](19-lib-committed-github-install.md) | **P2 已决策** | `github:` 源安装缺 `lib/` 静默失效 → `lib/` 改回受版本管理 + CI 新鲜度门禁（pnpm 11 allowBuilds 审批流证据链） |
| [20-llm-handoff-detached.md](20-llm-handoff-detached.md) | ~~P0~~ **已修** | `llm` 方法以裸引用交出、`this` 丢失 → provider 注册失败短路 activate，七条卡片路由全 404（`src` 已修、`lib/` 过期未重建；接线改箭头包裹 + `this:` 类型守卫 + `host-handoff-binding.test.js` 产物级守门；失败不再回退、改由 always-mounted `/status` 报告） |
| [21-device-login-credential-source.md](21-device-login-credential-source.md) | P2 | 设备登录作第三个凭据来源：两区闭环已实测（登录/目录/刷新均成立），缺的是接进 host + 自有 vault；含刷新信封少 `user_id` 的坑与 RMW 竞态教训；**改「三条事实」第 2 条需用户同意** |
| [22-upstream-split.md](22-upstream-split.md) | ~~P2~~ **已修** | 2,335 行的 `upstream.ts` 已拆成 11 个叶模块（`src/host/upstream/`）+ 25 行门面：12 测试 + 5 probe + 3 importer 一行不改（只同步了注释里的旧路径）；四条顺带整改全核销——死导出 `fetchCampaigns` 已删、双 Retry-After 解析器收敛到 `errors.ts`、`readUmidInfo` 改调 `normalizeUmidBlock`、`fetchUsage` 吞错改为快照可见的 `campaignsError`（带 `test/usage-campaigns-error.test.js`） |
| [23-upstream-429-daily-limit.md](23-upstream-429-daily-limit.md) | ~~P1~~ **已修** | 上游把「每日额度用完」换成 HTTP 429 后，插件先判状态后读 body → 跑满 120 s / 12 次；宿主再按 `RATE_LIMIT` 叠 5 次。修法：body 分类提到 429/5xx 分支之前 + 文案带宿主认得的 `quota exhausted`；带 3 个 stub 测试、1 个变异验证与 1 个宿主契约漂移探针 |
| [24-terminal-failure-status-codes.md](24-terminal-failure-status-codes.md) | **P2 已修** | 23 的顺带：把每种失败都喂给宿主自己的分类器 → shim 对一切非队列/非额度失败一律回 502 → 宿主判 `SERVER` → 终态判决（协议形状漂移、"请更新插件"、首帧登录过期）被白重试 5 次；队列预算 × 宿主重试最长 ~12 min。**修复**：`src/host/route-retry-policy.ts` 把本路由的策略收窄为 `EMPTY_RESPONSE/TIMEOUT/TRANSPORT`（代价：网络抖动也失去宿主兜底），探针 [3]/[4] 段与 `test/route-retry-policy.test.js` 钉住；§4 也已修：非 chat 路径改抛 `UpstreamRefusalError`（`classifyHttpRefusal` 先读 body 的 code、消息文本逐条未变），`daily-limit` 会点亮 usage 的 `markExhausted` 徽标，卡片新增 `row.refreshDailyLimit`/`row.refreshDailyLimitStale`/`usage.dailyLimit` 三段文案。矩阵由 `probe/host-retry-classification-probe.mjs` 的 [4] 段从宿主源码实时求值 |
| [25-new-model-marker.md](25-new-model-marker.md) | **P3 已实现**（2026-10-22） | 新模型标记：额度胶囊挂 `· N 新模型`。上游目录没有「上架时间」，所以口径是「本机首次见到」而非「网关新增」；每区域一份 `.qoder-roster-seen.<region>.json`，7 天窗口、首次写入只播种不宣布、离开名册即遗忘、超 200 条形状漂移不写不报；写在 refresh 提交路径上（`GET /models` 仍是纯读），带 `test/roster-seen-store.test.js` 与胶囊 DOM 帧 |
