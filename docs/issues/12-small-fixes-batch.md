# 批量小修：12 处小时级口子（含注释与代码相反）

**P2 · 规模 S（一个 PR 清掉）· 依赖 —（其中 503 那条随 #06）**

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| 1 | `lib/shim.js:397-399` vs `423` | 注释说"绝不发 `[DONE]`"，代码在错误分支就发了 `data: [DONE]` | 二选一并补断言（注：`grep` 过，错误分支确实走到 423 行） |
| 2 | `lib/index.js:1053`、`1092` | `readJsonBody` 的坏 body 打进 catch-all → 裸 400 无 body | 包 try → 400 + `errorName`，与 `__save` 一致 |
| 3 | `lib/index.js:884-887` | 503 分支不可达 | 随 #06 |
| 4 | `lib/index.js:826/882/939/1041/1051/1090` | 405 缺 `Allow`；HEAD 也被 405 | 补 `Allow`，HEAD 交给 GET 路径 |
| 5 | `lib/index.js:229-233` | 响应无 `Cache-Control` | 卡片内部端点补 `no-store` |
| 6 | `lib/catalog-store.js:36-37,63,75` | `lastSaveError` 只写不读（注释承诺"so a caller can report it"） | 删掉或真的上报 |
| 7 | `lib/index.js:910` | `Object.assign(preferences, …)` 被 live source 覆盖（死代码） | 删掉，或让 `current()` 真的合并它 |
| 8 | `lib/index.js:1022-1033` vs `1081-1082` | reload 响应形状与 GET 不一致，卡片还不用它 | 统一形状，去掉多余的一次 GET |
| 9 | `lib/index.js:368` | TTL 分支 `refreshCatalog(false)` 无调用者 | 随 #04 |
| 10 | `lib/client.js:528` | `__hide-all__` 哨兵作为合法值写进设置文档 | 用显式字段/null 表达"全隐藏"（随 #03① 一起） |
| 11 | `lib/index.js:272-282` | 缺 Origin 即放行；Origin 只比主机名不比端口 | 至少写进文档；设置写路由可加一次性 token |
| 12 | `lib/index.js:608-611` | 0 区域启动时整块 return → "没登录"文案不可达，用户看到 404 | 路由照常注册，回答"无区域可用" |

## 验收标准

- [ ] 每条都有对应断言或可复现的手工步骤（至少覆盖 1/2/8/12）
- [ ] `npm test` 与 `npm run test:coverage` 全绿
- [ ] 变更后 `docs/` 中受影响的说明同步更新
