# 已知覆盖缺口

这份文件登记**明确知道没有测试保护**的地方。每条都写清「为什么现在没有」和
「要补上它需要先做什么」，这样缺口是待办，不是旁白。

新增测试时请顺手更新本文件；删掉一条时请在提交信息里说明它为什么不再成立。

**最近一次复核**：已解决 5 条（凭据缓存链路、目录落盘、设置读回校验、CLI 入口、
`toPiModel` 抽离），仍存在 3 条，其中 2 条是原理上不可测而非尚未动手。

**凭据 sweep 的身份守卫（issue 01）**：`sweepStaleOscryptDirs` 现在要求
`lstat` 判真目录 + `.dsh-oscrypt` 标记文件 + `key.b64` 恰好解出 32 字节，
三道闸全部由 `test/credential-cleanup.test.js` 的新用例守着，且两道守卫各自
独立经手工变异验证承重（改回 `statSync` → junction 用例红；删 marker 检查 →
4 条红）。sweep 与 `zeroOutFile` 里剩下的手工"实测全绿"条目不变。

**第 3 条已部分解决**：客户端门控此前只由手抄副本守着，实测**抓不住任何东西**——
从 `lib/client.js` 删掉那行 `promo.active !== true`（正是阻止卡片显示拿不到的折扣价
的那一行），`model-row.test.js` 依然 9 pass / 0 fail。现已增加
`test/client-bundle.test.js`，直接从产物文本里提取 `offPeakState` 及其依赖并执行，
同一个变异会让它 3 条变红。根治仍取决于 `src/client/*.ts` 入库。

---

## 1. `adapter.js` 的 Cordis 接线与 profile 构造

**位置**：`lib/adapter.js`

**为什么没测**：模块顶层 import `@earendil-works/pi-ai` 与
`@deepseek-ai/dsh-llm-pi-ai`，本仓库不安装 peer 依赖。

**已经测到哪一步**：`toPiModel` 原先住在这里，是整个插件最关键也最无防护的函数——
它那行 `compat: { supportsDeveloperRole: false }` 决定了每个请求会不会被 403
`10605` 拒绝，而「故意不声明 `maxTokens`」决定了长推理回复会不会被截断成
`finish: max-tokens`。两处此前都只有注释守着。现已抽出到 `lib/pi-model.js`
（纯函数、不碰任何 pi-ai API）并由 `test/pi-model.test.js` 覆盖；
它消费的 `rateNow` / `offPeakActive` / `offPeakRemaining` 早前已移到
`lib/offpeak.js` 并被完整覆盖。

**剩下的**：`createQoderAdapter` 组装 `PiAiAdapter` profile 的那部分——provider
注册、inert 认证平面、per-build 读设置（`preferMaximumContext` / `imageModeFor` /
`enabledIdsFor`）以免改设置要重注册 adapter。这部分是接线，没有可断言的纯逻辑，
留在原地是因为抽它出来只会造出一个只被调用一次的间接层。

**要补上需要**：`node --experimental-test-module-mocks` 桩掉 pi-ai 与
`@deepseek-ai/*`（已验证可行：桩掉三个 `@deepseek-ai/*` 之后 `lib/index.js`
可以被 import）。这要在 test script 上加 flag，且只在需要时开启。

---

## 2. `RegionRuntime` 本身与 `activate` 的 Cordis 接线

**位置**：`lib/index.js`（约 800 行）

**为什么没测**：模块顶层 import 四个 `@deepseek-ai/*` peer 包，本仓库不安装。

**已经测到哪一步**：这个文件里所有**纯逻辑**都已经搬出去了——
凭据缓存（`lib/credential-cache.js`）、目录落盘（`lib/catalog-store.js`）、
设置写入与读回（`lib/settings-save.js`）、行投影与过滤（`lib/catalog-entry.js`）。
留下的只有 HTTP 路由的收发、provider 注册、以及 dispose 时的定时器清理。

**剩下的风险**：`ctx.inject(['webServer'])` 里的路由注册本身（路径、method 校验、
64 KiB body 上限）；`ctx.effect` 的 dispose 时序（定时器与在途 `refreshCatalog`
的竞态）；`registerAdapter` 失败时的回滚是否真的释放了 shim 端口。

**要补上需要**：`--experimental-test-module-mocks` 加一套 Cordis 桩，
或把每条路由的 handler 抽成 `(req, deps) => result` 的纯函数。
后者与 `applySettingsSave` 是同一套路，已经证明可行。

---

## 3. 客户端卡片的门控表达式

**状态**：**已知的、刻意接受的镜像**，而且现在是**两个**。

1. `test/model-row.test.js` 的 `cardInstallsClock` 复刻了卡片 bundle 中的
   `models.some((m) => m.promotion?.active === true)`。
