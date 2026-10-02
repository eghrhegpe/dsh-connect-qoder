# DSH Connect Qoder

把本机已登录的 **Qoder** 模型接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，
零配置即可在 DSH 的模型选择器里使用你的 Qoder 账号额度。

国内版 **Qoder CN** 与国际版 **Qoder** 是两个并行的 provider（`qoder-cn` / `qoder`），
装哪个就出现哪一组模型，两个都装就两组并存，各自使用自己的账号与额度。
<img width="1527" height="1254" alt="image" src="https://github.com/user-attachments/assets/73a691b5-0633-4090-a193-0459bbf655ae" />


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

插件复用 Qoder 桌面应用自己的登录状态，**不启动额外的 OAuth 流程，也不写入应用的文件**
（凭据文件以只读方式打开）。

Qoder 把登录信息放在 Chromium OSCrypt 格式的凭据文件里（`v10` + nonce + 密文 + tag，AES-256-GCM）。
新版（0.3.x）的凭据直接保存在 `<userData>/auth.v1.dat`，旧版（0.2.x 及更早）则放在
VS Code 风格的 `state.vscdb` SQLite 数据库里。两种布局都支持，新版优先尝试。
密文用的密钥保存在应用的 `Local State` 中，由操作系统 keystore 包裹 —— Windows 上是当前用户
作用域的 DPAPI，因此同一用户下的进程都能解开它。
Node 没有内置 DPAPI 绑定，这一步交给 PowerShell，并通过临时文件交换结果（不使用管道），
这样在禁止管道 stdio 的沙箱里同样可用。

没有桌面应用登录时，可以用官方文档的 **PAT** 兜底：设置 `QODERCN_PAT`（国内版）或
`QODER_PAT`（国际版），插件会用它换取 job token。

**平台边界：零配置路径只在 Windows 成立。** 解密链路是 PowerShell + DPAPI（`Crypt32.dll`），
`src/host/` 里没有任何 macOS / Linux 解包分支——在其它平台上应用目录**找得到**（应用数据根目录
已按平台解析，见下），但凭据读不出来（`loadCredential` 返回 `undefined`，该区域不注册），
只剩上面的 PAT 兜底。

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
macOS / Linux 用户只能走 PAT 兜底，或自行从本仓库移植。

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
> 注意：npm 上不带 scope 的 `dsh-connect-qoder` 由上游发布，**装到的是上游那份**；
本 fork 自己发的是 scoped 包 `@eghrhegpe/dsh-connect-qoder`（上面那条），二者不是同一个包。


或本地开发模式：

```sh
dsh plugin --profile web add <本仓库路径>
```

安装后需要**重启 DSH 进程**：bundle 的 patch 在启动时读取。


## 凭据安全

插件**不存储任何凭据**：

- 复用本机已登录的 Qoder 桌面应用的凭据文件（新版 `auth.v1.dat` / 旧版 `state.vscdb`，
  均以只读方式打开，不做任何写入）。
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
- **卡片接口只接受同源请求**（安全）：七条路由里三条是 POST 且能改状态——「签到领积分」
  （真实账号变更）、「保存模型勾选与图像模式」、「重读登录」。这些接口此前只按"来源主机名是不是
  本机"判断，因此**本机任意端口上的任意 HTTP 服务**都能让它的网页代为调用（浏览器会挡跨域
  读响应，但操作已经发生）。现在要求来源的**地址与端口**与请求实际拨到的地址一致
  （比对请求自己的 `Host` 头，所以不写死端口、DSH 换端口也不用改），且必须是回环地址。
  判定在 [`src/host/routes.ts`](src/host/routes.ts) 的 `loopbackRequest`，由 `test/route-gates.test.js` 覆盖。
- 依赖 Qoder 客户端接口（非官方开放 API），Qoder 更新后插件可能需要随之调整。
- **设置命名空间由宿主决定，不能自选**（0.1.7 起）：`describe()` 用 Loader 条目
  id 作为 `ns`（本 bundle 是 `llm-qoder`，不是 `dsh-connect-qoder`），而「设置 → 模型」
  页按**精确匹配**查 `namespaces.get(entry.settingsNs)`。若插件宣告的命名空间与宿主实际
  服务的不一致，该 provider 会被判为「未配置」，**整行从页面上消失**——不报错、不灰显，
  而插件本身仍在正常注册和应答，非常难查。因此 `settingsNs` 一律经
  `settingsNamespaceOf(ctx)` 从 `ctx.fiber.entry.options.id` 推导，常量只作为宿主不暴露
  条目 id 时的回落值（对齐 WorkBuddy 2.1.0 的同款修复）。
- **设置保存走插件的 `__save` 主机端点 + 读回校验**（对齐 WorkBuddy 0.1.7 修复）：DSH 0.1.7 的
  客户端 `settingsScope.set()` 在原子写重试耗尽后会**静默返回成功而不落盘**，卡片改为「主机端点
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

## 目录

