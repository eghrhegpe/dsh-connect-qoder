# "已更新（时间）"用的是响应生成时刻，刷新失败也照常显示

**P0 · 规模 S · 依赖 —**

## 症状

payload 里的 `refreshedAt` 取的是响应生成时刻，真实抓取时间 `CatalogStore.fetchedAt` 从不外发；
刷新失败只 warn 后继续。于是**刷新全失败时，卡片照样显示一个崭新的"已更新"时间**。

## 证据

- `lib/index.js:848`：`const now = new Date()` → 传给 `buildModelRowsPayload`
- `lib/catalog-entry.js:157`：`refreshedAt: now.getTime()`
- `lib/index.js:837-847`：刷新失败只 `logger.warn` 后继续
- `lib/catalog-store.js`：真实的 `fetchedAt` 没有任何外发路径

## 修法

外发真实 `fetchedAt`，并加 `lastRefreshFailed` / `lastRefreshError` 标志；
卡片据此显示"上次更新：X 前"或"刷新失败（原因）"。

## 验收标准

- [x] 新用例：刷新抛错后 payload 的 `refreshedAt` **不变**且带失败标志
- [x] 新用例：成功刷新后 `refreshedAt` 前进到真实抓取时刻
- [x] 卡片在失败态不再出现无差别的"已更新"

## 实现（已修，`f8ca26f`）

`buildModelRowsPayload` 现在发 `refreshedAt: oldestFetchedAtOf(runtimes)` 与
`refreshFailures: refreshFailuresOf(runtimes)`（[`../../lib/catalog-entry.js`](../../lib/catalog-entry.js)）。

**取最小值而不是渲染时刻或最新值**：两端模型行要共用一个时间戳时，只有最旧的那个时刻才代表
"屏幕上这些行全都反映到"。取最新会替更旧的一端背书，那之后的失败就看不见了。某一端从未抓取过时
不参与取最小（它没有可贡献的时间戳，也不构成"全都过期"的证据），全都没抓过则**不发这个字段**，
卡片不显示时间，而不是显示一个编出来的。

**浏览器的另一半也得一起改**：卡片此前的兜底是 `typeof value.refreshedAt === "number" ? … : Date.now()`，
主机端改了字段、浏览器端还在编一个 `Date.now()`，issue 05 就只修好了一半。兜底改为 `undefined`，
并新增 `row.refreshStale`（带失败标记的时间戳）与 `row.refreshFailed`（无时间戳时的失败说明），
判定收敛到纯函数 `refreshNoticeKey`（`src/client/card.ts`），可从产物里提取直测
（[`../../test/protocol-shape-card.test.js`](../../test/protocol-shape-card.test.js)）。

**变异验证**：把 `oldestFetchedAtOf(runtimes)` 改回 `now.getTime()`，`test/model-route.test.js` 4 条变红。

