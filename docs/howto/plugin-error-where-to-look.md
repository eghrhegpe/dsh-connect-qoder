# 插件报错去哪看（Host 进程 vs Client 进程）

排查这个插件时最常见的一个误区：在浏览器 F12 里找 Host 的报错。找不到——Host 根本不在
浏览器那个进程里。本文钉住两件事：**报错分两个进程、各有各的控制台**；以及**本插件把"失败"
降级成面板数据的真实位置**（注意：形态与姊妹插件 sensenova 不同，别照搬它的措辞）。

## 1. 两半跑在两个进程，控制台是两个地方

| 半边 | 跑在哪 | `console.*` 冒到哪儿 |
|---|---|---|
| **Host**（登录/重登、429 节流、provider 注册、`__save`/目录等本地路由） | Node 服务进程（跑 `dsh web` 的那个终端 / 桌面版主进程） | 该终端的 stdout/stderr，以及 `~/.dsh/logs/startup-*.log`。**永远不进浏览器 F12**。 |
| **Client**（React bundle，Plugins 页卡片） | 浏览器里 | 进 F12。真崩 / 注册失败确实会 `console.error`。 |

Client 侧实锚点（这几条就是会进 F12 的）：

- [`src/client/index.ts:183`](../../src/client/index.ts) —— 卡片槽注册失败（`card slot "..." failed to register (host provider unaffected)`）
- [`src/client/index.ts:192`](../../src/client/index.ts) —— 卡片整体加载失败（`client card failed to load (host provider unaffected)`）
- [`src/client/controller.ts:319`](../../src/client/controller.ts) —— 订阅者回调抛错（`controller subscriber failed`）

> 结论：想调 Host 侧（登录/重登/节流/注册），去跑 `dsh web` 的终端，或 `tail`
> `~/.dsh/logs/startup-*.log`；别在浏览器 F12 里找，那里根本没有 Host 输出。

## 2. 本插件没有"登录落盘 trace"（别按 sensenova 找）

sensenova / agnes 兄弟插件用 `onTrace` 把**每一次登录尝试**落盘成
`$DSH_HOME/logs/agnes-login-*.json`，充当内存环形日志的顶位。

**本仓库没有这套机制。** 全仓库无 `onTrace` / `maskUsername` / `agnes-login` trace；
`~/.dsh/logs/` 里只有宿主的 `startup-*.log`（插件兼容性点名用的启动日志，见
[`host-version-probe.md`](host-version-probe.md)），不含逐次登录尝试落盘。

要对照"浏览器能登、面板不能"这类现象，本插件靠的是 **Host 路由返回值 + 面板渲染决策**，
不是一个 trace 文件——这是两插件的差异，别把 sensenova 的排查路径搬过来。

## 3. 报错是"数据"还是"异常"，取决于走哪条路（这才是本插件真实的形态）

⚠️ **不要把 sensenova 那句"HTTP 永远 200、成败靠 body、从不抛异常"当作本插件不变量。**
本插件不是那样。真实情况分三层：

**① Host 保存路由 `applySettingsSave`（[`src/host/settings-save.ts`](../../src/host/settings-save.ts)）**
——结构性问题回**真 HTTP 状态码**，不是永远 200：

- 字段不在白名单 → `status: 400`（`:187`）
- 命名空间不在 `describe()` 里 → `status: 503`（`:202`）
- 写进去了但**没落盘**（`mutate` 返回后重读、深比较不符） → `status: 200` +
  `body.ok:false` + `errorName:'read-back-mismatch'`（`:230`）
- 真正落盘 → `status: 200` + `body.ok:true`（`:241`）

也就是：**只有"假成功"这一种情况被编码成 `200 + ok:false`**，好让它成为一条可识别的失败而不被吞——
这是红线 1 / [`docs/issues/06`](../issues/06-save-route-and-false-saved.md) 的落点。400/503 仍是真错误码。

**② 客户端 `saveFieldViaHost`（[`src/client/settings-write.ts`](../../src/client/settings-write.ts)）**
——对真 HTTP 错和 `200+ok:false` **都 throw** `QoderSettingsWriteError`（`:81`、`:90`、`:94`）。
本插件在这一步**确实抛异常**，与"从不抛"相反。

**③ controller 捕获 → 降级成面板数据（[`src/client/controller.ts:294`](../../src/client/controller.ts)）**
——`save()` 把上面那个 throw 接住，转成 `lastSave = { ok:false, reason: describeThrown(error) }`。

这才是"报错当数据下发、渲染成面板一行、而不是顺着 React 树炸穿整页"的**真实发生位置**：
在 **controller 的 catch**，不在 HTTP 边界（它不永远 200），也不在"从不 throw"（save 路径确实 throw）。
一次保存失败 = 面板上一行 `lastSave.reason`；不会连带把另外两个 tab 一起崩掉。

> 姊妹插件 sensenova 把同一个意图表达成"always 200 / 错误即数据 / 不抛异常"。那是**它**的具体形态。
> 本仓库的等价不变量是：**"假成功必须变成可识别的失败，且这个失败在 controller 里被降级为面板数据，
> 不外溢成整页崩溃。"** 描述本插件时用后者。

## 4. 实用速查

| 现象 | 看哪 |
|---|---|
| 登录 / 重登 / 429 节流 / provider 注册不对 | 跑 `dsh web` 的终端 stdout + `~/.dsh/logs/startup-*.log`（**不是** F12） |
| 卡片压根没出现 / 整块白屏崩 | 浏览器 F12 console，看 `src/client/index.ts` 那两条 `console.error` |
| 点"保存"没生效 / 提示失败 | **不用看控制台**——读面板上 `lastSave.reason` 那行文案。它来自 `settings-write.ts` 抛出的 `QoderSettingsWriteError`，被 `controller.save()` 捕获降级。 |
| 某 tab 空白 / 额度不刷 / 目录冻结 | Host 路由返回值（`__save` / catalog 刷新），对照 [`issues/04`](../issues/04-empty-catalog-freeze.md)、[`issues/05`](../issues/05-refreshedat-not-truthful.md)、[`issues/06`](../issues/06-save-route-and-false-saved.md) |
