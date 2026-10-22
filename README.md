<h1 align="center">dsh-connect-qoder</h1>

<p align="center"><b>把本机已登录的 Qoder 模型（国内版 / 国际版）接入 DeepSeek Harness，零配置用你的账号额度。</b></p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="https://github.com/eghrhegpe/dsh-connect-qoder/issues">问题反馈</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@eghrhegpe/dsh-connect-qoder"><img src="https://img.shields.io/npm/v/@eghrhegpe/dsh-connect-qoder?style=flat-square&label=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@eghrhegpe/dsh-connect-qoder"><img src="https://img.shields.io/npm/d18m/@eghrhegpe/dsh-connect-qoder?style=flat-square&label=downloads&color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/eghrhegpe/dsh-connect-qoder/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/eghrhegpe/dsh-connect-qoder/ci.yml?branch=main&style=flat-square&label=tests" alt="test status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/eghrhegpe/dsh-connect-qoder?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/eghrhegpe/dsh-connect-qoder/stargazers"><img src="https://img.shields.io/github/stars/eghrhegpe/dsh-connect-qoder?style=flat-square" alt="GitHub stars"></a>
  <a href="https://dshfind.com/plugins/eghrhegpe/dsh-connect-qoder"><img src="https://dshfind.com/api/badge/eghrhegpe/dsh-connect-qoder" alt="dshfind plugin"></a>
</p>

把本机已登录的 **Qoder** 模型接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，
零配置即可在 DSH 的模型选择器里使用你的 Qoder 账号额度。