| 文件 | 作用 |
| --- | --- |
| `src/host/credentials.ts` | 从 Qoder 应用读取并解密登录凭据（密钥缓存与 `Local State` 绑定、失败窗口 60 s、只读缓存的变体、**不阻塞的异步解包**） |
| `src/host/upstream.ts` | COSY 签名、请求体编码、目录与对话流 |
| `src/host/shim.ts` | 面向 pi-ai 的 OpenAI 兼容回环端点 |
| `src/host/adapter.ts` | pi-ai provider 与 `PiAiAdapter` profile（被关的 provider 以零模型组呈现，由 DSH 自行隐藏） |
| `src/host/catalog-entry.ts` | 目录条目的归一化、模型过滤（含按区域开关）与卡片行投影（无 peer 依赖） |
| `src/host/catalog-store.ts` | 目录的磁盘缓存与原子落盘（无 peer 依赖） |
| `src/host/catalog-refresh.ts` | 一次目录刷新的结果如何落地：**空目录也是结果**（照实清空并推进 `fetchedAt`），只有失败才保留上一份，且失败按 `credential` / `no-credential` / `fetch` / `protocol-shape-changed` 分档（无 peer 依赖） |
| `src/host/credential-cache.ts` | 凭据缓存与「登录失效后重读」规则，以及 env-PAT 兑换的 429 节流闸门（平台自述窗口优先、否则指数退避；401/403 停泊，仅「重读登录」释放；无 peer 依赖） |
| `src/host/throttle-store.ts` | 兑换节流闸门的磁盘持久化（只存未过期的 rate-limit 窗口、parked 停泊与令牌一律不落盘，原子写，无 peer 依赖） |
| `src/host/account-payload.ts` | 账号面板三条路由共用的那份应答：逐区域状态 + 开关映射，以及「渲染读缓存 / 重读登录读真」这一个开关（从 `index.ts` 抽出以便直测，无 peer 依赖） |
| `src/host/account-state.ts` | 每区域账号状态四档判定（`ok` / `expired` / `needs-app` / `signed-out`；纯本地证据、不含凭据，无 peer 依赖）；三种读取模式（默认 / `cachedOnly` 不解包 / `force` 忽略失败窗口） |
| `src/host/settings-save.ts` | 设置命名空间的解析（0.1.7 由宿主推导，插件不能自选）、设置写入、按区域合并与落盘读回校验（无 peer 依赖） |
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
| `src/host/volatile.ts` | 0.1.7 volatile 活引用 `{ get() }` 的解包，此前散在三处（无 peer 依赖） |
| `src/host/http-utils.ts` | 回环路由共用的 JSON / OpenAI 形状错误响应（`no-store`，卡片轮询读不到陈旧数据；无 peer 依赖） |
| `src/host/domain.ts` | 各宿主模块标注时共用的领域词表（`Region` / `CatalogEntry` / `Promotion` / `CatalogOutcome` 等）。**只有类型、没有运行时值**，所以不进产物、不改变任何 bundle 字节；刻意不描述任何 peer 模块的形状——那些包由宿主运行时提供、此处只有 `declare module` 空壳，凭空造一个"看起来对"的接口比 `any` 更危险，因为它不会承认自己不知道（无 peer 依赖） |
| `src/host/routes.ts` | 每条卡片路由共用的两道闸：方法检查（405 带 `Allow`、`HEAD` 交给 GET）与**同源**来源检查（403；比对 `Host` 头，POST 路由靠它挡住本机其它端口的网页），以及带 64 KiB 上限的 JSON body 读取器（无 peer 依赖） |
| `src/host/index.ts` | 按区域注册 provider 的插件入口，与模型/用量/保存/账号状态路由（账号路由含「重读登录」的上线与回滚） |

卡片侧的源码在 `src/client/`（产物是 `lib/client.js`，`react` 由宿主提供，产物不打包它）：

| `src/client/paths.ts` | 卡片用到的五条插件路由 |
| `src/client/styles.ts` | 卡片样式与 `installStyles`（`dsm-*` 一套与 `dsh-connect-workbuddy` 逐字一致，原因见文件头） |
| `src/client/settings-write.ts` | 「写入后读回校验」的浏览器半边 |
| `src/client/controller.ts` | 卡片可编辑状态机（staged/saved 三字段、`dirty`、`save`、`discard` 与派生的模型视图）——无 React、无 DOM，可被 `node:test` 直接测 |
| `src/client/copy.ts` | 卡片文案聚合入口（中/英），`index.ts` 与 `card.ts` 只从这里取 |
| `src/client/copy-row.ts` `copy-usage.ts` `copy-account.ts` | 按面板拆分的三段文案：模型行与错峰、用量与签到、账号与区域标签条 |
| `src/client/card.ts` | 卡片的纯函数与五个组件（`QoderPluginCard` / `QoderUsagePanel` / `QoderAccountPanel` / `RegionUsage` / `QuotaBlock`）——组件本身只做渲染接线，可编辑状态委托给 `controller.ts` |
| `src/client/index.ts` | 注册入口（`apply` / `inject` / `name`） |
| `src/client/react-shim.d.ts` | 最小 React 类型垫片（只管类型检查，不参与构建、不随包发布） |

