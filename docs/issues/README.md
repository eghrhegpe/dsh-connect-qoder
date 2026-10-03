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
| [10-protocol-drift-probe.md](10-protocol-drift-probe.md) | ~~P1~~ **已修**（分诊落地；6 小时周期探测仍未做） | 上游协议漂移与"没登录"不可区分 |
| [11-coverage-denominator.md](11-coverage-denominator.md) | ~~P2~~ **大部分已修**（module mocks 实测不可行，改走抽纯模块；`handlers.ts` 与 `publish-regions.ts` 两轮已进分母） | 44.7% 的 lib 代码不在覆盖率分母里 |
| [12-small-fixes-batch.md](12-small-fixes-batch.md) | ~~P2~~ **大部分已修** | 12 处小时级小口子：0.5.0 关 3，后续批次关 8（405/HEAD、Origin 带端口、no-store、`readJsonBodyOr400`、死码、lastSaveError 读取端、reload 形状、0 区域启动）；仅剩 `__hide-all__` 收拢为命名常量 `HIDE_ALL_MODELS` 但仍以哨兵形式存在 |
| [13-lifecycle-dispose.md](13-lifecycle-dispose.md) | ~~P2~~ **已修**（宿主语义无法确认，按两种都对的方式处理） | dispose 两条尾巴（在途刷新、路由未注销） |
| [14-namespace-convergence.md](14-namespace-convergence.md) | ~~P2~~ **大部分已修**（跨 bundle 共享不可行，改为对拍 + 失配显式报错） | 设置命名空间四套说法 → 已收敛为两套（`resolveNamespace` 与 `settingsNamespaceOf` 共享精确候选对，`__save` 候选去重）；`PROVIDER_NS` 现由 `plugin-identity.test.js` 钉在 `cordis.patch.yml` 行 id 上，失配时 `console.error` 显式报错 |
| [15-delivery-docs-curation.md](15-delivery-docs-curation.md) | P3 | 交付漂移、文档与事实不符、默认不策展 |
| [16-silent-failure-policy.md](16-silent-failure-policy.md) | P2 | 门禁：新代码不得再新增静默失败分支 |
| [17-client-source-restore.md](17-client-source-restore.md) | ~~P1~~ **已修**（产物去留已由 19 拍板：`lib/` 入库 + CI 新鲜度门禁） | `src/client` 已机械还原（内容等价）；字节一致经实测不可达——这不是未决项，19 已替它决策 |
| [18-account-expired-link-no-context.md](18-account-expired-link-no-context.md) | ~~P2~~ **已修** | 账号失效提示裸链接跳官网无说明 → 已改为「先提示客户端重登/下载 + 带说明的下载链接」（issue 文件即验收基线） |
| [19-lib-committed-github-install.md](19-lib-committed-github-install.md) | **P2 已决策** | `github:` 源安装缺 `lib/` 静默失效 → `lib/` 改回受版本管理 + CI 新鲜度门禁（pnpm 11 allowBuilds 审批流证据链） |
| [20-llm-handoff-detached.md](20-llm-handoff-detached.md) | ~~P0~~ **已修** | `llm` 方法以裸引用交出、`this` 丢失 → provider 注册失败短路 activate，七条卡片路由全 404（`src` 已修、`lib/` 过期未重建；接线改箭头包裹 + `this:` 类型守卫 + `host-handoff-binding.test.js` 产物级守门） |
