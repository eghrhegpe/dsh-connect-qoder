# AGENTS.md — AI 会话纪律

给 AI 协作会话的第一站。不重复 `docs/` 的内容，只钉死：**去哪参考、怎么验证、什么红线**。
每次会话先读本文件；想最快上手，先跳到「探索顺序」按任务挑一条路，再回来读下面的纪律。

> 通用纪律底座（并行会话纪律 / 评审纪律 / 验证约定）与兄弟插件共用，见 `AGENTS.common.md`（改了要回灌其余四仓同名文件）。

## 探索顺序（按任务挑一条路，别从头读到尾）

AGENTS.md 是**纪律文件**不是**教程**：它钉死红线、验证、导航，不教一步步做。按你当下的任务，
照下面一条路走最快；每条都给「先读 → 再读 → 动手前确认」三段式。

> **不知道自己是什么任务，只知道"它坏了"？** 别读这张表，直接去
> [`docs/howto/symptom-triage.md`](docs/howto/symptom-triage.md)——那份文件按**屏幕上的原文**
> 排（`已保存（未确认）`、`上次更新：{time}（刷新失败）`、模型标着「免费」…），
> 用界面上那句话 Ctrl+F 就能落到结论。下面这张表是按**你要做什么**组织的，
> 对"它坏了"没有入口。

| 你的任务 | 第一站（先读） | 第二站（再读） | 动手前确认 |
|---|---|---|---|
| **它坏了 / 用户报了个现象** | [`docs/howto/symptom-triage.md`](docs/howto/symptom-triage.md)（按症状） | `docs/howto/plugin-error-where-to-look.md`（分清进程） | 先用界面原文定位，别按模块名猜 |
| 改 host 逻辑 / 加路由 | 本文件「三条事实」「红线」 | `docs/issues/README.md` 索引找对应 NN | `npm run build:host` + 补/读对应 `test/*-test.js` |
| 改 client 卡片 / 构建 | 本文件红线 3、构建注释 | `scripts/build-client.mjs` 头部 + `docs/issues/03`、`17` | `npm run build:client` 闸门不得 bypass |
| 排查"为什么没生效 / 报错" | `docs/howto/plugin-error-where-to-look.md` | `docs/howto/host-version-probe.md` | 先分清 Host 进程 vs Client 控制台 |
| 动凭据 / 临时目录 / OSCrypt | 本文件红线 2 | `docs/issues/01`、`02`（越界与残留两类事故） | 改完必带越界 + 残留两类测试 |
| 动设置激活 / 双 region 写入 | 本文件三条事实 1、红线 4 | `docs/history/0.5.0-abi-cutover.md` | 写设置带完整 map，不丢兄弟区 |
| 发版 / 上架 | `RELEASING.md`（唯一权威） | `awesome-dsh-plugin-submission/` + 根 `README`/`CHANGELOG` | 状态判定表 + 人机 handoff 契约 |
| 通览事故史 / 接手维护 | `docs/PLAN.md`（P0–P3 总览） | `docs/KNOWN_GAPS.md`（当前缺口） | module-mocks 在 Node 24.16 实测不可行，别再排那坑（#1/#2 已证） |

下面两张大表（「去哪参考」「去哪查」）是**第二层字典**——路走了一半、要定位某个具体文件或细节
时才去翻，不必一开始通读。

## 项目一句话

DSH 插件：把本机已登录的 **Qoder**（国内版 `qoder-cn` / 国际版 `qoder`，两个独立 provider）
的模型、额度与每日签到接入 DeepSeek Harness。Host（Node/cordis）负责读 Qoder 桌面端登录态、
起 loopback shim、注册 provider 与本地路由；Client（React bundle）渲染 Plugins 页的设置卡片。

**三条事实**（写代码前先认清你在动哪一条）：

1. **双 region 是两根平行的线**：账号、凭据、用量、模型目录、勾选草稿全部按 region 隔离；
   切 tab 不允许影响另一侧。`enabledRegions` 等设置保存必须带**完整 map**（host 可能是逐区合并，
   也可能整字段替换，两种宿主都不能丢兄弟区，见 `src/client/card.tsx` 的 `toggleRegion` 注释）。
