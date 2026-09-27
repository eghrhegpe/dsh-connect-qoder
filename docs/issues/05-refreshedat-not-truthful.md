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

- [ ] 新用例：刷新抛错后 payload 的 `refreshedAt` **不变**且带失败标志
- [ ] 新用例：成功刷新后 `refreshedAt` 前进到真实抓取时刻
- [ ] 卡片在失败态不再出现无差别的"已更新"