国内版 **Qoder CN** 与国际版 **Qoder** 是两个并行的 provider（`qoder-cn` / `qoder`），
装哪个就出现哪一组模型，两个都装就两组并存，各自使用自己的账号与额度。
![Plugins 页的 Qoder 卡片：两版（Qoder CN / Qoder）的区域状态、套餐内额度与剩余 Credits、今日请求与消耗](https://github.com/user-attachments/assets/73a691b5-0633-4090-a193-0459bbf655ae)

输入框旁的**用量胶囊**：工具栏上的 `Qoder CN · 2,222` 是区域前缀加主额度剩余 Credits，
点开就是同一份用量面板——套餐内额度与剩余、今日经本客户端的请求数与 token 消耗（含缓存命中）、
7 天用量趋势，以及今日签到状态——与 Plugins 页卡片同款（同一套读数与阈值）。

![输入框旁的用量胶囊，展开后是用量面板：余额 8%、剩余 2,222 Credits、今日请求 612 次、7 天趋势图与今日签到状态](https://raw.githubusercontent.com/eghrhegpe/dsh-connect-qoder/master/assets/qoder-usage-capsule.png)

## 工作原理

```
DSH PiAiAdapter（每个区域一套）
  -> 安全 loopback shim（随机端口 + 进程内随机 secret）
  -> COSY 签名 + 自定义 base64 编码
  -> 国内版 https://gateway.qoder.com.cn/
  -> 国际版 https://api3.qoder.sh/
  -> Qoder 双层包装 SSE
  -> OpenAI SSE
  -> DSH 本地执行工具并回传结果
```

Qoder 不是 OpenAI 兼容端点，所以需要三样东西：

1. **COSY 签名头** —— 每个网关请求都带 `Cosy-*` 头与 `Authorization: Bearer COSY.<payload>.<sig>`，
   签名是对 base64 负载、RSA 包装的 AES 密钥、时间戳、请求体与签名路径做 MD5。
2. **置换 base64 请求体** —— 查询串里的 `Encode=1` 表示 JSON 体要先 base64、再按换过的字母表
   逐字符替换、最后按三分之一旋转。
3. **双层 SSE** —— 每个 `data:` 帧是一个信封对象，它的 `body` 字段本身又是 JSON 字符串，
   里面才是 OpenAI 风格的 chunk。

## 凭据来源

插件有三个凭据来源，按优先级依次尝试（**桌面应用优先**）：

1. **Qoder 桌面应用自己的登录状态**（下面几段描述的解密过程）。只要它在**且没过期**，用的就是它：
   应用运行时自己保持登录新鲜，本机没有比它更新的凭据。
2. **插件自己的设备登录**。在浏览器里批准一个码，插件把换回来的可刷新令牌存进
   `$DSH_HOME/.qoder-auth.<region>.json`。这是没装桌面端（或不想装）的机器零配置登录的路径 ——
   详见 [凭据安全](#凭据安全) 与 `docs/issues/21-device-login-credential-source.md`。
3. **环境变量 PAT**（`QODERCN_PAT` 等）。最后的兜底，需要用户自己到后台造一个长期令牌。

**桌面端那条过期了就不算数**（2026-10-20）：过期的 access token 什么都干不了——每个带它签名的
请求都会被拒，这个版本本身也不会被注册（`region-gate` 直接按"登录已过期"跳过发布）。所以它
不再压住后面两条：插件会继续往设备登录、再往 PAT 找一条**还能用**的凭据。只有三条都拿不出
东西时，那条过期的桌面端登录才作为"本机真实发生过的事"被报出去，而不是被一句含糊的"没登录"
盖过去。

无论走哪一条，**都不写入应用的文件**：桌面端的凭据文件始终以只读方式打开。

**卡片按"真正在服务这个版本的是谁"说话**（2026-10-20）：宿主把桌面端登录与插件自有登录**并列**
上报（两条凭据两种寿命，不合并），但账号卡要回答的其实只有一个问题——"这个版本登录了吗"。
所以当插件自有凭据在服务、而桌面端那条不在服务（过期、读不到、或只是环境变量 PAT 在服务）时，
这个版本读作**"已登录"**，并配一句"当前用的是插件自有登录（浏览器登录）——不需要桌面端
客户端"；此时那条"本地登录信息读不到"的红字不再出现——它描述的是桌面端，不是这个版本能不能用。
只签浏览器登录的用户也因此第一次有了「在线校验登录」按钮可点（以前按钮只在 `source` 有值时
出现，而插件自有登录在账号行里没有 `source`）。

Qoder 把登录信息放在 Chromium OSCrypt 格式的凭据文件里（`v10` + nonce + 密文 + tag，AES-256-GCM）。
新版（0.3.x）的凭据直接保存在 `<userData>/auth.v1.dat`，旧版（0.2.x 及更早）则放在
VS Code 风格的 `state.vscdb` SQLite 数据库里。两种布局都支持，新版优先尝试。
密文用的密钥保存在应用的 `Local State` 中，由操作系统 keystore 包裹 —— Windows 上是当前用户
作用域的 DPAPI，因此同一用户下的进程都能解开它。
Node 没有内置 DPAPI 绑定，这一步交给 PowerShell，并通过临时文件交换结果（不使用管道），
这样在禁止管道 stdio 的沙箱里同样可用。

没有桌面应用登录时，可以用官方文档的 **PAT** 兜底：设置 `QODERCN_PAT`（国内版）或
`QODER_PAT`（国际版），插件会用它换取 job token。

**平台边界：读桌面端登录态那条路径只在 Windows 成立。** 解密链路是 PowerShell + DPAPI
（`Crypt32.dll`），`src/host/` 里没有任何 macOS / Linux 解包分支——在其它平台上应用目录
**找得到**（应用数据根目录已按平台解析，见下），但凭据读不出来（`loadCredential` 返回
`undefined`）。非 Windows 上的失败**说的是真话**：`runUnwrap` 在 spawn 之前就判平台，
记下的是"这个版本只在 Windows 上读得到登录"，而不是一条在 Mac 上显示的 Windows 路径；
账号面板的提示也随之改为指向**在哪个平台都成立**的路子（先「浏览器登录」，再 PAT），
而不是让一个已经装了客户端的用户去确认"客户端在不在"。

**但那些平台已经不再只有 PAT 一条路**：插件自己的**设备登录**（上面「凭据来源」的第 2 条）
不读桌面端任何东西——在浏览器里批准一次，凭据就落在本机，平台无关。所以第 1 项 keystore
从"必须补"变成"可选"。**诚实的限定**：设备登录这条路径**只在 Windows 上真机跑过**（两区各
一次授权闭环，见 [`probe/qoder-device-login.mjs`](probe/qoder-device-login.mjs)），它用到的
都是跨平台 API，但"在 macOS / Linux 上也确实能用"仍属下面第 2 项那类实机验证。

**这不是"没有跨平台客户端"，而是客户端已跨平台、插件尚未跟上**：Qoder 桌面版在
macOS 12+ / Linux (.deb/.rpm) / HarmonyOS 上都有下载（[qoder.com.cn/download](https://qoder.com.cn/download)），
但 `src/host/` 只实现了 Windows 这一条解密链。缺口在两处，全部登记在
[docs/KNOWN_GAPS.md 第 6 条（跨平台凭据链未实现）](docs/KNOWN_GAPS.md)：

1. **OS keystore 封装（含 key 派生）**：Windows 走 DPAPI；macOS 需 Keychain（`security`），
   且 Chromium 在 macOS 上对 `encrypted_key` 还要做 PBKDF2-HMAC-SHA1 派生（"peanuts" 常量 +
   1003 次迭代）——与 DPAPI 直解是两种算法，不是换个命令；Linux 需 libsecret（`secret-tool`）
   或 Chromium 在 Linux 上的 `peanuts` 硬编码 key 兜底。
2. **跨平台 CI 与实机验证**：GitHub Actions 的 macos / ubuntu runner 可以编译并跑单测，但
   Keychain 弹窗、签名打包、`secret-tool` 的 D-Bus session 都得在实机或 runner 上验。

**已修的两项**（原缺口共四处）：应用数据根目录现在按平台解析（Windows `%APPDATA`、
macOS `~/Library/Application Support`、Linux `$XDG_CONFIG_HOME`/`~/.config`）——此前直接读
`process.env.APPDATA`，而该变量在 macOS 上不存在，于是探测得到空串、把"应用装着但读不出密钥"
谎报成"您没登录"；`MACHINE_OS` 也补上了 darwin 档（本机实测过网关对
`x86_64_darwin` / `aarch64_darwin` 一律正常应答）。

剩下的是**实机工作**：service 名、PBKDF2 参数、Linux 的变体都必须实测确认，写出来就是盲代码。
macOS / Linux 用户现在可以走设备登录（零配置），或 PAT 兜底，或自行从本仓库移植解密链。

CI 的 Ubuntu 绿灯说明**测试**在那边能跑，不等于零配置在 Linux 上存在。

## 安装

### 从 npm 安装（推荐）

```
dsh plugin --profile web add @eghrhegpe/dsh-connect-qoder
```

### 从 DSH 市场安装（DSH 桌面用户）

> 本仓库是 [hdhgsysh/dsh-connect-qoder](https://github.com/hdhgsysh/dsh-connect-qoder) 的 fork。

可在 DSH 的「插件市场」里粘贴这个源：

```
github:eghrhegpe/dsh-connect-qoder
```

`github:` 源是**零配置**的：宿主产物 `lib/`（host + client bundle）随仓库提交，克隆即可加载，
安装过程不需要批准构建脚本、也不需要拉 devDependencies。若 DSH 反而提示该包有待批准的构建
脚本，说明它拿到了一份缺 `lib/` 的旧克隆——删掉重装即可（`lib/` 自 `docs/issues/19` 起必须
入库，CI 有新鲜度门禁）。

> 注意：npm 上不带 scope 的 `dsh-connect-qoder` 由上游发布，**装到的是上游那份**；
本 fork 自己发的是 scoped 包 `@eghrhegpe/dsh-connect-qoder`（上面那条），二者不是同一个包。
npm 安装每次发布都会现场重建产物（`prepack`），**同版本号下 npm 的产物比仓库提交里更新的
可能性更大**——追新走 npm，`github:` 源装的是对应提交时刻的产物。

或本地开发模式：

```sh
dsh plugin --profile web add <本仓库路径>
```

本地开发时 `lib/` 对应的是**提交时刻**的源码：改过 `src/` 后先
`npm install && npm run build`，再让 DSH 指向本目录，否则跑的还是旧产物。

安装后需要**重启 DSH 进程**：bundle 的 patch 在启动时读取。


## 凭据安全

来源不同，插件是否在本机留下东西也不同：

- **桌面应用的凭据**：只读打开（新版 `auth.v1.dat` / 旧版 `state.vscdb`，不做任何写入），
  不存储、不复制。解密主密钥会在 `%TEMP%` 短暂明文落盘，回收窗口见
  `docs/issues/02`。
- **设备登录换来的令牌**：这是插件**自己持有**的唯一凭据，因此也是唯一会被写下来的 ——
  存在 `$DSH_HOME/.qoder-auth.<region>.json`，`0600` + 临时文件改名写入（不会留下半写文件），
  按 region 分文件（两个版本互不影响）。面板上的「退出插件登录」删的就是这个文件；它不影响
  桌面端的登录，也不影响环境变量里的 PAT。令牌过期时插件用同一次的刷新令牌换新，换新失败
  会在面板上说明原因，而不是装作还登录着。
- **环境变量 PAT**：只读，插件不写入任何地方。
- 进程内随机 bearer token 绑定 loopback 端口；Qoder 真实的 RSA 包装 key 与 session key
  不会离开本插件的沙箱。

## 已知行为

- **始终思考的模型**：部分模型（如 `GLM-5.3-Flash`、`Kimi-K3`）声明了推理档位但不允许关闭思考，
  对它们发送 `enable_thinking: false` 会被上游以 `provider_error 1210` 拒绝。插件从模型目录
  识别这类模型并**完全省略**该字段，让模型使用自己的默认档位。
- **上游错误可见**：上游失败时返回的是普通 200 帧里的错误对象，而不是 chunk。插件把它翻译成
  一条可读的错误，而不是让用户看到一个空的助手回合。
- **今日请求次数用完**（不是"排队"）：Qoder 每天有请求次数上限，用满后上游会带一个**以小时计**的
  重试提示（约两小时）把它伪装成排队。此前插件照单全收，显示成"重试延迟：7350 毫秒"，
  而这个等待**怎么等都没用**——次数要到日期切换才重置，不是排队排空的。现在它是一个独立状态：
  不重试、不显示误导性的延迟，明确告知约几小时后重置，并指出仍然有效的两条路：
  **22:00-08:00 的错峰价**（折后价，通常不计入或少计日次数）与**每日签到**。
  状态码也从此前的 502（"Qoder 坏了"）改为 429（"今天用完了"）。判别点在
  [src/host/errors.ts](src/host/errors.ts) 的 classifyUpstreamError：**先认 110、再认队列标记**——
  顺序是承重的，因为这个报文本身带着全部队列标记，由 test/daily-limit.test.js 钉住。
- **国际版额度**：国际版的试用额度可能已用尽（`isQuotaExceeded`），此时目录请求会返回
  403 `Login expired`，该区域就不会显示模型；国内版不受影响。
- **账号状态四档与卡片重读**：插件入口读不出登录凭据的区域不注册 provider（启动日志会说
  原因）。卡片顶部的「当前账号」面板收敛成**版本条**（对齐 WorkBuddy 的 tab 条）：每个
  区域一个胶囊——状态点（`ok` 绿 / `expired` 红 / `needs-app` 琥珀 / `signed-out` 中性）+
  区域名 +「模型」开关；点哪个胶囊，账号详情、用量与模型列表都只看那一版，区域名因此
  在卡片上只出现一次（模型行的区域 badge 已随之移除）。身份详情只带 name / email /
  到期日，**不带任何凭据**（判定在 `src/host/account-state.ts`，纯本地证据、可注入可直测）。
  两个按钮各管一件事：「重读登录」
  让宿主丢弃凭据缓存、重读应用存储，并把启动时未能上线的区域**现在就上线**（重建并重新
  注册 adapter，失败时回滚到原注册，不影响已在服务的区域）——重新登录后不必再重启 DSH；
  **面板每次渲染只读已缓存的密钥，不会同步起 PowerShell**（那会阻塞整个 DSH 进程，最坏 30 s），
  所以解不开的机器也能立刻看到"读不到"和原因；即便真的需要解包（点「重读登录」时）也是
  **异步等待**——本机实测调用 29 ms 就返回、等待期间 DSH 照常响应别的请求，而同步版本会冻结
  490 ms；「重读登录」是您主动点的，那一次是真读，不受缓存与失败窗口限制。
  密钥缓存与 `Local State` 文件绑定，Qoder 重装换掉主密钥后插件会立刻重新解包，**不必重启 DSH**；
  「在线确认」是账号流程里唯一的联网调用（`fetchUserInfo`），回答「上游现在还认不认
  这个登录」，失败按 `classifyUpstreamError` 分档（`sign-in-expired` / 其他）。
- **每一版的模型可以单独关掉**（`enabledRegions`，版本条上的「模型」开关，对齐
  WorkBuddy 的 per-tab 供应商开关）：取消勾选的一版向 DSH 提供**零个模型**，它的
  模型组按「空目录即隐藏」的同一条规则从选择器消失，但登录、用量与模型筛选全部
  保留，重新勾选即恢复，无需重启 DSH；卡片模型列表与选择器用同一个
  `regionEnabledFor` 谓词过滤，两个界面不会打架。
- **刷新失败会说出来，而不是留着旧数据装作没事**：
  - **上游当前没有模型**（账号被收窄 / 模型全部下线）是**结果**不是故障——插件会照实把目录清空，
    并把该版本的模型组从选择器撤下。此前这两种情况走同一条静默路径，于是旧名单永远留着，
    点"刷新计费"也不可能有任何变化。
  - **抓取失败**（网络、凭据、上游 5xx）保留上一份好数据，并把卡片上的时间标成
    「上次更新：X（刷新失败）」，而不是给一个全新的时间假装刚更新过。
  - **Qoder 改了接口格式**（HTTP 200 但返回的信封不认识，例如分组改名）是一档独立状态，
    卡片直接说"请更新插件（重新登录没有用）"，且**不**显示时间戳——它不会被当成"排队"慢慢重试。
    判别边界取自实测（`probe/model-shape.mjs`，两端真实账号）：空分组用 `[]` 表达，
    所以"0 个模型"是可信结果、必须落盘，而"分组键缺失/类型变了"才是格式变化。
- **卡片接口只接受同源请求**（安全）：**十二条**路由里**七条是 POST 且能改状态**——「签到领积分」
  （真实账号变更）、「保存模型勾选与图像模式」（`__save`）、「重读登录」、「在线确认」，
  以及设备登录那一组的**三条写路由**：「开授权页」、「取消」、「**登出并删掉本插件存的凭据**」。
  逐条方法、能否改状态、谁在调用见 [docs/ROUTES.md](https://github.com/eghrhegpe/dsh-connect-qoder/blob/master/docs/ROUTES.md)
  （本仓路由的唯一清单；改路由必须同步那张表）。这些接口此前只按"来源主机名是不是
  本机"判断，因此**本机任意端口上的任意 HTTP 服务**都能让它的网页代为调用（浏览器会挡跨域
  读响应，但操作已经发生）。现在要求来源的**地址与端口**与请求实际拨到的地址一致
  （比对请求自己的 `Host` 头，所以不写死端口、DSH 换端口也不用改），且必须是回环地址。
  判定在 [`src/host/routes.ts`](src/host/routes.ts) 的 `loopbackRequest`，由 `test/route-gates.test.js` 覆盖。
- 依赖 Qoder 客户端接口（非官方开放 API），Qoder 更新后插件可能需要随之调整。
- **设置命名空间由宿主决定，不能自选**（0.2 代起）：`describe()` 用 Loader 条目
  id 作为 `ns`（本 bundle 是 `llm-qoder`，不是 `dsh-connect-qoder`），而「设置 → 模型」
  页按**精确匹配**查 `namespaces.get(entry.settingsNs)`。若插件宣告的命名空间与宿主实际
  服务的不一致，该 provider 会被判为「未配置」，**整行从页面上消失**——不报错、不灰显，
  而插件本身仍在正常注册和应答，非常难查。因此 `settingsNs` 一律经
  `settingsNamespaceOf(ctx)` 从 `ctx.fiber.entry.options.id` 推导，常量只作为宿主不暴露
  条目 id 时的回落值（对齐 WorkBuddy 2.1.0 的同款修复）。
- **设置保存走插件的 `__save` 主机端点 + 读回校验**（对齐 WorkBuddy 同修）：DSH 0.2 代的
  客户端设置 scope `set()` 在原子写重试耗尽后会**静默返回成功而不落盘**，卡片改为「主机端点
  权威写、本地写仅作镜像、写后读回确认」，保存按钮只会显示真实结果。在宿主未为本插件注册设置
  命名空间行的环境（如 `link:` 开发安装）下端点会 503，卡片如实显示失败而不是假"已保存"；
  正式（registry）安装下该端点可用。
- **每日签到**：Qoder 每天 10:00（UTC+8）给每个账号发一轮 `CLAIM_BENEFIT` 活动，一轮只能领一次，
  重复领取是幂等的（`replayed`，不再发放）。卡片在「我的用量」**右侧**放一张签到小卡片 + 三态按钮
  （立即签到 / 签到中… / 今日已签到）——**只有你点才会领，插件不会自动签到**。每次点击都先重读一次
  活动列表取当轮 id，绝不复用渲染时的旧 id（一天一轮，旧 id 就是上一轮的）；领取后用量缓存作废
  重读，因为 Credits 落在同一块面板显示的 Add-on 资源包里。两个过滤器是照真实返回加的：同一账号
  下的另一个 `VIEW_DETAILS` 活动同样带着 `claimStatus: "CLAIMED"` 却没有 benefit，只按状态挑会对
  它去领；而列表顶层的 `claimable` 在「已领过」和「没有活动」时都是 `false`，不能当判据。
  卡片右上角大字是**主机解析出的当轮额度**（`checkin.amount`，来自活动自身的 benefit），领过之后
  仍然显示——签到卡片因此不是「一行两段短文案占满整行」，而是与用量面板并排的一张卡；窄卡片下
  自动换行到面板下方。额度落在 `addOnQuota` 里，是因为国内版免费层的计划额度为 0，签到攒的资源包
  是它唯一的额度。
- **国际版签到行需要 umid 机器身份**：国际版 `GET /sash/api/v1/me/campaigns` 把每日
  `CLAIM_BENEFIT` 轮次按机器身份下发——请求须携带桌面应用 umid 服务的
  `Cosy-MachineToken/Code/Type` 头，否则只回常驻的 `VIEW_DETAILS` 横幅，签到卡片按
  `active: false` 设计不渲染。插件在 OpenAPI 请求上自动附加这组头（Windows 上定位安装
  目录的 `resources\umid\runtime-info.exe` 读取，失败静默降级为原头组；国内版与 PAT
  不受影响；发现与验证记录在 [docs/KNOWN_GAPS.md 第 8 条（国际版 campaigns 端点按 umid 机器身份门控每日签到）](docs/KNOWN_GAPS.md)）。

## 文档

**npm 包里只有 6 项**：`lib/`、`locale/*.json`、`cordis.patch.yml`、`icon.svg`、`README.md`、
`CHANGELOG.md`（即 `package.json` 的 `files`；另有 npm 无论如何都会打包的 `LICENSE`）。
`docs/`、`AGENTS.md`、`src/`、`test/`、`probe/`、`scripts/`、`assets/` 都在仓库里、**不在包里**
——registry 页面上点这些路径会 404，请到 GitHub 仓库看。本文的截图因此一律写成
`raw.githubusercontent.com` 绝对地址（相对路径在 registry 页面上是裂图）。

阅读顺序按身份分，别从头读到尾：

| 你是 | 读到哪为止 | 之后去哪 |
|---|---|---|
| **装它 / 用它** | 「已知行为」这一节结束 | 没有必须再读的；遇到现象先查 [`docs/README.md`](https://github.com/eghrhegpe/dsh-connect-qoder/blob/master/docs/README.md) 里的 `howto/symptom-triage.md`（按屏幕原文排） |
| **改它 / 审它** | 继续往下：「目录」（逐文件职责）、「构建产物」、「测试」 | [`docs/README.md`](https://github.com/eghrhegpe/dsh-connect-qoder/blob/master/docs/README.md) 的完整地图：缺口 `KNOWN_GAPS.md`、路由契约 [`ROUTES.md`](https://github.com/eghrhegpe/dsh-connect-qoder/blob/master/docs/ROUTES.md)、平台事实 `docs-qoder-cn/` |
| **AI 协作会话** | — | [`AGENTS.md`](https://github.com/eghrhegpe/dsh-connect-qoder/blob/master/AGENTS.md)（**不随包发布**，只在仓库里）：验证怎么跑、红线、门禁真源 |

## 目录

| 文件 | 作用 |
| --- | --- |
| `src/host/credentials.ts` | 从 Qoder 应用**读取**登录凭据的存储半边：探测候选应用目录、以只读方式打开 `state.vscdb`、解码各行（2026-10-20 从中拆出 OSCrypt 链，链在下一行） |
| `src/host/oscrypt-unwrap.ts` | OSCrypt 链：PowerShell/DPAPI 解包主密钥、密钥缓存与 `Local State` 绑定、失败窗口 60 s、清零与启动清扫（**唯一会把密文写到进程外、唯一 spawn 子进程、唯一删东西**的一半；两个解包入口都接受注入的 spawner，因此链内环节可无 PowerShell 测） |
| `src/host/upstream.ts` | 上游层的**门面**（26 行）：逐名 re-export `src/host/upstream/` 下的 11 个叶模块，让 20 个下游 importer 一行不动（2026-10-17 拆分，`docs/issues/22`） |
| `src/host/upstream/crypto.ts` | RSA 公钥、置换字母表与 `Encode=1` 请求体编码（`CUSTOM_ALPHABET` / `encodeBody`）；协议事实原文注释在此文件头 |
| `src/host/upstream/client-constants.ts` | `COSY_VERSION` / `CLIENT_TYPE` / `MACHINE_TYPE` / `DATA_POLICY` / `LOGIN_VERSION` / `MACHINE_OS` |
| `src/host/upstream/sign.ts` | `signaturePath`（签名路径，剥掉 gateway 路由掉的 `/algo` 前缀） |
| `src/host/upstream/cosy-sign.ts` | `authHeaders`：COSY 签名头组装（AES 加密签名 info 块、RSA 包 AES key、MD5 over payload/key/ts/body/path） |
| `src/host/upstream/headers.ts` | `openApiHeaders` 与 umid 机器身份头（Windows 定位 `runtime-info.exe`；读不到时显式降级，`__dshQoderUmidState` 报原因） |
| `src/host/upstream/endpoints.ts` | 各 API 端点 URL 构造（目录/对话/兑换/账号/用量/签到） |
| `src/host/upstream/retry.ts` | 重试与队列等待预算（`QUEUE_WAIT_*`、`queueWaitFor`，含两分钟预算的 rationale） |
| `src/host/upstream/sse.ts` | 双层包裹 SSE 解码与对话流（`streamChat`，含重试循环与 `Retry-After` 处理） |
| `src/host/upstream/fetch-usage.ts` | 用量快照（`fetchUsage` / `UsageSnapshot` / `normalizeQuotaBucket` / `normalizeDedicatedPackage` / `normalizePromotion`）；促销读失败时**具名降级**而非静默（`campaignsError`） |
| `src/host/upstream/api-calls.ts` | 各调用的编排与 JSON 读取（`readJson` / `readCampaigns` / `claimCampaign` / `fetchModels` / `readModelCatalogShape` / `exchangePat` / `fetchUserInfo`） |
| `src/host/upstream/messages.ts` | DSH ↔ Qoder 的消息与工具描述转换（`toQoderMessages` / `toQoderTools`） |
| `src/host/shim.ts` | 面向 pi-ai 的 OpenAI 兼容回环端点 |
| `src/host/adapter.ts` | pi-ai provider 与 `PiAiAdapter` profile（被关的 provider 以零模型组呈现，由 DSH 自行隐藏） |
| `src/host/route-retry-policy.ts` | 本路由**交出去给宿主**的重试策略：只留 `EMPTY_RESPONSE` / `TIMEOUT` / `TRANSPORT`，让插件的队列阶梯成为唯一重试源——宿主默认策略含 `RATE_LIMIT` / `SERVER`，会把已烧完 120 s 预算的队列失败再续 5 次（≈12 min），也会白重试 shim 一律用 502 表达的终态判决；刻意不设 `maxRetries` / `backoff`（未知键会让整个 profile 注册失败；`docs/issues/24`，无 peer 依赖） |
| `src/host/catalog-entry.ts` | 目录条目的归一化、模型过滤（含按区域开关）与卡片行投影（无 peer 依赖） |
| `src/host/catalog-store.ts` | 目录的磁盘缓存与原子落盘（无 peer 依赖） |
| `src/host/catalog-refresh.ts` | 一次目录刷新的结果如何落地：**空目录也是结果**（照实清空并推进 `fetchedAt`），只有失败才保留上一份，且失败按 `credential` / `no-credential` / `fetch` / `protocol-shape-changed` 分档（无 peer 依赖） |
| `src/host/credential-cache.ts` | 凭据缓存与「登录失效后重读」规则，以及 env-PAT 兑换的 429 节流闸门（平台自述窗口优先、否则指数退避；401/403 停泊，仅「重读登录」释放；无 peer 依赖）。三源顺序是「桌面端（**没过期**才算在场）→ 插件自有设备登录 → 环境变量 PAT」：过期的桌面端 access token 什么都干不了（连 provider 都不会被注册），所以它不再压住后面两条 |
| `src/host/credential-kind.ts` | 「这个版本现在是谁在服务」的答案：凭据来源标签 → `desktop` / `device` / `env` 三档。宿主是唯一知道实际解出哪条凭据的一方，所以由它说；卡片与 status 路由据此把「桌面端登录」与「插件自有登录」两本账并成一条，不再靠面板猜（无 peer 依赖） |
| `src/host/throttle-store.ts` | 兑换节流闸门的磁盘持久化（只存未过期的 rate-limit 窗口、parked 停泊与令牌一律不落盘，原子写，无 peer 依赖） |
| `src/host/request-counter.ts` | 本地「今日经本客户端请求次数」计数：上游只报「用完了」不给每日上限，故只能本地自计（每次对话轮 +1，重试不重复计）。按 region + 上海本地日分文件、零点翻页、原子写（`temp/rename`）、越界 region 分量拒绝写盘、`gc` 只删本插件命名且早于保留期的旧日文件；撞 `daily_limit_exceeded` 时置 `dailyLimitHit` 不丢计数（无 peer 依赖） |
| `src/host/token-counter.ts` | 本地「今日经本客户端消耗的 token 数」累加器：shim 每抓到一个上游 usage 帧（`total_tokens` / `cached_tokens`，上游每轮明确下发）就累加进本插件文件（`.qoder-token-count.<region>.<day>.json`）。与请求计数器同源同套路（按 region + 上海本地日分文件、零点翻页、原子写、越界防护、`gc` 只删本插件旧文件），但数据来自上游而非本地估算——聚合的是上游已经公开的真实 token 数，不画比例条（无每日上限口径）；`tokensFromUsage` 对坏帧返回 `null` 宁可不加也不加错 |
| `src/host/credential-vault.ts` | 插件自有凭据文件的读写（设备登录换来的可刷新令牌）：`0600` + `temp/rename` 原子写、损坏文件**隔离留存**而非被后来者覆盖、读-改-写整体串行（并发的刷新不会把刚登出的凭据写回来，无 peer 依赖） |
| `src/host/device-login.ts` | 设备登录的协议层（两个 region 各自的端点、`client_id`、PKCE 与轮询/刷新请求）：404 与「还没审批」的空信封都读作未授权而非失败；**刷新应答不是凭据**——实测只有六个字段、把访问令牌叫 `device_token` 且**不带 `user_id`**，必须叠加回被刷新的那一份，否则签名带上空 uid 会被网关回 403 `Signature invalid`（无 peer 依赖） |
| `src/host/device-credential.ts` | 把 vault 里那份令牌变成可签名的凭据、并在过期时轮换：**五档状态**（`none` / `ok` / `expired` / `refresh-failed` / `unreadable`）而非两档——「本机没登录过」与「文件读不出来」指向不同下一步；刷新被拒后有 60s 窗口（否则每轮对话都会重试一条已被吊销的刷新令牌）；刷新成功但落盘失败仍照常出借凭据、只 warn；**从不抛**（抛出去就等于把登录问题变成 provider 坏掉）（无 peer 依赖） |
| `src/host/device-login-flow.ts` | 设备登录的会话状态机（按 region 一次一个尝试，5 分钟 TTL）：把探针那种「一个进程等着」拆成卡片能驱动的 `start` / `poll` / `cancel`，否则一个路由要挂五分钟且面板一关就丢；PKCE verifier 只留在宿主内存、**绝不出现在任何返回值里**；`poll` 每次只发一次请求；**兑换码只能用一次**（尝试先删再写凭据，否则之后的 poll 会给第二个令人困惑的答案）；「批准了但没存下」报 `failed` 而非成功（假确认是红线 1 禁止的）（无 peer 依赖） |
| `src/host/account-payload.ts` | 账号面板三条路由共用的那份应答：逐区域状态 + 开关映射，以及「渲染读缓存 / 重读登录读真」这一个开关（从 `index.ts` 抽出以便直测，无 peer 依赖） |
| `src/host/account-state.ts` | 每区域账号状态四档判定（`ok` / `expired` / `needs-app` / `signed-out`；纯本地证据、不含凭据，无 peer 依赖）；三种读取模式（默认 / `cachedOnly` 不解包 / `force` 忽略失败窗口） |
| `src/host/settings-save.ts` | 设置命名空间的解析（0.2 代由宿主推导，插件不能自选）、设置写入、按区域合并与落盘读回校验（无 peer 依赖） |
| `src/host/pi-model.ts` | pi-ai 模型描述符的构造（纯函数，无 peer 依赖） |
| `src/host/adapter-models.ts` | 单个区域向 DSH 提供的模型列表：区域开关（只认显式 `true`）、勾选过滤、最大上下文开关、逐模型图像模式（从 `adapter.ts` 抽出以便直测，无 peer 依赖） |
| `src/host/region-gate.ts` | 一个区域能否作为 provider 上线：三档拒绝（无登录 / 已过期 / 读不到）各自的判定与日志级别（从 `index.ts` 抽出以便直测，无 peer 依赖） |
| `src/host/lifecycle.ts` | 插件 fiber 退出时要撤销的东西：路由注册的注销句柄收集与释放（宿主是否随 fiber 回收无法从插件侧确认，故两种语义都正确；无 peer 依赖） |
| `src/host/preferences.ts` | 四个设置项的读取与 volatile 解包（`enabledRegions` 区域开关：缺失/非对象一律读作开启，只有显式 `false` 才关） |
| `src/host/offpeak.ts` | 错峰窗口与费率算术（无 peer 依赖） |
| `src/host/single-flight.ts` | 同类异步任务的并发合并：刷新在途时，后来的调用并入同一次请求（目录/用量刷新用，无 peer 依赖） |
| `src/host/claim.ts` | 每日签到：当轮活动的挑选、可领状态判定与领取结果的归一化（纯函数，无 peer 依赖） |
| `src/host/errors.ts` | 上游错误帧的判定：105（登录没了）与 10605（在排队）的分诊，队列提示的提取，以及**协议形状变化**这一档（`ProtocolShapeChangedError`，`retryable: false` 所以它不会被当成"排队"慢慢等）（无 peer 依赖） |
| `src/host/time.ts` | 上游时间戳的单一换算（秒 / 毫秒 / RFC 3339 → epoch 毫秒），曾经的两份副本行为不一致（无 peer 依赖） |
| `src/host/volatile.ts` | volatile 活引用 `{ get() }` 的解包，此前散在三处（无 peer 依赖） |
| `src/host/http-utils.ts` | 回环路由共用的 JSON / OpenAI 形状错误响应（`no-store`，卡片轮询读不到陈旧数据；无 peer 依赖） |
| `src/host/domain.ts` | 各宿主模块标注时共用的领域词表（`Region` / `CatalogEntry` / `Promotion` / `CatalogOutcome` 等）。**只有类型、没有运行时值**，所以不进产物、不改变任何 bundle 字节；刻意不描述任何 peer 模块的形状——那些包由宿主运行时提供、此处只有 `declare module` 空壳，凭空造一个"看起来对"的接口比 `any` 更危险，因为它不会承认自己不知道（无 peer 依赖） |
| `src/host/routes.ts` | 每条卡片路由共用的两道闸：方法检查（405 带 `Allow`、`HEAD` 交给 GET）与**同源**来源检查（403；比对 `Host` 头，POST 路由靠它挡住本机其它端口的网页），以及带 64 KiB 上限的 JSON body 读取器（无 peer 依赖） |
| `src/host/handlers.ts` | 十二条卡片路由的 handler，`(req, res, deps) => Promise<void>` 形态：方法/来源两道闸 + 业务判定 + 应答全在这（含签到 `claimTodayFor` 与「重读登录」的失败保护），`index.ts` 只保留 `webServer.register` 与 deps 装配（从 `index.ts` 抽出以便直测，无 peer 依赖）。「在线校验登录」的兜底路径经 `deps.readCredential` 取凭据，宿主把它接到**按 region 共享的凭据缓存**上，所以没有 runtime 的 region 也能校验插件自有登录（无 peer 依赖） |
| `src/host/publish-regions.ts` | 把当前区域集发布给宿主（`registerAdapter` + `registerConfigurableProviders`）以及失败时的三层回滚：先释放旧的一对，新注册失败则释放半注册的 adapter 并把旧的一对装回去，装不回去则如实留空而不谎称已注册（从 `index.ts` 抽出以便直测，宿主两处注册接缝靠注入，无 peer 依赖） |
| `src/host/route-mount.ts` | 一组路由的挂载判定：**要么全挂上、要么全撤下**。三个账号路由是一个功能，宿主若只收下 `/account` 而拒了 `/account/confirm`，旧写法会留下一个"能读状态、两个按钮却不动"的半截面板，且日志写着"account routes unavailable"——那句话是假的，比没有日志更坏，因为它让人不再往下查。组内任一注册被拒即回滚已拿到的 release 并如实报失败（无 peer 依赖） |
| `src/host/dispose-order.ts` | fiber 注销时的**次序**（次序本身就是内容）：provider 注册先撤、路由先于 runtime 拆（否则 issue 13 那条泄漏）、`disposed` 必须在 `clearInterval` **之前**置位——否则一次还在途的 `refreshCatalog().then` 会把一个全新的 interval 装到已经没人管的 runtime 上，成为活过插件的僵尸凭据解析循环。此前这条只由注释担保（无 peer 依赖） |
| `src/host/injected.ts` | `requireInjected`：把 "`ctx.inject(['webServer'], cb)` 保证 cb 跑时该服务已在" 这个只活在注释里的前提，转成**一次**类型收窄——服务缺失就抛错点名该服务，而不是让后续注册把路由挂到 `undefined` 上、再于更晚静默失败。此前它是 `activate()` 里的内联闭包（七处调用共用），此前这条也只由注释担保；抽出以便直测，只认 `undefined`（其它 falsy 值是宿主自己的契约违反，原样交回、不改写）（无 peer 依赖） |
| `src/host/index.ts` | 按区域注册 provider 的插件入口，与十二条路由的注册接线（handler 本体在 `handlers.ts`；发布与回滚的判定在 `publish-regions.ts`；挂载分组在 `route-mount.ts`；注销次序在 `dispose-order.ts`；注入服务缺失的判定在 `injected.ts`） |

`docs/docs-qoder-cn/` 是从 Qoder CN 官方文档抓回并清洗的资料（**纯 Markdown，源 `.txt` 已删**），
由根目录的 `convert-qoder-docs.ps1` 一次性转换而成——它**只处理这一批抓取件**，不是常规构建步骤；
产物由 `test/docs-markdown.test.js` 守着，改动转换规则后重跑该测试即可。文档与代码的对应关系
（哪条系数/活动/签到事实落在哪个模块）记录在该目录的 `Qoder CN 文档与插件设计佐证.md`。

卡片侧的源码在 `src/client/`（产物是 `lib/client.js`，`react` 由宿主提供，产物不打包它）：

| `src/client/paths.ts` | 卡片用到的**十条**路由常量（`QODER_*_PATH`）：四条读、六条写。`__save` 不在其中——它由 `settings-write.ts` 以字面量直接 POST；`status` 只供宿主诊断，卡片不读 |
| `src/client/styles.ts` | 卡片样式与 `installStyles`（`dsm-*` 一套与 `dsh-connect-workbuddy` 逐字一致，原因见文件头） |
| `src/client/settings-write.ts` | 「写入后读回校验」的浏览器半边 |
| `src/client/controller.ts` | 卡片可编辑状态机（staged/saved 三字段、`dirty`、`save`、`discard` 与派生的模型视图）——无 React、无 DOM，可被 `node:test` 直接测 |
| `src/client/copy.ts` | 卡片文案聚合入口（中/英），`index.ts` 与 `card.tsx` 只从这里取 |
| `src/client/copy-row.ts` `copy-usage.ts` `copy-account.ts` | 按面板拆分的三段文案：模型行与错峰、用量与签到、账号与区域标签条 |
| `src/client/card-model.ts` | 卡片的**浏览器无关决策层**：视图模型类型词汇 + 纯规则（`offPeakState` / `rateAt` / `windowLabelOf` / `refreshNoticeKey` / 格式化 / `describeThrown`——卡片所有 catch 块给用户看的失败文案都过它）。无 React、无 DOM、无 `fetch`，因此 Node 测试可直接 import 真规则，而非镜像副本（这是向 sensenova `snapshot.ts` 对齐的那一刀；`describeThrown` 也从 `card.tsx` 挪进来，拆掉装配层与两个容器之间的循环 import） |
| `src/client/http.ts` | 卡片**唯一的 `fetch` 收口**：`getJson` / `postJson`，模型名册读与两台容器（用量 / 账号）共六道宿主路由 fetch 都只通过这里（向 sensenova `http.ts` 看齐）；GET / POST 失败都先取宿主的 `error` 字段（如 loopback origin 检查的 `origin-not-trusted`），无才回落 `HTTP {status}`；宿主的 `writeError` 写的是 `{error:{message,type,code}}`，故对象形状也取它的 `message`（否则每道 `writeError` 拒绝都会退化成一句没有下文的 `HTTP 500`）；GET 200 但 body 解析失败按 `unparseable JSON body` 抛出而非当空数据，避免「假 undefined 失败」 |
| `src/client/usage-panel.tsx` | 用量容器 `QoderUsagePanel`：自有额度读 + 每日签到领取两条 fetch，渲染 `RegionUsage` / `CheckinCard`（二者留在 `card.tsx` 作为无 hook 纯展示件） |
| `src/client/account-panel.tsx` | 账号容器 `QoderAccountPanel`：区域条 + 选中区域登录卡，四道 fetch（读 / 重读 / 确认 / 开关写），开关写仍带完整 `enabledRegions` map。**按"在服务的是谁"显示**：`effectiveStateOf()` 判出这个版本真正在服务的是桌面端还是插件自有凭据，只有后者在服务时才读作"已登录"、才给「在线校验登录」按钮（桌面端那条在服务时按钮同样在） |
| `src/client/device-login-panel.tsx` | **插件自有登录**那一块（第三个凭据来源的卡片半边）：与账号行的 `state` **并列上报、绝不合并**——桌面端登录与插件令牌是两份凭据两种寿命。两层结构（外层无 hook 做门控，`device` 缺席 = 老宿主 → 什么都不渲染、绝不报「未登录」；内层持全部 hook）。`start` → `window.open` 授权页 + 保留可点回退链接 → 每 2s 轮询一次（链式而非 interval，慢响应只会推迟下一次而不会叠请求）；`authorized` 停并回读，`expired`/`idle`/`failed` 各给不同文案；卸载时若仍在等待就 best-effort `cancel`（宿主 5 分钟 TTL 是兜底）。**每个失败都说出是哪个失败**，`t`/`onChanged` 由 ref 持有并刻意排除在轮询 effect 依赖外（否则父组件每次渲染都会重启计时器） |
| `src/client/card.tsx` | 卡片的装配层 `QoderPluginCard`（把 `QoderAccountPanel` / `QoderUsagePanel` 与模型列表拼起来，纯规则委托 `card-model.ts`、可编辑状态委托 `controller.ts`、名册读走 `http.ts`）+ 三个无 hook 纯展示件（`RegionUsage` / `CheckinCard` / `QuotaBlock`） |
| `src/client/pill-model.ts` | 输入框用量胶囊的**浏览器无关决策层**：区域归属门控（`isQoderRegion` / `selectedRegionOf` / `candidateOf`）、主额度选择（`primaryQuotaOf`——套餐优先，CN 免费层 plan 为 0 回落资源包）、分级（`tierOfQuota`，阈值与卡片同源 `WARN_SHARE = 0.8`）、读数格式化（`remainingOf` / `formatCredits`）。无 React、无 DOM、无 `fetch`，Node 测试直接 import 真规则 |
| `src/client/composer-usage-pill.tsx` | 对话框用量胶囊 `ComposerUsagePill`：挂在宿主输入框工具栏 `conversation.input.right` 座席，读数 `Qoder CN · 1,034`（区域前缀 · 主额度剩余 Credits）+ 分级色点，点击展开原始用量卡（未签到给领取按钮，走与 Plugins 页同一条 claim 路由，领完立刻重读把 Credits 推回余额）；面板顶部画当前模型的错峰窗口状态（折扣挂在模型上，必须 `projection.model` 匹配到名册里的 `id`/`name` 才画，匹配不上不声称打折）；5 分钟轮询、读失败保留上次数值不抛。归属由 `useProjection("modelSelection")` 物化，provider 非 `qoder-cn`/`qoder` 整颗胶囊不挂载（不跑 fetch）。样式走 inline style + 一条容器锚定规则，不注入整表样式以免覆盖宿主工具栏 |
| `src/client/token-history-chart.tsx` | 迷你柱状图 `TokenHistoryChart`：SVG 手绘 7 天 token 消耗趋势（柱高按占比、颜色按消耗量分三档），底部标注周总量与日均、趋势箭头（今天 vs 昨天）。无依赖，内联样式 |
| `src/client/index.ts` | 注册入口（`apply` / `inject` / `name`），含 `conversation.input.right` 座席注册（失败降级 `console.error`，不影响 host provider） |
| `src/client/react-shim.d.ts` | 最小 React 类型垫片（只管类型检查，不参与构建、不随包发布） |

## 构建产物：`lib/` 不是源码

**源码全在 `src/`，`lib/` 是构建产物，但**受版本管理**（`docs/issues/19`：DSH 市场的
`github:` 源安装正是把这两个文件原样发给用户的，缺了它装出来的插件没有宿主入口，所以
`lib/` 必须入库，`.gitignore` 里不许再出现 `/lib/`）。改 `src/` 后跑 `npm run build` 并把
`lib/` 与源码**同一次提交**（CI 有新鲜度门禁：重建产物必须与提交里的一致）；发到 registry
的那一份仍由 `prepack` 现场构建。`npm run build` 从 `src/` 重建出两个文件：

| 产物 | 由谁构建 | 内容 |
| --- | --- | --- |
| `lib/index.js` | `tsdown -c tsdown.config.mjs`（`npm run build:host`） | 上面那张表里全部 `src/host/*.ts` 打成的**单个** ESM bundle——发布面就是 `package.json#main` 一个入口，peer 包一律外置 |
| `lib/client.js` | `node scripts/build-client.mjs`（`npm run build:client`） | 注入到宿主设置页的那张卡片，外面套着 `window.__ModuleLoader__.load(...)` 的加载器外壳 |

**这些源码不是原始手稿，是还原出来的**：2026-09 用 `docs/history/restore-client-src.mjs` 把当时的
产物按 `//#region` 标记机械切分而成，模块边界来自产物，`card.ts` 那一段在产物里没有标记、
是按引用关系推断的。还原后做过一次对拍——把卡片里每个纯函数用同一组输入各调一遍，新旧产物的
返回值与抛错逐条一致（方法记录在 `docs/issues/17-client-source-restore.md`；现在的探针清单与
调用数以 `npm run verify:bundle` 的输出为准，不再在文档里写死数字）。

产物是构建输出：**改源码重建，不要手改产物**。`test/client-bundle.test.js` 从产物里**提取并
执行**卡片的纯函数，所以产物一改那里的断言就得跟着看一眼。

`test/*.test.js` 直接 import `src/host/*.ts`（Node 原生剥类型），**不经过 `lib/`**——所以一套
测试跑的是源码，产物陈旧与否由 `npm run verify:host` 单独把关。

`probe/` 下是一次性只读探针，每个文件头写明 WHY 与 Run，不参与构建、也不被测试收集。
其中 `probe/host-compat.mjs` 回答的是「本机装的 DSH 是什么版本、本仓库的 peer 声明它还认不认」——
宿主把代码打在 `app.asar` 里，这件事从仓库内部看不出来。手法与三个会浪费时间的坑记在
[`docs/howto/host-version-probe.md`](docs/howto/host-version-probe.md)。

## 测试

```sh
npm run verify          # typecheck + 两道 any 审计 + 测试树两道类型门禁 + build + test + 市场条目 + 产物核验，全过才算过
npm run typecheck       # tsc -p tsconfig.json，源码全量类型检查（0 error）
npm run audit:test-types # 测试树自己的类型程序：tsc -p tsconfig.test.json（已 opt-in 的文件数见输出）
npm test                # node --test "test/*.test.js"
npm run test:coverage   # 同上 + 覆盖率门槛（行 68 / 分支 82 / 函数 66，跌破即失败）
npm run build           # 从 src/ 重建 lib/（宿主 bundle + 卡片产物）
```

`npm run verify` 是一条链，每一步回答一个不同的问题。下表与 `package.json` 的 `verify` 脚本
一一对应——`test/docs-facts.test.js` 会核对这张表和那条链是不是同一份，改了一个忘了另一个，
当场就红：

<!-- verify-steps -->
| 步骤 | 回答什么 | 全过时的输出 |
|---|---|---|
| `typecheck` | `src/**` 的每个 `.ts` 都过类型检查 | `tsc` 退出 0、无输出 |
| `audit:any` | 源码里没有隐式 any | `implicit-any sites: <数量> (budget <上限>)` |
| `audit:explicit:any` | 源码里没有显式 any | `explicit-any sites: <数量> (budget <上限>)` |
| `audit:test-types` | 测试文件自己也过类型检查（坏 import、改了名的导出、变了形的参数） | `opted in to type checking: <数量> (floor <下限>)` |
| `audit:test-type-errors` | 测试树的类型债不许涨：新债进不来，旧债只许降 | `test type errors: <实测> (budget <上限>)` |
| `build`（宿主 + 卡片） | `lib/index.js` 与 `lib/client.js` 确实由 `src/` 生成 | `MATCH: … byte-for-byte identical` |
| `test` | 卡片逻辑与宿主半边没被改坏；发布门禁仍能被打破 | 最后一行 `# fail 0` |
| `test:market-entry` | 市场条目还合规则吗（对着上游那份条目规则核一遍） | `market-entry.test.mjs: all checks passed` |
| `verify:host` | 宿主 bundle 不陈旧、公开面与 peer 外置都还在 | `all 11 checks passed`（装了 `tsdown` 时 11 条；没装时 9 条，见下） |
| `verify:bundle` | 重建产物与上一份已发布产物的行为一致 | `behaviour: IDENTICAL` + `OK: …` |

四道类型/any 门禁的阈值都住在 `scripts/ratchet-ledger.json` 这本账里（谁、什么时候、为什么），
不在脚本里——脚本里改阈值这件事本身会当场被账本对不上而红。

中间那条是最要紧的：宿主与卡片两步都**只比较、不认账**。它过了，就说明产物不是手抄进来的
副本——改 `src/` 而产物不变的情况会在这里红。`verify:host` 补的是迁移带来的新缺口：源码
在 `src/host/`、产物在 `lib/` 之后，「改了源码忘了重建」第一次成为可能的错误；`lib/` 如今
受版本管理（`docs/issues/19`），这道本地对拍之外，CI 的 `git diff --exit-code -- lib` 门禁
也会在推上去时看见它。

**测试树自己也有类型门禁。** 主 `tsconfig.json` 只管 `src/`（它的 `exclude` 里写着 `test`），
所以测试文件过去完全不在任何编译器程序里：套件经 Node 的剥类型加载器 import `src/**/*.ts`，
注解被抹掉，一个都没查；测试自身的 `.js` 更连解析都没发生过。`tsconfig.test.json` 是另一半——
它把测试树放进一个程序，opt-in 的测试文件用 `// @ts-check` 逐个打开，`npm run audit:test-types`
盯着这个程序。**两个程序是分开的**：`npm run typecheck` 仍然只意味着「每个 `src/**/*.ts` 是
干净的」，测试程序有自己的门禁与自己的范围。

`allowJs: true` 是让 `.js` 测试文件进程序的那一步，`checkJs: false` 是让没 opt-in 的文件
只被解析、不被检查。**别把 `checkJs` 打开在 `tsconfig.test.json` 里**：整棵树是数千条错误的
量级（今天的实测数见 `npm run audit:test-type-errors` 的输出），那需要一次有预算的迁移，不是一次
翻开关。整棵树打开的那份程序是
`tsconfig.test.budget.json`（同源、`checkJs: true`），它只用来**数债**：`npm run
audit:test-type-errors` 把整棵树的错误总数与预算比，只许降不许涨。棘轮轴从「文件数」换成
「错误数」是有理由的：给一个干净文件加 pragma，文件数 +1（有本事不要钱）；而给一个带着 60 条
错的文件 opt-in，它当场就变红（最该被看的文件进不来）；新写的测试文件带 20 条错进来，文件数
一动不动。错误预算反过来：新债一进来就被数进去。
`tsconfig.test.json` 里的 `exclude` 必须重新声明：
`extends` 会继承父配置的 `exclude`（`["node_modules","lib","test"]`），继承了之后 `include`
里的 `test` 根本不进程序，门禁会报「0 error、0 个被检查的文件」，然后一脸无辜地绿着。
pragma 的规则是实测出来的、不是猜的：只有 `//` 行注释算数（块注释里的 `@ts-check` 编译器
根本不看），token 必须在注释开头，且最后一个 pragma 赢。没 opt-in 的测试文件还剩一大半
（总数见 `npm run audit:test-types` 的输出），缺口与代价记在
`docs/KNOWN_GAPS.md` 第 10 条（测试树的类型债被记成预算）。

**绿灯不等于门禁有效。** 这几道门禁每条都用故意的破坏验过：`build` 缺关键串时会拒绝写入
（第一次构建摇掉全部模块、只剩 84 行，bundler 仍然退出 0）；`verify:host` 往 `lib/index.js`
尾上追加一行就让 `fresh` 那条红（`the artifact is stale`）并以非 0 退出；`verify:bundle` 把
探针下界从 `Math.max(0, …)` 改成 `1`，就会在 `formatCountdown|undefined|0` 上报出
`00:00:00` → `00:00:01` 并以非 0 退出；`audit:test-types` 有四种破法——摘掉某个文件的
`// @ts-check`（棘轮立刻点名「opt-in 的文件数低于下限」）、给已 opt-in 的文件塞一个类型
错误（tsc 点名到行）、把 `tsconfig.test.json` 的 `exclude` 加回 `test`（逐个点名「这个文件
opt-in 了却不在程序里」）、在前导区补一行 `// @ts-nocheck`（点名「这个文件的检查被静默关掉
了」）；`audit:test-type-errors` 有三种破法——把 `tsconfig.test.budget.json` 的 `checkJs` 翻成
`false`（债数塌成 0、门禁从此永远绿）、把 `tsconfig.test.json` 的 `include` 里的 `test` 删掉
（测试树整个离开程序、债数同样塌成 0），或者把上限本身悄悄抬高（账本对不上，门禁当场点名
「这个阈值没有记录」）——三种都会被当场点名。四道门禁的阈值都住在
`scripts/ratchet-ledger.json` 里，所以「抬阈值」永远是一笔带理由的记账，而不是改一行常量：
单独改账本里的 `value`、不补一条 `changes`，门禁立刻红（`the ratchet ledger is not
consistent`）。怀疑门禁时照这个法子再破一次，比看它绿不绿有用。

**上面那几条破法现在自己会跑。** `test/gate-mutations.test.js` 把门禁要读的那些文件复制到
`.verify-tmp/` 下的临时目录（**检出本身一个字节都不动**，所以它可以和别的套件并行跑），在副本
上破一道门禁，要求那道门禁**自己**变红、并且用它自己的话作证（`the build is incomplete` /
`the artifact is stale` / `does not behave like its baseline` / `the debt is above the ceiling` /
`the ratchet ledger is not consistent`），再跑一遍没破的副本当对照，
证明红是这次破坏造成的、不是本来就在红。债那条的破法是往副本里塞一个带类型错误的测试文件
（债真的涨了），账本那条是把账本里的上限改大却不记账（门槛被人悄悄抬了）。副本留在仓内是有原因的：`verify:host` 与
`verify:bundle` 从 git 和 `node_modules` 读基准，放在系统临时目录里两道门禁都会因为
「找不到基准」而直接放行——那正是这道测试要抓的空转绿。怀疑门禁时照上面的法子再破一次仍然
有用；只是想确认门禁还活着，让这道测试跑一遍就行。

`npm run build` 需要构建器（`tsdown`），它是 devDependency，跑之前先 `npm install`。
**测试与 `typecheck` 都不需要 `lib/`**：测试直接 import `src/**` 的源码（Node 原生剥类型），
`verify:host` 在没有 `tsdown` 时打印一声响亮的 SKIP 并以 0 退出。

两条关于这道 SKIP 的实话，免得它被当成 CI 的实际路径：

- **CI 永远走不到 SKIP**：两个 job 都是先 `npm install` 再 `npm run build`，`tsdown` 一定在。
  那是给裸检出直接 `node scripts/verify-host-bundle.mjs` 的人准备的。
- **`npm run verify` 也走不到**：它自己的 `build` 那步就需要 `tsdown`，会先在 `build` 失败。
  换句话说，这一条**不可能**靠跳过而"绿着通过"。

`verify:bundle` 另有一条容易误读的性质，2026-10 起它的行为是：baseline **不再默认取 `HEAD`**
（CI 的 `build` job 先跑 `npm run build`，那时 `HEAD:lib/client.js` 就是工作树产物本身，跟自己比
必然 IDENTICAL，什么也没证明），而是**自动回溯历史（上限 80 条），选最新一条 `lib/client.js`
与工作树不同的提交**作为 baseline——「最新的、其产物与我不一样的那个 ref」才是这个问题该有的
问法。固定的 ref（比如 `HEAD^`）是错答案：`lib/client.js` 大多数提交根本没碰（本分支上曾连续
24 条提交都相同），任何固定 ref 都可能恰好逐字节相同。回溯无果（80 条内全相同，或浅克隆没有
历史可走）时退回 `HEAD`，而那是一次**失败而非放行**：`FAIL (vacuous)` 并 exit 1，浅克隆分支
还单独报出（修法是给 checkout 加 `fetch-depth: 0`，CI 的 `build` job 正是为此设置的；修法恰好
相反——走完全相同是传一个显式 ref，浅克隆是改 checkout，所以分开报）。确需跨大距离对照某份
已发布产物时仍传 `--baseline <ref>`。

对拍覆盖不到渲染：JSX 被 stub 成 `null`，所以**改了 UI 仍然要在浏览器里看一眼**（展开卡片 →
切区域 → 改图像档位 → 保存 → 看错峰倒计时）。

### 卡片侧测三层，别互相替代

卡片的可编辑逻辑（`dirty` / `save` / `discard`、staged 与 saved、per-region 允许清单、名称
过滤）住在 `src/client/controller.ts` 的 `QoderCardController` 里，是个**纯类**——不 import
React、不碰 DOM、不发 `fetch`。这不是顺手为之，是为了让测它不需要浏览器：

| 层 | 测什么 | 跑在哪里 |
|---|---|---|
| `test/controller.test.js`（16 条） | 状态机的**规则**：什么时候算 dirty、拒绝写入怎么呈现、discard 回滚到哪、auto 怎么写最小、过滤为什么只窄化视图 | 裸 `node:test`，无 jsdom、无 React |
| `test/card-dom.test.js`（9 条） | **产物级**渲染接线：`QoderPluginCard` 真的把快照渲染成了用户看见的 DOM、按钮 disabled 条件对不对 | jsdom，驱动 `lib/client.js`（出货包） |
| 浏览器手动 | 视觉与交互手感（样式、错峰倒计时动效） | 人类 |

规则在 controller、接线在 card-dom，**两者都在 CI 里**，谁都不能替谁：只测 controller 会漏掉
「快照没接到 JSX」这种接线错误，只测 card-dom 会把状态机的每条规则塞进 jsdom、慢且脆。改
规则去 `test/controller.test.js`，改渲染去 `test/card-dom.test.js`——一条规则同时出现在两个
文件里，通常是抽得不够干净，而不是「保险起见各写一遍」。

`useSyncExternalStore` 的签名（含「为什么 `subscribe` / `getSnapshot` 必须做箭头属性、
`getSnapshot` 为什么必须引用稳定」）写在 `src/client/react-shim.d.ts` 里，改 store 接口先看
那段注释。

`.npmrc` 里的 `legacy-peer-deps=true` 是必需的、不是随手加的：本包的 peer 依赖是
`@deepseek-ai/*`，由宿主在运行时提供，不在公共 registry 上，npm 自动安装 peer 会在装到
devDependencies 之前就失败。

**本机两份安装形态不同、这是有意的**：`web` profile 是指向本仓库的符号链接（开发态，改完刷新
即生效）；`desktop` profile 走 **npm 官方安装**，与真实用户同形态，跑的是已发布版。桌面端要试本地
代码：`dsh plugin add <本仓库路径> --profile desktop`。
（形态定义与"版本号相同 ≠ 内容相同"这条坑见 [AGENTS.md](https://github.com/eghrhegpe/dsh-connect-qoder/blob/master/AGENTS.md)「工作目录与装载方式」。）

CI 在 Node 22.19 / 24 × Ubuntu / Windows 上跑（`.github/workflows/test.yml`）——
Windows 不是冗余：shim 绑定回环监听、目录缓存依赖 rename 覆盖、凭据读取要调
PowerShell，这些在别的平台上行为不同。

测试只用 Node 内置的 `node:test`，不需要安装任何依赖——**也不需要安装 peer 依赖**，
这是刻意的：`src/host/` 中凡是纯逻辑的部分都放在无 peer 依赖的模块里（见上表），
这样它们才能被直接 import 并断言真实的实现，而不是在测试里手抄一份。

几个文件存在的理由，都是因为曾经出过问题：

- `test/catalog-fields.test.js` 与 `test/model-row.test.js` —— 错峰机制曾因
  `promotion.active` / `promotion.timezone` 在 Host 投影时被丢掉而全程哑火，
  而当时的测试是绿的，因为它测的是自己手抄的副本。同一个毛病在客户端又犯过一次：
  卡片自己算窗口时漏看 `promotion.active`，把**拿不到**的折扣价显示给用户，
  而模型选择器按 `before` 价计费，两个界面自相矛盾。
  `model-row.test.js` 现在逐状态对拍两个门控；`client-bundle.test.js` 更进一步，
  直接从产物里提取卡片的 `offPeakState` 并执行——删掉那行门控会让它变红，
  而只会让 `model-row.test.js` 保持绿色。**副本不是防线。**
- `test/credential-cache.test.js` —— 「重新登录无需重启」这条卖点的完整链路：
  网关拒绝 → 谓词判定 → 置失效标志 → 下次请求重读。此前只有两端被测。也覆盖
  env-PAT 兑换的 429 节流闸门：平台自述窗口被 honour、窗口内的 poll 不重探
  （兑换计数是证据）、二次拒绝指数翻倍、401/403 停泊仅「重读登录」释放、5xx 不闸门。
- `test/exchange-throttle-e2e.test.js` —— 上面那条闸门的端到端版：真实的
  `exchangePat` 走 `fetch` 打到真实 fake platform，「poll 有没有重探」的答案是
  fake 自己的请求计数器，而不是插件自述。与姊妹插件的 429 e2e 同一标准。
- `test/throttle-store.test.js` —— 节流闸门的磁盘持久化，用真实临时目录跑：
  未过期的 rate-limit 窗口跨重启读回、parked 与令牌一律不落盘、过期窗口在读取时
  丢弃、原子写不留半截文件。
- `test/credential-invalidation.test.js` —— 上面那条链路上的两个纯谓词。
- `test/account-state.test.js` —— 账号状态四档判定（`src/host/account-state.ts`）：
  全注入的存储读器 + 真实临时目录跑目录存在性检查，钉住「判定只信本地证据」
  与「状态记录不含任何凭据材料」两条不变量。
- `test/credential-kind.test.js` —— 「这个版本现在是谁在服务」这句话曾经**只有卡片能猜**：
  宿主把桌面端与插件自有两条凭据并列上报，卡片靠 `source` 字段反推，而 `source` 只在
  「桌面端 → PAT」的读取链里产生，插件自有登录那条永远不出现——桌面端登录一过期，
  卡片就显示成"没登录"。现在宿主是唯一知道实际解出哪条凭据的一方，它把答案写成
  `credentialKind`（`desktop` / `device` / `env`）随账号面板与 status 路由上报，
  卡片不再猜。这个文件钉住三档命名、缓存解析前后的取值，以及「宿主还没解析出凭据时
  那个键不出现」（出现了就成了另一种撒谎）。
- `test/oscrypt-unwrap.test.js` —— OSCrypt 链（`src/host/oscrypt-unwrap.ts`）曾经
  **只有一台装了 Qoder 的 Windows 机器能测**：解包要真 PowerShell、真 DPAPI、真登录态，
  于是「临时目录建好 → 标记写好 → 交接文件读回 → 失败路径」这一段在覆盖率报告里长期
  是空的。两个解包入口现在都接受注入的 spawner，测试用假 spawner 写出与真解释器同形的
  交接文件，于是这些环节在任何机器上都能跑。这个文件钉住：子进程拿到的 key 就是调用方
  拿到的 key、成功与**每一条失败路径**都不留临时目录（明文主密钥不能活过这一次调用）、
  子进程永远看不到用户的 PAT、解释器是绝对路径的系统 PowerShell、非 Windows 主机
  拿到的是「为什么读不了」而不是一句「没登录」，以及清零会覆盖字节、且拒绝清零不是
  普通文件的目标（越界那条红线）。
- `test/mutation-gates.test.js` —— 「这些闸门到底有没有被测住」以前只能靠人读代码：
  断言走通路径的测试，删掉闸门照样全绿。这个文件把「改坏 → 看是否变红」变成门禁：
  它把 `src/host/oscrypt-unwrap.ts` 的**副本**里的一道闸删掉（不碰检出本身），再跑
  真正守着它的那套测试，要求变红，**且红在守这道闸的那条断言上**。当前钉住 sweep 的
  五道闸（不跟随联接、联接碰撞必须上报、身份标记、目录恰好两件、32 字节主密钥）、
  年龄闸，以及 `zeroOutFile` 的「必须是普通文件」与「必须真的写零」；每次先跑一遍
  不删闸的对照，副本必须全绿，否则这套结论就是空的。
- `test/errors-classify.test.js` —— 105 与 10605 的优先级决定了「提示用户重新登录」
  还是「排队等待」，两者弄反的代价完全不同。
- `test/settings-save.test.js` —— DSH 0.2 代上 `set()` 会静默成功而不落盘；
  这段代码用「写入→读回→深比较」把假成功变成显式失败，测试里直接模拟
  「`mutate` 成功但文档没变」的那个场景。也钉住了两件靠肉眼会漏的事：
  命名空间只做全等匹配（`llm-qoder-extra` 不算我们的），字段白名单用
  `Object.hasOwn`（`constructor` 不是一个字段）。
- `test/pi-model.test.js` —— `toPiModel` 抽离成纯函数后的直接覆盖：
  `compat.supportsDeveloperRole: false` 与「不声明 `maxTokens`」这两处，
  失效时每个请求都会 403，或长回复被截成 `finish: max-tokens`。
- `test/catalog-store.test.js` —— 目录缓存的原子落盘，用真实临时目录跑，
  在 CI 所在的平台上实测 `rename` 覆盖行为，而不是在注释里假设。
- `test/shim.test.js` —— 回环端点的鉴权与 `/v1/models` 过滤；对着真实
  HTTP 服务器说话，Host 头用裸 socket 发送（`fetch` 禁止设置该头）。
- `test/oscrypt.test.js` —— 凭据解密往返；夹具用真实 AES-256-GCM 构造，
  key 是固定哈希，失败可复现。
- `test/upstream-protocol.test.js` —— 编码与签名。两个盲区是**原理上不可测**的，
  已在文件头写明。
- `test/upstream-messages.test.js` —— 消息与工具调用翻译，注释里自称
  「最重要的一件事」，此前零覆盖。
- `test/docs-markdown.test.js` —— `docs/docs-qoder-cn/*.md` 是**一次性转换的产物**：
  `convert-qoder-docs.ps1` 把抓回的原始资料洗成纯 Markdown，随后**原始 `.txt` 被删除**，
  于是「转换是否忠实」在事后无法从内容本身判断，而 `docs-facts.test.js` 只管散文断言、
  不读这个目录。2026-10 因此放过去两类静默污染：转义顺序写反（先 `<` 后 `&`，把刚生成的
  `&lt;` 二次转成 `&amp;lt;`）让两段「Temporarily hidden … Keep for restoration」的隐藏
  注释渲染成可见文本，同一 bug 又把链接里的 `\&` 转成 `\&amp;`、弄坏三个订阅链接。
  门禁只查转换器真能损坏的形状（双重转义、注释开合、围栏配对、MDX 残留），并带**存活守卫**
  （文件数与最小长度）——否则目录被改名或清空时，循环跑零次、门禁照样全绿。

尚未覆盖的部分集中登记在 `docs/KNOWN_GAPS.md`，不在各文件里重复叙述——
重复三处正是「手抄副本」那类问题的文档版。

## 免责声明

仅供个人学习研究使用，仅驱动使用者自己的 Qoder 账号在本机调用。使用者需遵守 Qoder 的服务条款，
因使用本项目产生的后果由使用者自行承担。本项目与 Qoder、DeepSeek 均无关联。

插件除「每日签到」外的所有请求都是只读的；签到是它唯一会对 Qoder 账号产生变更的操作（领取 Qoder
正在**向你自己的账号**发放的额度），它不会自动执行，每次都要手动点击。是否使用它、以及它是否符合
Qoder 当前的服务条款，请自行判断。

## 许可证

MIT，全文见 [LICENSE](./LICENSE)。

第三方内容与出处（`docs/docs-qoder-cn/` 的 8 份官方文档转换件、上游产品与开发期工具链）逐项见
[THIRD_PARTY_NOTICES.md](https://github.com/eghrhegpe/dsh-connect-qoder/blob/master/THIRD_PARTY_NOTICES.md)
（同样**不随 npm 包发布**）。