2. **本插件不持有用户密码**：凭据来源按优先级是 Qoder Electron 应用的本地登录态（OSCrypt 解密）、
   **插件自己的设备登录令牌**、或 `QODERCN_*` / `QODER_*` 环境变量 PAT。前两条差别很大：桌面端的
   凭据只读打开、插件不留副本；设备登录那条是**插件唯一自己持有的凭据**，存在
   `$DSH_HOME/.qoder-auth.<region>.json`（`0600`、按 region 分文件、读-改-写整体串行）——
   动它要同时考虑越界、残留与并发，见 `docs/issues/21-device-login-credential-source.md`。
   解密主密钥会在 `%TEMP%` 短暂明文落盘，清理逻辑有过
   **越界删空插件目录外文件**的 P0 事故——动凭据/临时目录代码前必读 `docs/issues/01`、`02`。
3. **client 源码是逆向恢复的**：`src/client/` 由已发布的 `lib/client.js` 机械还原
   （`docs/issues/17`），当时的形态是手写 `(0, react_jsx_runtime.jsx)(…)` 调用而非 JSX 语法。
   **那段历史已经收尾**：渲染层 6 个组件现在全是 `.tsx`（`card.tsx` / `account-panel.tsx` /
   `composer-usage-pill.tsx` / `device-login-panel.tsx` / `usage-panel.tsx` /
   `token-history-chart.tsx`），那种调用写法在源码里只剩 `src/client/react-shim.d.ts`
   的注释还提着一句。剩下 13 个 `.ts` 不是"没迁完"，而是**结构上不能迁**：套件用裸
   `node --test` 直接 import `src/**/*.ts`，Node 的剥类型加载器不认 `.tsx`
   （实测 `ERR_UNKNOWN_FILE_EXTENSION`），所以凡是测试会直接 import 的模块必须留在 `.ts`。
   别把规则层"顺手迁回" `.tsx`，也别把还原期的写法当新代码风格扩散。
4. **宿主 ABI 只认 0.2 代**（0.5.0 起）：`installSection`/`settingsScope` 双探测与
   `asVolatile` 退化已删——宿主 0.2.0-rc.x 实测已无这两个面。peer 下限 `>=0.2.0-rc.0`
   是刻意的（宿主用 `includePrerelease` 判兼容，`>=0.2.0` 会把 rc 挡在门外）。
   取证与决定记录在 `docs/history/0.5.0-abi-cutover.md`；别把旧 ABI 分支"顺手"加回来。

## 工作目录与装载方式（先搞清你改的东西怎么生效）

- 本目录 `~/.dsh/plugins/dsh-connect-qoder` 是**开发副本**，web 端以符号链接载入：
  `~/.dsh/profiles/web/node_modules/@eghrhegpe/dsh-connect-qoder` → 本目录。
- 浏览器与 Host 实际执行的是 **`lib/` 产物，不是 `src/`**。只改 `src/` 不 rebuild，界面不会变。
- **两个 profile 的装法不同，这是有意的，别当漂移去追**：web 是 `link:` 到本目录（开发态，改完
  刷新即生效）；desktop 走 **npm 官方安装**（`profiles/desktop/package.json` 里是
  `"@eghrhegpe/dsh-connect-qoder": "<已发布版本>"`），与真实用户同形态，跑的是**已发布版、不含本仓库
  未发布的提交**——两边 `version` 相同 ≠ 内容相同，那是"版本陷阱"而不是缺陷。桌面端要试本地代码
  才临时 `dsh plugin add <本仓库路径> --profile desktop`（那会破坏"官方安装"这个形态）。
  以 `~/.dsh/profiles/{web,desktop}/node_modules` 里的实际形态为准，别信文档。
  曾有的 `verify:deploy` 漂移检查已于 2026-10-20 删除（它从不在 `npm run verify` 与 CI 里）。
- `lib/client.js` 头部自带「Generated … edit the sources, not this file」——**禁止手改产物**。
- `lib/` 是**受版本管理的产物**（`docs/issues/19`）：改 `src/` 后 `npm run build` 并把 `lib/`
  与源码**同一次提交**。这是 DSH 市场 `github:` 源安装能开箱即用的前提（不入库装出来的插件
  没有宿主入口）；也意味着 `lib/` 永远不许加回 `.gitignore`。

