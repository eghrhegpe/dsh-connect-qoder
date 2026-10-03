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

- [x] 新用例：dispose 后调用在途刷新 → `catalog.replace` 与 `emit` 都不再发生
- [x] 宿主语义有明确结论，并写进 `lib/index.js` 的注释（"随 fiber 自动注销，无需显式"或反过来）

## 实现（两条都落地；第二条采取"不猜"）

### （a）在途刷新

`doRefreshCatalog` 现在为每次抓取建一个 `AbortController`，dispose 时 `abort()`——
不只是"事后不认这个结果"，而是**真的掐断上游连接**。两层都要，因为二者会竞态：
abort 可能输给一个已经读到的响应。

`isRefreshObsolete`（[`../../src/host/catalog-refresh.ts`](../../src/host/catalog-refresh.ts)）是纯函数，
**成功路径和失败路径都要查**：只查一条是最容易犯的"改一半"——成功路径不查会往磁盘写目录并向
已释放的 fiber `emit`；失败路径不查会在每次禁用/热重载的日志里留下一条无主的警告。
测试用源码断言数检查点个数（`lib/index.js` 不可 import），变异验证删掉失败路径那条即红。

### （b）路由注销：**宿主语义无法确认，故不猜**

原方案第 2 条说"花 1 小时从包源码确认 `register` 是否随 fiber 注销"。**做不到**：
`@deepseek-ai/dsh-host-webserver` 打在宿主的 `app.asar` 里，插件 checkout 读不到。
本机实测过四条路：asar 未解包、profile 的 `node_modules/.pnpm` store 为空（只有 lock.yaml）、
`app.asar.unpacked` 里没有该包、`@deepseek-ai` 下只有 `cosmokit` 与 `schemastery`。

于是改成一个**两种宿主语义下都正确**的写法：把 `register()` 的返回值收集起来，
**只有当它是可调用的**才在 dispose 时调用（[`../../src/host/lifecycle.ts`](../../src/host/lifecycle.ts)）。
随 fiber 回收的宿主会忽略这次多余调用；不随 fiber 回收的宿主则拿到了它原本缺失的注销。

这样处理的关键是**不对看不见的契约下断言**。若宿主将来改变返回值的形状，退化结果是
"不注销"——也就是今天的行为——而不是在 dispose 期间抛异常。

**为什么值得做**：一旦漏了，路由会把 handler 连同整个 runtime 留在可达状态；插件被禁用后
一次 POST 就会新起一个 shim 和一个刷新定时器，而**再也不会有人清理它们**。

**七处 `register` 全部包装**（原 issue 记的是 6 处，现已 7 处），并由
`test/lifecycle.test.js` 逐处断言——新增路由漏包装会当场变红（变异验证过）。释放时单个抛错
不影响其余（那些才持有端口），且 dispose 永不抛异常。

## 后续：provider 注册的回滚也已抽出（PLAN P2-1 第二轮）

本 issue 收的是**路由**注册的注销；重载时**重新发布 provider** 的那条路径原本也有回滚，
同样没测——它是 `activate()` 里的内联闭包，包着十一个可变绑定，只有
`test/account-route-wiring.test.js` 一条正则确认零区域早退还在。现按 `handlers.ts` 同一
手法抽进 `src/host/publish-regions.ts`（`test/publish-regions.test.js` 13 例），回滚的每个
终态都可执行断言。抽取过程查出两个真 bug 并已修：半注册的 adapter 残留无人能释放；
回滚中途再次失败会丢弃刚注册成功的 adapter 的句柄。见 PLAN §P2-1。