2. 同文件的 `cardRendersOffPeak`（连同 `cardParseClock` / `cardLocalSecondsOf`）
   复刻了 `offPeakState` 的**完整**判定——守卫加窗口算术——用来钉住卡片的错峰
   门控与 host 端 `isOffPeakActive` 永远一致。

**为什么无法 import**：卡片是浏览器 bundle，由 5 个从不提交的 TypeScript 源文件
构建（`src/client/{paths,styles,settings-write,copy,index}.ts`）。仓库里没有任何
构建配置能重新生成 `lib/client.js`。

**同步约束**：卡片里那两条表达式一旦改写，测试里的副本必须一起改，否则测试会在断言
一条没人实现的规则的同时保持绿色。

**已经因此漏掉过一次**：`offPeakState` 原先只看窗口字段、不看 `promotion.active`，
于是 Qoder 已下线但仍保留窗口字段的促销被按**折扣价**渲染——用户看到一个自己
并不被收取的价格，而同一目录条目在模型选择器里经 `rateNow` 算出的却是
`before` 价，两个界面自相矛盾。触发条件是目录里同时存在两种状态的模型：
只要有任一模型 `active === true`，每秒时钟就会装上，此后**所有**行都走这条门控。
修复是给 `offPeakState` 补上 `promo.active !== true` 的守卫（`lib/client.js`），
并由 `cardRendersOffPeak` 与 host 端逐状态对拍。已用变异验证：抽掉守卫，
`model-row.test.js` 3 条变红。

这与本仓库其他测试曾犯的错是同一类（手抄副本），之所以接受，是因为
「完全不覆盖」比「覆盖一个可能过期的副本」更糟——这两个 bug 都恰恰是在那一层
发生的。

**根治办法**：把 `src/client/*.ts` 纳入仓库，让 `lib/client.js` 成为可复现的构建
产物。这是本文件里价值最高的一条待办，但工作量也最大。在此之前，**往卡片上加
任何 UI 判定逻辑之前，先想清楚它的 host 端对应物是什么**——两个界面算同一个数，
就必须有两处测试。

---

## 4. 协议层的两个原理盲区

**位置**：`lib/upstream.js` 的 `authHeaders`

**为什么测不了**（已实测确认，不是推测）：

1. **RSA 填充模式**。Node 的 `publicEncrypt` 返回裸 RSA 结果，PKCS#1 v1.5 的
   framing（`0x00 0x02 PS 0x00 M`）不出现在密文里。1024 位密钥下 PKCS#1 与 OAEP
   都是 128 字节，差异只在永不暴露的 padding 串中。把 `authHeaders` 改成 OAEP，
   `upstream-protocol.test.js` 全绿。
2. **AES key 的随机性**。RSA padding 是随机的，所以常量化的 AES key 每次仍会
   产生不同的 `Cosy-Key`。「key 每次不同」这条断言对常量 key 同样成立。

**能测的都已测**：key 尺寸（RSA-1024 包装 128 字节）、`info` 必须是 16 字节对齐
的 AES 密文且不含明文身份、签名覆盖的输入与顺序、`/algo` 前缀剥离、编码的双射性。

**要真正覆盖需要**：网关的私钥，或一份可对照的真实网关响应样本。有了样本，
第 1 条立刻可测（用样本里已知的明文/密文对验证 padding 行为）；第 2 条仍然不可测，
因为它关乎的是**本端**是否每次生成新 key，而这只能靠审查代码而非测试来保证。

---

## 5. 两条「不可约」的等价路径

这两处不是没写测试，是**写了也测不到**，因为两条代码路径产生完全相同的可观察行为。

### 5a. `decryptOscrypt` 的长度守卫

`blob.length < 3 + 12 + 16` 这个显式检查，与「短 blob 让 `createDecipheriv` 在
截断的 nonce 上抛错、被 `catch` 吞掉」都返回 `undefined`，从外部无法区分。
实测：删掉守卫，`oscrypt.test.js` 全绿。

守卫本身是对的（避免在每次启动的热点路径上抛异常）。**不建议**为了可测性而删除它。

### 5b. `CredentialCache.resolve` 的「无凭据」分支

`if (credential === undefined) { this.cached = undefined; return undefined }` 里的
那行 `this.cached = undefined` 可以删掉而不改变任何可观察行为——因为
`isCredentialUsable(undefined)` 已经是 `false`，下一次 resolve 无论如何都会重读。
实测：删掉该行，`credential-cache.test.js` 全绿。

保留它是为了可读性：显式清空比依赖「undefined 恰好不可用」更清楚。

### 5c. `preferences.js` 的 `Object.hasOwn` 守卫