## 去哪参考（本机就有，别再全网瞎找）

| 要找什么 | 位置 |
|---|---|
| **同类插件实载副本**（含完整源码仓库的：sensenova / agnes 带 `src`、`AGENTS.md`、`upstream/`） | `~/.dsh/profiles/web/node_modules/` |
| **本卡片的设计母版**（双 region tab 栏的原始形态，正经 `.tsx` 工程） | `~/.dsh/profiles/web/node_modules/dsh-connect-sensenova-token-plan/upstream/dsh-connect-workbuddy-main/`，卡片在 `src/client/WorkBuddyCard.tsx` |
| 桌面端安装版（含全部官方包 asar） | `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`（asar 头偏移：JSON 长度 @12，内容 @16） |
| 官方纯 React 组件库 | asar 内 `dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives`（导出 `Button/Switch/Checkbox/Input/Pill/SegmentedControl/SegmentedTabs/StateDot/Tooltip/Modal…`，零 cordis，读 `--dsw-*` token） |

**用官方组件的规矩**：在 `package.json` 的 `dsh.client.inject` 加包名，并让 client 构建把它
external（参照已 inject primitives 的 `dsh-connect-workbuddy`）。注意生态现状：workbuddy 虽
inject 了 primitives，其 bundle 实际零引用、tab 栏仍自绘——引入前先确认运行时真能拿到包，
不要凭"声明了 inject"当证据。自绘新控件前先查 primitives 目录，官方有的不许拷贝一份。

## 验证（按域裁剪，禁止无脑全量）

```bash
npm run typecheck          # tsc -p tsconfig.json
npm test                   # node --test "test/*.test.js"（裸 node，套件直接 import src/*.ts，
                           # 靠 Node 22.19+/24 原生 strip types；无需安装也能跑）
npm run test:card          # 只跑 jsdom 卡片 DOM 测试 test/card-dom.test.js
npm run audit:any          # 两道隐式/显式 any 审计，client 改动容易踩
npm run audit:test-types   # 测试树的类型门禁（tsconfig.test.json）：opt-in 文件数棘轮 +
                           # 编译器真的报了 opt-in 文件的错误 + opt-in 文件真的在程序里
npm run build              # 重建 lib/（host bundle + client bundle），改 src/ 后必跑；
                           # 重建后把 lib/ 与 src/ 同一次提交（CI 新鲜度门禁会查，docs/issues/19）
npm run verify             # typecheck + 两道 any 审计 + 测试树两道类型门禁 + build + test +
                           # 市场条目核验 + host/bundle 行为核验
```

- **改 client 后**：`npm run build:client`（= `scripts/build-client.mjs --tsdown --write`）。
  该脚本有 REQUIRED-string 闸门：bundle 被 tree-shake 成壳会直接拒写，别绕过
  （这是 issue 03 事故换来的，曾经 16 字节桩替换掉整个卡片而构建"成功"）。
- **改 host 后**：`npm run build:host`；`verify:host` / `verify:bundle` 是产物级行为比对。
- 覆盖率门槛：lines 68 / branches 82 / functions 66（`npm run test:coverage`），只看自己域的增减。
- **测试树有两个程序，别混**：`tsconfig.json` 只管 `src/`（它的 `exclude` 里写着 `test`），
  `tsconfig.test.json` 管测试树。`npm run typecheck` 绿**不等于**测试文件被检查过——套件是经
  Node 的剥类型加载器 import `src/**/*.ts` 的，注解一个都没查。想让某个测试文件进类型检查：
  在**前导区**写 `// @ts-check`（只认 `//` 行注释；块注释里的 `@ts-check` 编译器不看；token
  必须在注释开头；最后一个 pragma 赢；写在 import 之后无效），并把 opt-in 集合的棘轮下限
  一起抬（记账规则与阈值单一真源见 `docs/ratchet-ledger.md`）。
