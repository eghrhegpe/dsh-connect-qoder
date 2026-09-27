# 账号路由每次渲染都同步起 PowerShell（上限 30 s），阻塞宿主事件循环

**P1 · 规模 M · 依赖 —**

## 症状

`GET /account` 每次渲染都会同步起一次 PowerShell（`execFileSync`，`timeout: 30000`），
而且**失败不缓存**；`account-state` 还绕过 `CredentialCache` 直调 `loadCredential`。
Qoder 目录存在但 `Local State` 解不开时（正是账号面板要解释的状态），每次打开卡片/切页签
都同步阻塞一次，最坏 30 s × 候选目录数。实测单次**成功**解包也要 0.43–0.69 s。

## 证据

- `lib/credentials.js:272-281`（`execFileSync` + 30 s 超时）、`326-341`（失败刻意不缓存）
- `lib/account-state.js:89`（直调 `loadCredential`）
- `lib/index.js:1028`（`/account` 每次请求都读状态）

## 修法

1. 失败结果加 30–60 s TTL（成功仍走 `keyCache`）；
2. `/account` 只读缓存：`startRegion` 时已经读过一次凭据，把它缓存下来给面板用；
3. `needs-app` 判定用目录存在性 + 已记录原因，不必再解一次；
4. 中期把 `oscryptKeyFor` 改成 `execFile` + Promise 的异步实现。

## 验收标准

- [ ] 新用例：连续 3 次 `/account` 渲染，PowerShell 只被 spawn 一次（注入计数）
- [ ] 新用例：解包失败后 60 s 内不重试，超过 TTL 才重试
- [ ] 手工验证：解不开的机器上卡片在 200 ms 内渲染出 `needs-app`
