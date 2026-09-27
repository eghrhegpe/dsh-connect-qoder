# Issue 草稿

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
| [03-client-bundle-guard.md](03-client-bundle-guard.md) | P0 | 产物被桩不报错（已出过一次事故） |
| [04-empty-catalog-freeze.md](04-empty-catalog-freeze.md) | ~~P0~~ **已修** | 刷新成功但 0 模型时目录冻结 |
| [05-refreshedat-not-truthful.md](05-refreshedat-not-truthful.md) | ~~P0~~ **已修** | "已更新（时间）"在刷新失败时照显 |
| [06-save-route-and-false-saved.md](06-save-route-and-false-saved.md) | P0 | 假"已保存" + 不可达的 503（同一处修复） |
| [07-credential-read-blocks-event-loop.md](07-credential-read-blocks-event-loop.md) | ~~P1~~ **已修**（异步化未做，见文） | 账号路由同步起 PowerShell（上限 30 s） |
| [08-keycache-staleness.md](08-keycache-staleness.md) | ~~P1~~ **已修** | `keyCache` 无失效路径 → 重装后永久 needs-app |
| [09-card-mirrors-host-logic.md](09-card-mirrors-host-logic.md) | P1 | 卡片自算错峰价/窗口标签，与宿主分歧 |
| [10-protocol-drift-probe.md](10-protocol-drift-probe.md) | ~~P1~~ **已修**（分诊落地；6 小时周期探测仍未做） | 上游协议漂移与"没登录"不可区分 |
| [11-coverage-denominator.md](11-coverage-denominator.md) | P2 | 44.7% 的 lib 代码不在覆盖率分母里 |
| [12-small-fixes-batch.md](12-small-fixes-batch.md) | P2 | 12 处小时级小口子（含注释与代码相反） |
| [13-lifecycle-dispose.md](13-lifecycle-dispose.md) | P2 | dispose 两条尾巴（在途刷新、路由未注销） |
| [14-namespace-convergence.md](14-namespace-convergence.md) | P2 | 设置命名空间四套说法 |
| [15-delivery-docs-curation.md](15-delivery-docs-curation.md) | P3 | 交付漂移、文档与事实不符、默认不策展 |
| [16-silent-failure-policy.md](16-silent-failure-policy.md) | P2 | 门禁：新代码不得再新增静默失败分支 |
| [17-client-source-restore.md](17-client-source-restore.md) | P1 | `src/client` 已机械还原（内容等价）；字节一致经实测不可达，产物去留待拍板 |