- 类型门禁与四道阈值的棘轮记账机制（opt-in 下限、测试树错误预算、两道 any 预算）见
  `docs/ratchet-ledger.md`：`scripts/ratchet-ledger.json` 是阈值单一真源，改阈值 = 记一笔账
  （from/to、日期、理由），账实不符门禁当场红（`the ratchet ledger is not consistent`）。

## 红线（违反任一都会炸到用户机器）

1. **不新增静默失败分支**（issue 16 的门禁）：这个插件的事故史几乎全是"失败不发声"型——
   目录冻结却显示"已更新"、假"已保存"、读不出凭据统一说成"没登录"。新失败路径必须给用户
   可见的错误或显式降级，不许 catch 后吞掉。
2. **OSCrypt 临时材料与目录清理**：sweep 只许清理插件自己拥有的 `%TEMP%\qoder-oscrypt-*`，
   跟随 junction/symlink 删除即越界（issue 01 曾把目录外文件清成 NUL）；`key.b64` 明文残留
   的回收窗口见 issue 02，改清理逻辑必须带越界与残留两类测试。
3. **client 产物必须包含卡片实体**：不得手改 `lib/client.js`；构建闸门里的 REQUIRED 字符串
   （组件、路由、jsx-runtime shim）一个都不能少。
   `lib/` 是受版本管理的产物（`docs/issues/19`）：改 `src/` 后必须 `npm run build` 并与源码
   同一次提交，CI 新鲜度门禁会拦漂移；**不许把 `lib/` 加回 `.gitignore`**——那会静默打断
   DSH 市场 `github:` 源安装（装出的包没有宿主入口）。
4. **双 region 写设置带完整 map**；切区/关区不得丢另一个区的账号、勾选与草稿。
5. **主题 token 用宿主真实名字**：`--dsw-alias-state-warn-primary` 是缩写形式（长式
   `warning` 从未定义），自定义属性拼错不会报错只会静默落 fallback——新增 token 先核对
   宿主 CSS，`styles.ts` 里有完整取证注释。

## 评审纪律（锐评代码 / 给质量结论前）

通用四条（量化可复现 / 先读裁定再读代码 / 无罪搜索 / 结论四级）见 `AGENTS.common.md` §评审纪律。
本仓补充（与通用四条并列）：

- 本插件事故史几乎全是「失败不发声」型（见红线 1），评审时这条是头号靶子。
- **门禁全绿不等于没事**：`npm run typecheck` 绿不等于测试文件被检查过（测试树是另一个程序，见「验证」）；`lib/` 产物级行为比对只比字节不对语义。这类只能靠读代码 + 按域 targeted 复跑定性。
- **先划轴，再读文件**：评审是读密集型活。开读前先定 2–3 条高价值轴（如「这次改动动了哪条红线」「新失败路径有没有发声」），只读这几条轴涉及的文件；逐文件通读会把上下文烧光。

## 并行会话纪律

核心条款（不碰 `git stash`/`push`/`pop`、路径限定提交、`git status --short` 复核、同文件被两会话改着的处置、untracked 新文件先 `git add`）见 `AGENTS.common.md` §并行会话纪律。
本仓补充：本文件建立时就有另一会话在做 `card.ts → card.tsx` 迁移，所以「同文件被两会话改着」不是理论——优先等对方提交。

## 去哪查（docs/ 地图）

**完整地图只有一份：[`docs/README.md`](docs/README.md)**（每份文档一行「何时查」）。这里只留最高频的四条，其余都在那张表里：

| 何时 | 查 |
|---|---|
| **它坏了 / 只有现象、没有模块名** | `docs/howto/symptom-triage.md`（按**界面原文**排；先查这份再说） |
| 动手前通览事故史与优先级 | `docs/PLAN.md`（P0–P3 总览，三条本机实测事故在 §0） |
| 改某个已知问题前 / 提 issue | `docs/issues/README.md`（按编号与状态排的索引——份数以它为准，别写死） |
| 改验证阈值 / 棘轮账 | `docs/ratchet-ledger.md` + `scripts/ratchet-ledger.json`（阈值真源） |

其余（`docs/KNOWN_GAPS.md`、`docs/docs-qoder-cn/` 平台事实、宿主版本探测、报错去哪个进程、`docs/history/`、根目录 `RELEASING.md` 与上架材料）见 `docs/README.md`。
