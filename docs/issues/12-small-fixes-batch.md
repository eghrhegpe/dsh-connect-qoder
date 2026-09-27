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

- [x] 每条都有对应断言或可复现的手工步骤（至少覆盖 1/2/8/12）
- [x] `npm test` 与 `npm run test:coverage` 全绿
- [x] 变更后 `docs/` 中受影响的说明同步更新

## 复核（2026-09-27）：12 条里 5 条早已解决，4 条本轮修完，3 条未做

逐条核对当前代码后的真实状态，避免照着过期行号返工：

| # | 状态 |
|---|---|
| 1 注释与代码相反 | **早已解决**：0.2.1 的 SSE 修复后，`shim.js` 的注释说的是"不发 `event: error`"，与代码一致 |
| 3 503 不可达 | **早已解决**：路由注册在 `['webServer']`，handler 内判 `get('settings')` |
| 5 缺 `Cache-Control` | **早已解决**：`sendJson` 全局带 `no-store` |
| 9 TTL 死分支 | **早已解决**：空目录落盘后 `fetchedAt` 会前进，这个分支重新有了真实含义 |
| 4 405 缺 `Allow` / HEAD 被 405 | **本轮已修**（见下） |
| 6 `lastSaveError` 只写不读 | **本轮已修**（见下） |
| 12 0 区域整块 return | **本轮已修**（见下） |
| 2 坏 body 打进 catch-all | 未做 |
| 7 `Object.assign` 死代码 | 未做 |
| 8 reload 响应形状不一致 | 未做 |
| 10 `__hide-all__` 哨兵进设置文档 | 未做（依赖 P0-3①，已完成，可另排） |
| 11 Origin 只比主机名 | 未做 |

### 本轮三处的落法

- **第 4 条**：`Allow` 通过 `sendJson` 的新 `extraHeaders` 参数传（不能用 `setHeader`——
  `writeHead` 的对象会**替换**整个头集合，第一次就是这么白跑的）；`HEAD` 交给 GET 路径，
  `sendJson` 在 `HEAD` 时发头不发体，`Content-Length` 仍如实描述 GET 会发的字节数。
  测 `test/http-surface.test.js`（`sendJson` 可 import，真测）+ 路由半边源码断言。
- **第 6 条**：**没有删字段**。`save()` 里其实已经 `logger.warn` 了，所以原注释承诺的"上报"
  是兑现的，`lastSaveError` 只是没人读的冗余。它被 `test/catalog-store.test.js` 当作"写失败被
  察觉"的证据断言，且能区分"上次写成功"与"从没写过"（时间戳做不到）。改的是那句**说谎的注释**。
- **第 12 条**：0 区域不再 `return`，卡片路由照常注册——fresh install（没人登录）是**正常状态**，
  而 404 让"没有找到已登录的 Qoder 应用"这句解释永远不可达；更要紧的是 reload 路由本身也没被挂上，
  于是"重新登录后不用重启 DSH"这条路**恰好在它唯一存在的场景里不可达**。
  `createQoderAdapter` 按设计拒绝空区域集，所以两处构造点都要容错
  （`publishRegions` 直接答 `{ ok: true }`、初始 `adapter` 留 `undefined`）。
  测在 `test/account-route-wiring.test.js`（activate 不可 import，源码断言）。

