# 已知覆盖缺口

这份文件登记**明确知道没有测试保护**的地方。每条都写清「为什么现在没有」和
「要补上它需要先做什么」，这样缺口是待办，不是旁白。

新增测试时请顺手更新本文件；删掉一条时请在提交信息里说明它为什么不再成立。

**最近一次复核**（0.2.1 + 还原入库 + `121d1a3` 之后）：第 1、2 条是接线缺口，等
`--experimental-test-module-mocks`；第 3 条的根治已落地（见下），镜像本身是刻意
接受的；第 4 条原理不可测；第 5 条是写了也测不到的等价路径；第 6 条是功能未实现
（跨平台凭据链），不是测试缺口；第 7 条登记仓库级缺失，其中**文档漂移**一项已由
`test/docs-facts.test.js` 建立门禁；第 8 条登记国际版 campaigns 端点的 umid 机器身份门控
（2026-09-27 实测 + 修复已落地，见下）。

**凭据 sweep 的身份守卫（issue 01）**：`sweepStaleOscryptDirs` 现在要求
`lstat` 判真目录 + `.dsh-oscrypt` 标记文件 + `key.b64` 恰好解出 32 字节，
三道闸全部由 `test/credential-cleanup.test.js` 的新用例守着，且两道守卫各自
独立经手工变异验证承重（改回 `statSync` → junction 用例红；删 marker 检查 →
4 条红）。sweep 与 `zeroOutFile` 里剩下的手工"实测全绿"条目不变。

**第 3 条的根治已经落地**：卡片此前只由手抄副本守着，实测**抓不住任何东西**——
从 `lib/client.js` 删掉那行 `promo.active !== true`（正是阻止卡片显示拿不到的折扣价
的那一行），`model-row.test.js` 依然 9 pass / 0 fail。现已增加
`test/client-bundle.test.js`，直接从产物文本里提取 `offPeakState` 及其依赖并执行，
同一个变异会让它 3 条变红。此后 `src/client/*.ts` 已还原入库（issue 17，
`121d1a3`），产物由 `npm run verify` 保证可由源码逐字节重建——剩下的缺口见第 3 条本身。

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

**位置**：`lib/index.js`（约 1300 行）

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

**为什么无法 import**：卡片是浏览器 bundle——开头就取 `window.__ModuleLoader__` 与
`react`，Node 测试里没有 DOM 宿主能装载它。源码如今**已经**入库
（`src/client/*.ts`，issue 17 还原），`npm run build` 也能逐字节重建产物
（verify 的 `--tsdown` 一步就是这道门），但"可重建"不等于"可 import"：测试里能执行的
仍然只有从产物文本中提取的纯函数。

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

**根治办法（已落地）**：`src/client/*.ts` 入库，`lib/client.js` 成为可复现的构建产物。
这消掉的是"产物无法修改"，**不是**"卡片无法进测试"——后者是 DOM 问题，本仓库不打算
为此引入 jsdom。在这一层补上之前，规矩不变：**往卡片上加任何 UI 判定逻辑之前，先想
清楚它的 host 端对应物是什么**——两个界面算同一个数，就必须有两处测试。

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
- **文档（prose）漂移此前没有任何门禁，现已建立**：还原入库（issue 17）作废了一整批
  当时写在活文件里的陈述——"卡片没有入库的源码"、"产物独一份"、"入库仍是待办"、硬编码
  的测试通过数、指向错误编号的交叉引用——三门禁全绿照过。化石原文的清单以
  `test/docs-facts.test.js` 里的 `FOSSILS` 为唯一登记处，本文件不逐字复述（复述即命中）。
  该门禁守的是：活文件里的化石短语、裸编号交叉引用（必须带标题括注）、README 目录表与
  `lib/`、`src/client/` 的清单一致、引用的覆盖率数字与 `package.json` 一致。它同样只是
  地板：防的是"悄悄说谎"，防不了"写一句没用的真话"。
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

---

## 8. 国际版 campaigns 端点按 umid 机器身份门控每日签到

**位置**：`lib/upstream.js`（`openApiHeaders` 与 `readCampaigns` / `claimCampaign` /
`fetchUsage` / `fetchUserInfo` 共用的头组）、`lib/claim.js`（降级列表的语义）

**发现（2026-09-27，本机两个真实账号）**：国际版 `GET /sash/api/v1/me/campaigns`
对**不带 umid 机器身份头**的请求只下发常驻的 `VIEW_DETAILS` 横幅（首月翻倍广告），
**不下发**每日 `CLAIM_BENEFIT` 轮次（100 Credits）。于是插件的 `checkinStateFrom`
读到的列表里没有可领轮次，判 `{ active: false }`，卡片签到行按设计不渲染——判断逻辑
本身没有 bug，缺的是请求侧的机器身份。

**判别证据**（全部只读探测，脚本在 `probe/`）：

| 请求 | 国际端返回 |
|---|---|
| 裸 bearer（插件原状） | 仅 `VIEW_DETAILS` |
| bearer + `auth.machine-id` 文件值充数机器头 | 仅 `VIEW_DETAILS`（充数值不被接受） |
| bearer + **真实 umid 头**（`resources\umid\runtime-info.exe` 输出的 `machineToken/Code/Type`） | `CLAIM_BENEFIT` + `VIEW_DETAILS` ✅ |
| 对照：CN 端裸 bearer | `CLAIM_BENEFIT` + `VIEW_DETAILS`（CN 不门控） |

**修复**：`openApiHeaders(credential, region)` 在 Windows 上定位安装目录下的
`runtime-info.exe`（0.4.x 布局在 `Programs\Qoder\.qoder-versions\<v>\resources\umid\`，
旧布局在 `Programs\Qoder\resources\umid\`），同步执行（5 s 超时、非 shell、
`stdio` 管道）取其 JSON 输出作为 `Cosy-MachineToken/Code/Type` 头随 OpenAPI 请求发送；
任一环节失败（非 Windows、未安装、二进制超时/输出不可解析）降级为原头组，
CN 与 PAT 凭据不受影响。二进制每进程只跑一次（`umidInfo` 缓存）。

**残留缺口**：

- umid 头目前附加在**所有** OpenAPI 调用上（userinfo / usage / campaigns / claim）。
  国际端 campaigns 是它的判别因子，其余端点是否也门控未逐一验证；若上游收紧
  （只认机器身份、拒裸请求），全走 umid 头反而是对的。若上游将来对 umid 做
  频控/绑定，需要按端点收窄。
- `runtime-info.exe` 的 0.4.3 版本路径是**当前实测值**：0.4.x 的 `.qoder-versions`
  布局升级后版本目录会变（例如 0.4.4），`umidRootsFor` 需要同步补档。
- 跨平台（第 6 条）依旧：umid 二进制是 Windows 专物，macOS / Linux 上国际版
  签到行会继续缺席，与跨平台凭据链缺口同源。
- **领取幂等性未实测**：本轮只读验证了"看见轮次"，没有真发 POST 领取
  （领取会真实进账，属于账号变更操作）。`normalizeClaimResult` 的 `replayed`
  语义在 CN 端有既测，国际端同链路但缺一次实领确认。
