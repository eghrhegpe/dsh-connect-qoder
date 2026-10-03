# 账号路由每次渲染都同步起 PowerShell（上限 30 s），阻塞宿主事件循环

**P1 · 规模 M · 依赖 —**

## 症状

`GET /account` 每次渲染都会同步起一次 PowerShell（`execFileSync`，`timeout: 30000`），
而且**失败不缓存**；`account-state` 还绕过 `CredentialCache` 直调 `loadCredential`。
Qoder 目录存在但 `Local State` 解不开时（正是账号面板要解释的状态），每次打开卡片/切页签
都同步阻塞一次，最坏 30 s × 候选目录数。实测单次**成功**解包也要 0.43–0.69 s。

## 证据

- `src/host/credentials.ts`（`execFileSync` + 30 s 超时）、`326-341`（失败刻意不缓存）
- `src/host/account-state.ts`（直调 `loadCredential`）
- `lib/index.js:1028`（`/account` 每次请求都读状态）

## 修法

1. 失败结果加 30–60 s TTL（成功仍走 `keyCache`）；
2. `/account` 只读缓存：`startRegion` 时已经读过一次凭据，把它缓存下来给面板用；
3. `needs-app` 判定用目录存在性 + 已记录原因，不必再解一次；
4. 中期把 `oscryptKeyFor` 改成 `execFile` + Promise 的异步实现。

## 验收标准

- [x] 新用例：连续 3 次 `/account` 渲染，PowerShell 只被 spawn 一次（注入计数）
- [x] 新用例：解包失败后 60 s 内不重试，超过 TTL 才重试
- [x] 手工验证：解不开的机器上卡片在 200 ms 内渲染出 `needs-app`（由 `cachedOnly` 达成，见下）

## 实现（四条全部落地：第 1、3 条随本 issue，第 4 条异步化随后续一轮做掉，第 2 条按缓存读等价实现）

### 做了什么

1. **失败窗口 60 s**（`failureStillBlocks` + `UNWRAP_FAILURE_TTL_MS`）：失败照样记录原因、
   照样上报诊断，但窗口内不再 spawn 子进程。窗口会**提前结束**的两种情况：`Local State` 被改写
   （重新登录的时刻）、以及 TTL 到期。
2. **渲染路径只读缓存**：`readAccountState(..., { cachedOnly: true })` 走
   `cachedOscryptKeyFor`——只认已缓存且仍对应当前文件的 key，绝不新解。
3. **「重读登录」是真读**（`{ force: true }`）：这是原方案没写到、但**必须**补的一条。若渲染路径的
   缓存规则也套到这里，按钮在失败窗口内会变成空操作——那比它要修的卡顿更糟。两侧模式相反，
   且这个"相反"本身就是断言（`test/account-route-wiring.test.js` 里专门有一条钉住两者不漂移成同一种）。

### 接线层无测试保护（已补，但只补了一半）

`lib/index.js` 有 peer 依赖、测试 import 不了，所以"路由有没有传对标志"这一层原本**完全没有**防护：
实测把 `{ cachedOnly: true }` 删掉，全套件 460 条依然全绿。已加
[`../../test/account-route-wiring.test.js`](../../test/account-route-wiring.test.js) 以源码文本断言
两个调用点（手法与 `test/contract.test.js` 一致），变异验证：删掉渲染路径的标志 1 条红、把 reload
路径也改成缓存 2 条红。

**这仍然不是真测试**：它证明不了 handler 真被调用，只证明它调的那个函数带对了参数。真正的覆盖
要等 `--experimental-test-module-mocks`（KNOWN_GAPS 第 1、2 条）。

### 未做

- ~~**原方案第 4 条（`execFile` 异步化）**~~ **已做**（后续一轮）：`oscryptKeyForAsync` /
  `loadCredentialAsync` / `readAccountStateAsync`，`execFile` 而非 `execFileSync`。
  两版**共用一个 `runUnwrap`**，只有 spawner 不同，所以缓存、失败窗口、临时目录、
  清零这些规则不可能分叉——这一点由 `test/async-unwrap.test.js` 的结构断言守着。
  实测：调用在 **29 ms** 就返回（同步版阻塞 490 ms），期间事件循环跑了 30 次。
  同步版保留给启动时的 sweep 与 `probe/` 脚本（它们不在任何人的延迟预算上）。
- **原方案第 2 条（`/account` 读 `CredentialCache` 的快照）没按原样做**，改成了读 key 缓存。
  区别在于：`CredentialCache` 里是**已交换的凭据**，把它塞进 account payload 会把 token 带到
  浏览器可见的响应边缘——`account-state.js` 的设计前提是"绝不含凭据材料"。读 key 缓存达到了
  同一个性能目的而没有越过那条线。

