# 门禁：新代码不得再新增"静默失败"分支

**P2 · 规模 S · 依赖 —（可独立落地，越早越好）**

## 症状

这次审计的结论集中在同一个工程习惯上：**宁可能力缺失，不肯报错**。
清单里几乎每条都是它的变体：

| 表现 | 位置 |
|---|---|
| 目录成功刷新为 0 个模型时什么都不做，界面继续显示旧目录 | `lib/index.js:377-386` |
| "已更新（时间）"用响应时刻，刷新失败也照显 | `lib/index.js:848` |
| 端点失败后回退到自读回的快照，显示假"已保存" | `lib/client.js:311-322` |
| 凭据读不出来统一说成"app 在但没登录" | `lib/account-state.js:123` |
| `readItem` / `readJsonSecret` / `loadNewCredential` 全线返回 `undefined` 且无诊断 | `lib/credentials.js:512-543,591-606,693` |
| `zeroOutFile` 把 `statSync` 失败当"文件已不存在" | `lib/credentials.js:431-436` |
| 命名空间不匹配 → 整行从设置页消失，不报错 | `lib/index.js:564` / `lib/settings-save.js:89-92` |
| 上游协议形状变化 → 被当作"排队"重试到预算耗尽 | `lib/upstream.js:1043-1166` |
| 产物被替换成桩 → 套件"少 6 条测试"而不是红 | `test/client-bundle.test.js:49-96` |

## 修法

1. **评审规则**：任何 `return undefined` / 空 `catch` / "失败但继续"的新分支，必须在 PR 里
   写出"调用方如何得知失败"。诊断走已有的 `setCredentialDiagnosticSink` 或结构化事件。
2. **可观测性**：把这条规则落成一条测试——对 `lib/credentials.js`、`lib/catalog-store.js`
   的导出函数做一次"失败注入"，断言至少产生一条上报（现在多数是 0 条）。
3. **卡片**：新增的每条失败路径都要有一个用户可见状态（而不是回落到"看起来正常"）。

## 验收标准

- [ ] 新用例：对凭据层与目录层各注入一次失败，断言上报条数 ≥ 1
- [ ] `CONTRIBUTING` 或 `docs/PLAN.md` 里写明这条评审规则，并在 PR 模板里加一项勾选
- [ ] 后续新增的静默分支在评审中被明确标注（可 grep `catch {}` 与 `return undefined` 抽查）
