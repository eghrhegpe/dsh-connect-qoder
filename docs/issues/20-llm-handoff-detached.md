# `llm` 方法以裸引用交出去，`this` 丢失把整张卡片打成 404

**P0 · 规模 M · 依赖 —**

## 症状

独立 `dsh` 宿主（0.2.0-rc.1）上，`/plugins/dsh-connect-qoder/{models,usage,account,checkin}` 全部 **404**；
客户端卡片渲染出骨架但三条数据全报 `读取失败 (HTTP 404)`。宿主本身正常启动、无报错、无降级提示。
同机桌面端宿主跑 v0.4.4 全部 200 —— 同一个 `~/.dsh`、同一份设置。

## 证据

- `~/.dsh/logs/startup-*.log`：`dsh-connect-qoder: provider registration failed`，栈底
  `at Object.registerAdapter (…/@deepseek-ai/dsh-llm/lib/index.js:1836:29)`，错误
  `Cannot read properties of undefined (reading 'effect')`；随后 `activate` 在
  `lib/index.js:7531` 提前 `return`，`inject(['webServer'])` 的路由注册（`lib/index.js:7559`）从未执行。
- `lib/index.js:7507-7508`（事发时）：`registerAdapter: ctx.llm.registerAdapter` / `registerConfigurableProviders: ctx.llm.registerConfigurableProviders`
  —— 裸方法引用。`dsh-llm` 的 `registerAdapter` 是 `this`-bound（开头 `this.ctx.effect(…)`），
  在 `publishRegions` 里以 `deps.registerAdapter(…)` 调用时 `this === deps`，`this.ctx` 为 `undefined`。
- 两处 loopback shim 端口在宿主进程上已监听（`startRegion` 已完成），catalog 也在，唯独路由 404
  —— 排除了"region 没起来"，把范围收敛到"路由注册被 publishRegions 失败短路"。
- 本地复现：用真 cordis `Context` + `ctx.provide('webServer'|'settings'|'llm', …)` 调 `apply()`；
  `ctx.llm` 缺 `registerAdapter` 时 7 条路由全部不注册、`apply` 正常返回（错误被吞）；补上可用的
  `registerAdapter` 后 7 条路由全部注册。与宿主症状逐一对应。

## 根因

两件事叠加，缺一都不会出这次事故：

1. **接线丢了接收者**：把宿主 `this`-bound 方法抽成裸引用再放进 deps 对象，调用时 `this` 变成 deps。
2. **失败把卡片一起带走**：`activate()` 里 `publishRegions$1()` 返回 `ok !== true` 时 `await …close()` 后
   **提前 `return`**，卡片路由（`ctx.inject(['webServer'])`）在它之后，于是一处 provider 注册失败
   → 七条卡片路由全 404。这违反本插件"激活 best-effort、失败不得拖垮 profile"的自述，
   也让用户失去**看到失败原因**的入口（账号/用量/模型页本来是诊断面）。

## 修法

1. **接线**：`registerAdapter: (providerIds, adapter) => ctx.llm.registerAdapter(providerIds, adapter)`，
   `registerConfigurableProviders` 同理 —— 用箭头包裹在 `ctx.llm` 上做方法调用，接收者不丢。
2. **类型守卫**：`HostContext['llm']` 的两个方法声明加 `this: HostContext['llm']`（不是 `this: void`，
   void 接收者从任何东西都可赋值，等于没拦）。裸引用现在过不了 `tsc`（TS2684）。
3. **产物门禁**：新增 `test/host-handoff-binding.test.js`，读 `lib/index.js` 断言**既不含裸引用形式、
   也含箭头形式**。之所以读产物不读 src：这次 src 早已修对，**坏的只是过期的 `lib/`**，
   只测 src 会给出全绿的假象（同 `client-bundle.test.js` 的理由）。

## 验收标准

- [x] 独立 `dsh` 0.2.0-rc.1 宿主重启后 `/{models,usage,account}` 均 **200**，models 返回真实 roster
- [x] `test/host-handoff-binding.test.js` 绿；把 `lib/index.js` 改回 `registerAdapter: ctx.llm.registerAdapter`
      该测试变红
- [x] `npm run typecheck` 通过（`this:` 守卫生效）
- [x] （已关闭）`publishRegions` 失败不再短路卡片路由：失败改为**记录而非回退**，卡片路由照常挂载，
      并提供 always-mounted `/plugins/dsh-connect-qoder/status` 让"宿主没有这条路由"与"插件激活失败"
      可区分。守门：`test/activation-gate-decoupling.test.js`（断言失败分支内无 `return`/`throw`，
      变异验证过）+ `test/status-route.test.js`（实测 handler；错误只发布 `name`、不发布 message，
      message 可能带凭据 URL，留在宿主日志）

## 教训

"类型守卫 + 单测"不能代替"重建产物"。`src` 修对了、`lib/` 是旧构建，运行时照样崩；
而 `npm run build` 不跑 `tsc`，所以 `this:` 守卫再准也拦不住一次漏构建。
`lib/` 是受版本管理产物（issue 19），任何 `src` 改动都必须 `npm run build` 并**同一次提交** `lib/`。