# dispose 的两条尾巴：在途刷新与未注销的路由

**P2 · 规模 M · 依赖 需先确认宿主 `webServer.register` 语义**

## 症状

**（a）在途刷新不被取消**：`doRefreshCatalog` 没有 AbortController，`disposed` 只在
`beginCatalogUpdates` 的 `.then` 里被检查——只挡住"装新定时器"，挡不住 dispose 之后
仍然 `catalog.replace()`（落盘）并向已释放的 fiber `emit('llm/adapters-updated')`。

**（b）路由没有注销路径**：所有 `webServer.register()` 的返回值被丢弃。若宿主不按 fiber 回收注册，
dispose 之后再 POST `account/reload` 会**再起一个 shim + 一个 interval**，而 cleanup 已经跑完 → 永久泄漏。

## 证据

- `lib/index.js:738-754`（cleanup：定时器与 shim 都收了，但没 abort 在途刷新、没注销路由）
- `lib/index.js:367-387`（`doRefreshCatalog` 无 signal）
- `lib/index.js:1158-1165`（`disposed` 检查只在装定时器处）
- `lib/index.js:820-1138`（6 条路由的 register 返回值全部丢弃）
- 宿主语义**未能确认**（本机 asar 路径不可读）

## 修法

1. 刷新加 AbortController，cleanup 里 abort，并在 `catalog.replace` / `invalidate` 前再查一次 `disposed`；
2. 花 1 小时从 `@deepseek-ai/dsh-host-webserver` 的包源码确认 `register` 是否随 fiber 注销；
   需要的话保存返回值并在 cleanup 里调用。

## 验收标准

- [ ] 新用例：dispose 后调用在途刷新 → `catalog.replace` 与 `emit` 都不再发生
- [ ] 宿主语义有明确结论，并写进 `lib/index.js` 的注释（"随 fiber 自动注销，无需显式"或反过来）
