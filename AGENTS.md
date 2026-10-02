# AGENTS.md — AI 会话纪律

给 AI 协作会话的第一站。不重复 `docs/` 的内容，只钉死：**去哪参考、怎么验证、什么红线**。
每次会话先读本文件；细节按下面的文档地图跳。

## 项目一句话

DSH 插件：把本机已登录的 **Qoder**（国内版 `qoder-cn` / 国际版 `qoder`，两个独立 provider）
的模型、额度与每日签到接入 DeepSeek Harness。Host（Node/cordis）负责读 Qoder 桌面端登录态、
起 loopback shim、注册 provider 与本地路由；Client（React bundle）渲染 Plugins 页的设置卡片。

**三条事实**（写代码前先认清你在动哪一条）：

1. **双 region 是两根平行的线**：账号、凭据、用量、模型目录、勾选草稿全部按 region 隔离；
   切 tab 不允许影响另一侧。`enabledRegions` 等设置保存必须带**完整 map**（host 可能是逐区合并，
   也可能整字段替换，两种宿主都不能丢兄弟区，见 `src/client/card.tsx` 的 `toggleRegion` 注释）。
2. **本插件不持有用户密码**：凭据来源是 Qoder Electron 应用的本地登录态（OSCrypt 解密）或
   `QODERCN_*` / `QODER_*` 环境变量 PAT。解密主密钥会在 `%TEMP%` 短暂明文落盘，清理逻辑有过
   **越界删空插件目录外文件**的 P0 事故——动凭据/临时目录代码前必读 `docs/issues/01`、`02`。
3. **client 源码是逆向恢复的**：`src/client/` 由已发布的 `lib/client.js` 机械还原
   （`docs/issues/17`），历史形态是手写 `(0, react_jsx_runtime.jsx)(…)` 调用而非 JSX 语法，
   2026-10 起在向 `.tsx` 迁移。看到这种写法不要当成新代码风格继续扩散。
4. **宿主 ABI 只认 0.2 代**（0.5.0 起）：`installSection`/`settingsScope` 双探测与
   `asVolatile` 退化已删——宿主 0.2.0-rc.x 实测已无这两个面。peer 下限 `>=0.2.0-rc.0`
   是刻意的（宿主用 `includePrerelease` 判兼容，`>=0.2.0` 会把 rc 挡在门外）。
   取证与决定记录在 `docs/history/0.5.0-abi-cutover.md`；别把旧 ABI 分支"顺手"加回来。

## 工作目录与装载方式（先搞清你改的东西怎么生效）

- 本目录 `~/.dsh/plugins/dsh-connect-qoder` 是**开发副本**，web 端以符号链接载入：
  `~/.dsh/profiles/web/node_modules/@eghrhegpe/dsh-connect-qoder` → 本目录。
- 浏览器与 Host 实际执行的是 **`lib/` 产物，不是 `src/`**。只改 `src/` 不 rebuild，界面不会变。
- 桌面端走安装副本；以 `~/.dsh/profiles/{web,desktop}/node_modules` 里的实际 junction 为准。
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
npm run build              # 重建 lib/（host bundle + client bundle），改 src/ 后必跑；
                           # 重建后把 lib/ 与 src/ 同一次提交（CI 新鲜度门禁会查，docs/issues/19）
npm run verify             # typecheck + 两道 audit + build + test + host/bundle 行为核验
```

- **改 client 后**：`npm run build:client`（= `scripts/build-client.mjs --tsdown --write`）。
  该脚本有 REQUIRED-string 闸门：bundle 被 tree-shake 成壳会直接拒写，别绕过
  （这是 issue 03 事故换来的，曾经 16 字节桩替换掉整个卡片而构建"成功"）。
- **改 host 后**：`npm run build:host`；`verify:host` / `verify:bundle` 是产物级行为比对。
- 覆盖率门槛：lines 68 / branches 82 / functions 66（`npm run test:coverage`），只看自己域的增减。
- 测试数随并行会话变化，某个时点的总数不是契约。

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

## 并行会话纪律

工作树常同时有他人未提交改动（本文件建立时就有另一会话在做 `card.ts → card.tsx` 迁移）：

- **不碰 `git stash / push / pop`**（`status/log/show` 等只读可用）。
- 提交用路径限定：`git commit -m "<说明>" -- <自己的文件>`；禁 `git add -A` / `add -u`。
- 看到非自己改动的文件保持 modified，不要替它做对照实验，用同组文件 targeted 复跑定性。
- 同一文件被两个会话同时改着：优先等对方提交；必须 hunk 级提交时，`git add <文件>` 后提交
  索引（**不要** `git commit -- <路径>`，那会把工作树里对方的半改一起写入）。
- 提交后 `git status --short` 复核：没带走别人的东西。

## 去哪查（docs/ 地图）

| 何时 | 查 |
|---|---|
| 动手前通览事故史与优先级 | `docs/PLAN.md`（P0–P3 总览，三条本机实测事故在 §0） |
| 改某个已知问题前 | `docs/issues/README.md` 索引 → 对应 `docs/issues/NN-*.md`（19 份，含证据 file:line 与验收标准） |
| 改 client 构建/产物链路 | `scripts/build-client.mjs` 头部注释（loader ABI、字节比对、REQUIRED 闸门都是契约）+ `docs/issues/03`、`17` |
| 市场 `github:` 源安装 / lib 为何入库 | `docs/issues/19`（pnpm 11 allowBuilds 审批流 + 本机 profile 实锤；CI 新鲜度门禁在 `.github/workflows/test.yml`） |
| 发版前 | `RELEASING.md`（根目录：唯一权威发布流程——状态判定表、不可逆点、人机 handoff 契约；母版为 sensenova 兄弟插件同名文档） |
| 了解已知差距与未做项 | `docs/KNOWN_GAPS.md` |
| 对 Qoder 平台事实（计费系数、Credits、签到、免费模型） | `docs/docs-qoder-cn/`（上游官方文档转换件） |
| 探测宿主版本/协议漂移 | `docs/howto/host-version-probe.md`、`test/protocol-drift.test.js` |
| 排查报错去哪看（Host 进程 vs Client 控制台；本插件非"永远 200"） | `docs/howto/plugin-error-where-to-look.md` |
| 动设置激活路径 / 宿主代际问题前 | `docs/history/0.5.0-abi-cutover.md`（0.5.0 砍 0.1.x ABI 的取证、决定与"为什么下限是 `>=0.2.0-rc.0`"） |
| client 恢复源码的来龙去脉与旧补丁 | `docs/history/`（含 `restore-client-src.mjs`） |
| 上架提交材料 | `docs/submission/`、根目录 `README.md` / `CHANGELOG.md` |