`enabledIdsFor` / `imageModeFor` 用 `Object.hasOwn` 拒绝原型链上的键。但
`Object.prototype` 上的值是函数或对象，`Array.isArray` 和模式白名单本来就拒绝它们，
所以删掉 `hasOwn` 之后行为完全相同。实测：删掉两处 `hasOwn`，
`preferences.test.js` 全绿。

保留它是因为这个保证不该依赖 `Object.prototype` 的当前内容——某些 polyfill 会往
`Object.prototype` 上加属性，那时过滤规则就可能放行。这是防御性加固，不是可观测行为。

---

## 6. 跨平台凭据链未实现（macOS / Linux）

**位置**：`lib/credentials.js`（OS keystore 封装、app user-data 根目录）、
`lib/account-state.js`（`appDataRoot` 注入）、`lib/upstream.js`（`MACHINE_OS` darwin 回落）

**为什么现在没有**：Qoder 桌面版已经在 macOS 12+ / Linux (.deb/.rpm) / HarmonyOS 上有
下载，但本插件只实现了 Windows 这一条解密链。当前状态：

1. **OS keystore 封装**：Windows 走 PowerShell + DPAPI（`Crypt32.dll`），macOS 需 Keychain
   （`security`，Chromium Safe Storage service 名），Linux 需 libsecret（`secret-tool`）或
   Chromium 在 Linux 上 `peanuts` 硬编码 key 兜底。
2. **应用 user-data 根目录**：当前代码把 `process.env.APPDATA` 当作 app 目录所在，macOS 上
   应是 `~/Library/Application Support`，Linux 上是 `~/.config`（或 `XDG_CONFIG_HOME`）。
3. **`MACHINE_OS` 在 darwin 上回落成 `x86_64_linux`**（`lib/upstream.js:144-151`）：网关按
   此字段路由/校验，darwin 实机需要 `aarch64_darwin` / `x86_64_darwin` 一档。
4. **跨平台 CI 与实机验证**：GitHub Actions 的 macos / ubuntu runner 可以编译并跑单测，但
   Keychain 弹窗、签名打包、`secret-tool` 的 D-Bus session 都得在实机或 runner 上验。

**要补上需要**：

- 前三项是**纯工作量**（三套 keystore 封装 + 平台切换 + `MACHINE_OS` 加一档），无原理障碍。
- 第四项决定是否敢作为"正式支持"发布：提交的是"盲代码"还是"已验代码"。
- 在此之前，macOS / Linux 用户只能走 PAT 兜底（`QODER_PAT` / `QODERCN_PAT`），或自行
  从本仓库移植。

**影响面**：所有 macOS / Linux 上的 Qoder 桌面端用户，「零配置读应用凭据」的卖点在那些
平台上不存在；README 的「平台边界」段已同步说明。

---

## 7. 仍未建立的东西

这些不是「某处没测」，而是整个仓库层面的缺失：

- **没有变异测试 harness**。本文件里每一条「实测全绿」都是手工跑出来的
  （逐个改坏、跑测试、看是否变红、还原）。没有 `mutmut` 之类的工具把它们变成
  持续的门禁，所以下一个改动可能悄悄重新引入其中一条。
  注：两处最要害的变异现在**已经由静态断言守住**——`test/client-bundle.test.js`
  钉住 bundle 文本里的 `promo.active !== true`，`test/pi-model.test.js` 钉住
  `compat.supportsDeveloperRole === false`，破坏它们各自都会变红；其余「实测全绿」
  的条目（5a–5c）仍是手工的。
- **覆盖率门槛已建立**（本条的前两版登记「没有阈值」，现已不成立）：
  `npm run test:coverage` 带 `--test-coverage-lines=68 --test-coverage-branches=85
  --test-coverage-functions=66`，CI 直接失败于跌破门槛（当前实测 73.64 / 86.90 /
  72.63）。门槛是**地板不是分数**：它防的是悄悄丢覆盖，守不住的仍是「哪些具体回归
  被挡住」——那还得看本文件。
- **`verify:bundle` 有一处已知的时钟脆弱性**（本次改凭据 sweep 时撞上并定位，非本次
  引入）：`offPeakState` / `rateAt` / `withDate` 读墙上时钟，脚本先 `load(OLD)` 再
  `load(NEW)` 逐条对拍，两次指纹相隔毫秒；若其间跨过错峰窗口边界（POOL 里两个固定
  `Date` 与当前时刻的比较），同一份未改动的 `lib/client.js` 也会偶发报「N differing
  call(s)」而 FAIL。实测同码连跑 5 次皆 IDENTICAL，偶发一次 2-diff。判据：先跑
  `git diff --stat -- lib/client.js`——若产物未改动而门禁红，即为该 flake，重跑即绿，
  不是回归。根治需把探针时间冻结（注入固定 `now`），属 issue 12/15 一档的小口子。