## 构建产物：`lib/` 不是源码

**源码全在 `src/`，`lib/` 是纯构建产物，不进版本库**（`.gitignore` 里有 `/lib/`；发到 registry
的那一份由 `prepack` 现场构建）。`npm run build` 从 `src/` 重建出两个文件：

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
npm run verify          # 下面五条串起来，全过才算过
npm run typecheck       # tsc -p tsconfig.json，源码全量类型检查（0 error）
npm test                # node --test "test/*.test.js"
npm run test:coverage   # 同上 + 覆盖率门槛（行 68 / 分支 82 / 函数 66，跌破即失败）
npm run verify:deploy   # 比对已部署副本与本仓库，报告漂移
npm run build           # 从 src/ 重建 lib/（宿主 bundle + 卡片产物）
```

`npm run verify` 跑五件事，每件回答一个不同的问题：

| 步骤 | 回答什么 | 全过时的输出 |
|---|---|---|
| `typecheck` | `src/**` 的每个 `.ts` 都过类型检查 | `tsc` 退出 0、无输出 |
| `npm test` | 卡片逻辑与宿主半边没被改坏 | 最后一行 `# fail 0` |
| `build`（宿主 + 卡片） | `lib/index.js` 与 `lib/client.js` 确实由 `src/` 生成 | `MATCH: … byte-for-byte identical` |
| `verify:host` | 宿主 bundle 不陈旧、公开面与 peer 外置都还在 | `all 11 checks passed` |
| `verify:bundle` | 重建产物与上一份已发布产物的行为一致 | `behaviour: IDENTICAL` |

中间那条是最要紧的：宿主与卡片两步都**只比较、不认账**。它过了，就说明产物不是手抄进来的
副本——改 `src/` 而产物不变的情况会在这里红。`verify:host` 补的是迁移带来的新缺口：源码
在 `src/host/`、产物在 `lib/` 之后，「改了源码忘了重建」第一次成为可能的错误，而 `lib/`
不进版本库，没有别的检查会看见它。

**绿灯不等于门禁有效。** 这几道门禁每条都用故意的破坏验过：`build` 缺关键串时会拒绝写入
（第一次构建摇掉全部模块、只剩 84 行，bundler 仍然退出 0）；`verify:host` 往 `lib/index.js`
尾上追加一行就让 `fresh` 那条红（`the artifact is stale`）并以非 0 退出；`verify:bundle` 把
探针下界从 `Math.max(0, …)` 改成 `1`，就会在 `formatCountdown|undefined|0` 上报出
`00:00:00` → `00:00:01` 并以非 0 退出。怀疑门禁时照这个法子再破一次，比看它绿不绿有用。

`npm run build` 需要构建器（`tsdown`），它是 devDependency，跑之前先 `npm install`。
**测试与 `typecheck` 都不需要 `lib/`**：测试直接 import `src/**` 的源码（Node 原生剥类型），
`verify:host` 在没有 `tsdown` 时打印一声响亮的 SKIP 并以 0 退出。两者是 CI 里分开的 job：
一个证明源码自足，一个证明产物可重建。

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

`verify:deploy` 存在的理由和上面那些测试一样：**一台机器上可以同时装着好几个版本的本插件**。
`link:` 安装是指向本仓库的符号链接、永远最新；市场安装是**复制**，停在安装那一刻，
而且两边 `package.json` 的 `version` 一样——任何按版本判断新旧的升级路径都会认为「已是最新」。
该脚本比对 `lib/**` 的内容哈希、文件清单，以及三个由真实缺陷换来的标记
（错峰 `active` 门、账号状态模块、账号路由），并把「版本号相同但内容不同」单独标出来。
`test/deploy-drift.test.js` 用假目录树钉住这套判定。

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
- `test/errors-classify.test.js` —— 105 与 10605 的优先级决定了「提示用户重新登录」
  还是「排队等待」，两者弄反的代价完全不同。
- `test/settings-save.test.js` —— DSH 0.1.7 上 `set()` 会静默成功而不落盘；
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

尚未覆盖的部分集中登记在 `docs/KNOWN_GAPS.md`，不在各文件里重复叙述——
重复三处正是「手抄副本」那类问题的文档版。

## 免责声明

仅供个人学习研究使用，仅驱动使用者自己的 Qoder 账号在本机调用。使用者需遵守 Qoder 的服务条款，
因使用本项目产生的后果由使用者自行承担。本项目与 Qoder、DeepSeek 均无关联。

插件除「每日签到」外的所有请求都是只读的；签到是它唯一会对 Qoder 账号产生变更的操作（领取 Qoder
正在**向你自己的账号**发放的额度），它不会自动执行，每次都要手动点击。是否使用它、以及它是否符合
Qoder 当前的服务条款，请自行判断。

## 许可证

MIT
