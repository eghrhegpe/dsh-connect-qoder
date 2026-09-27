# 覆盖率把三个大文件排除在分母之外（44.7% 的 lib 不受约束）

**P2 · 规模 L · 依赖 —（#12、#13 的护栏）**

## 症状

`lib/adapter.js`（239 行）、`lib/client.js`（2004 行）、`lib/index.js`（1166 行）**从未被 import**，
因此不在覆盖率报告里——**3409 / 7626 行 = 44.7% 的 lib 代码不受阈值约束**。
`upstream.js` 行覆盖 49.93% / 函数 38.89%（SSE 主循环、目录抓取整段未覆盖）；
`credentials.js` 的整条 PowerShell+DPAPI 链路 0%；`shim.js` 请求主段 0%。

另外 `docs/KNOWN_GAPS.md:171-173` 的基线数字已过期（branches 写 87.38，实测 86.37；
functions 写 69.51，实测 72.62），把安全垫夸大了约 43%。

## 证据

- `npm run test:coverage` 报告里没有 `adapter.js` / `client.js` / `index.js` 三行
- `docs/KNOWN_GAPS.md:19-62`（自己登记了这两条缺口的方案）

## 修法

采用 `docs/KNOWN_GAPS.md:39-62` 已给的两种方案之一：`--experimental-test-module-mocks` 桩掉
`@deepseek-ai/*` 与 pi-ai；或把路由 handler 抽成 `(req, deps) => result` 纯函数
（`applySettingsSave` 已证明可行）。顺带把凭据层的零覆盖缺口登记进 KNOWN_GAPS。

## 验收标准

- [ ] `lib/index.js`、`lib/adapter.js` 出现在覆盖率报告里（分母变大是好事）
- [ ] 至少 6 条路由有直接断言（method / 鉴权 / 错误码 / body 上限）
- [ ] 门槛与 KNOWN_GAPS 的数字按实测重新标定
