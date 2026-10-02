# 发布流程（Release Flow）— @eghrhegpe/dsh-connect-qoder

> 本文档是本仓库的**唯一权威发布流程**。发布前请通读一遍。
> 母版来自兄弟插件 `dsh-connect-sensenova-token-plan` 的 `RELEASING.md`，按本仓库的事实改过——
> 差异集中在两处：**发布通道**（本仓库只有 npm 一条，不设 GitHub Release；tag 是 0.4.x 期才立的规矩）
> 与 **lib/ 入库纪律**（docs/issues/19：改 `src/` 必须与 `lib/` 同一次提交，CI 有新鲜度门禁）。

## 0. 先讲清两个常见误解——都属于「以为会自动完成」

**① 本仓库没有 release 自动化。** `.github/workflows/test.yml` 只跑测试与门禁；
`npm publish` 永远是人在终端里按下的（含 `npm login`，交互式、AI 不做代理）。

**② 各通道是独立事实，先发生不会带上其余的。** 本仓库发版涉及 **三件互相独立的事**：

| 事实 | 载体 | 谁读它 |
|---|---|---|
| 版本提交已推 | `origin/main` | CI 门禁、`github:` 源安装的克隆 |
| 版本 tag 存在 | `git tag vX.Y.Z` | 事后取证（哪版对应哪个提交） |
| npm 已发 | `registry.npmjs.org` 上的 tarball | DSH 对话框包名安装、市场页 |

注意：市场页的「更新日记」**只渲染打进 npm tarball 的 `CHANGELOG.md`**（市场不解析 git 提交、
不抓 GitHub release notes——`CHANGELOG.md` 头部写死了这条契约）。所以 CHANGELOG 的
「写好再 publish」不是客气，是功能。

## 1. 发版状态判定表（先判断，再动手）

把下面几组跑一遍，把当前状态定位到某个格子。定位错了，后面的顺序会全错。

```bash
# A. 仓库侧：tag 是否存在、指向哪里
git tag -l vX.Y.Z
git rev-list -n1 vX.Y.Z

# B. 仓库侧：版本提交是否已推（有输出 = 还有没推的提交）
git status -sb
git log --oneline @{u}..HEAD

# C. 版本文件侧
grep '"version"' package.json
head -n 10 CHANGELOG.md

# D. npm 侧
npm view @eghrhegpe/dsh-connect-qoder version --registry=https://registry.npmjs.org
npm view @eghrhegpe/dsh-connect-qoder@X.Y.Z version --registry=https://registry.npmjs.org   # 版本号是否已被占用
```

| 状态 | 特征 | 还缺什么 | 下一步 |
|---|---|---|---|
| S0 未开始 | 无 tag、npm 还是旧版 | 全流程 | 从第 1 步走完整链路 |
| S1 代码已进 main | 功能已推 main；`package.json` 尚未升版 | 版本文件、tag、npm | 先补齐 2/3/4，再走 5 |
| S2 已 tag | tag 已建已推；npm 未发 | npm | 走 5、5.5 |
| **S2′ 顺序颠倒：已 npm、未 tag** | `npm view <包>@X.Y.Z` 能查到；`git tag -l vX.Y.Z` 为空 | tag、main | **先做 §5.5 内容核验**，把 tag 指到「被核验过的那个提交」，**不要重新 publish** |
| S3 完整 | 版本提交、tag、npm 都在 | 无 | 做最终核对（§8） |

> 历史事实：0.3.x / 0.4.x 一期**一直没有打 tag**（仓库里只有 `v0.2.0`、`v0.2.1`），
> 0.4.3 也从未发布（npm 上 `0.4.2` 直接跳到下一版）。跳过/缺号都是既成事实——
> 未占用的版本号可以补发，但按惯例只往前开，不回填。

## 2. 不可逆点（动手前先记住）

1. **npm 已发布 ⇒ 该版本号不可覆盖**。目标版本若已在 npm 上，唯一正解是开 `X.Y.(Z+1)`。
2. **npm 已发布 ⇒ tag 基本钉死**。tag 一旦指向与 npm 内容不符的提交，就会出现
   「用户装到的 ≠ tag 说的」错位——所以补 tag 前先按 §5.5 做内容核验。
3. **publish 先于 tag ⇒ 取证责任转移到你身上**。正序（先 tag 后 publish）时这件事是免费的。

判断某个 tag 是否还能动：

```bash
npm view @eghrhegpe/dsh-connect-qoder versions --registry=https://registry.npmjs.org
```

目标版本已在列 → 不要移 tag，只发下一版。

## 前置条件（preflight，逐项当检查做，不当背景知识）

- **npm 登录**：`npm whoami --registry=https://registry.npmjs.org` 应返回 `eghrhegpe`。
  返回 `E401 Unauthorized` 就是没登录——此时 `npm publish` 会**先跑完 `prepack` 构建再失败**，
  失败信息看起来像构建问题。补救只有一条命令：`npm login --registry=https://registry.npmjs.org`
  （交互式、需要凭据，**AI 不做代理**——这是人机交接点，见 §4.6）。
  **不带 `--registry` 的 whoami 会骗人**：本机默认 registry 是镜像，显示「已登录」可能是镜像账号，
  与能否 publish 到 npmjs 无关。
- **gh 已登录**且带 `repo` 权限：`gh auth status` 应显示 `Logged in to github.com account eghrhegpe`。
- **工作树干净、可发布**：`git status --short` 无未提交内容（他人半改除外，按 §1.5 纪律处理）。
- **lib/ 与 src/ 同步**（docs/issues/19）：`npm run build` 后 `git status` 干净，
  即提交的 `lib/` 能被一次干净重建字节级复现。CI 的新鲜度门禁会兜底，但发布前本地先过一遍。

## 每次发布的完整步骤

### 1. 确认测试与代码

```bash
npm run verify          # typecheck + 两道 any 审计 + build + test + host/bundle 行为核验
npm run test:coverage   # 覆盖率门槛（CI 同款：lines 68 / branches 82 / functions 66）
```

> 并行开发是常态：改哪个域先跑哪个域（`npm run test:card`、`node test/<某文件>.test.js`），
> 全量留给 pre-push。

### 1.5 并行会话纪律（发布前必看，与 AGENTS.md 同源）

- 发布提交只收**自己本轮**的文件，**禁止 `git add -A` / `git add -u`**；提交后
  `git status --short` 复核没带走别人的东西。
- 发布必须从「**完全提交**」的状态切出：属于本版的改动（`src/`、`lib/`、文档、CHANGELOG）
  先各自落地再走流程——否则 tag 指向的提交缺文件，`github:` 源安装拿到的就是残的。
- **现实变体：修复已先入库、版本文件随后追平**：功能码已随并行会话进了 `main` 而
  `package.json`/CHANGELOG 没跟上时，**不要**把 tag 指回旧提交——开下一个版本号，
  补齐版本与日志再打 tag，保证「用户装到的」与「tag 指向的」是同一份。

### 2. 更新版本号

手动改 `package.json` 的 `version`（语义化版本）。后续步骤以目标版本号 `X.Y.Z` 指代。

### 3. 更新 CHANGELOG.md

顶部已有 `## X.Y.Z — 日期（未发布）` 节（本仓库惯例：**发版前先把条目写好**，市场渲染的就是它）：

- 发布日当天：把日期改成实际发布日，去掉「（未发布）」标记。
- 条目面向用户：写「你能得到什么 / 什么不再坏」，不写内部重构细节。

### 4. 同步 lib/、提交、打 tag

```bash
npm run build                          # 改过 src/ 就必须重建；未改过也要跑一遍确认无 diff
git add package.json CHANGELOG.md ...   # 只收自己本轮的文件；改过 src/ 时把 lib/ 一起收
git commit -m "chore: 版本升级至 X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <一句话说明>"
git push origin main
git push origin vX.Y.Z
```

> 本仓库 0.4.x 起**发版必带 tag**（0.3.x 及以前没有 tag，属历史缺口，本文档补上规矩）。

### 4.5 推荐顺序：先推 main、等 CI 绿、再 tag + publish

```bash
git push origin main
gh run watch "$(gh run list -R eghrhegpe/dsh-connect-qoder --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
git tag -a vX.Y.Z -m "vX.Y.Z: <一句话说明>" && git push origin vX.Y.Z
npm publish
```

- 等 CI 是为了「发出去的这一版被真验过」——包括 §19 的新鲜度门禁与行为核验。
  CI 红着发版 = 门禁形同虚设。
- CI 红了且**尚未 publish**：修完再 tag/publish（tag 此时还能动，见 §2）；
  **已 publish**：把红当成下一版的输入，只补 tag/Release，不覆盖已发版本。
- `gh run list --limit 5` 看最近趋势：连着 `failure` 说明门禁本身失效，先修门禁再发版。

### 4.6 人机 handoff 契约（AI 做仓库侧、人做不可逆侧时必读）

发版跨一条边界：**仓库侧**（版本文件、lib 同步、tag、CI、核验）AI 能全程做；
**不可逆侧**（`npm login`、按下 `publish`）只有人能做。交接必须显式、**以命令输出为证**：

**① AI → 人：请求 publish 之前，下面五条必须已成立并逐条报出**

```bash
git status -sb                       # 工作树干净、没有 ahead（自身文件）
git log --oneline -1 origin/main     # 版本提交已在远端
git rev-list -n1 vX.Y.Z             # 与 git rev-parse HEAD 一致
gh run list -R eghrhegpe/dsh-connect-qoder --limit 1   # 该提交的 CI 结论 success
npm run verify && npm run test:coverage   # 本地全量门禁绿
```

**② 人：`npm login`（若未登录）→ `npm publish` → 回报一行**

```bash
npm view @eghrhegpe/dsh-connect-qoder@X.Y.Z version --registry=https://registry.npmjs.org
```

**③ AI：拿到那一行之后才做 §5.5 内容核验，再按 §8 收口。**

- 人没拿到 ① 的五条时**不要 publish**。已发生顺序颠倒的按 §1 的 **S2′** 收口，别覆盖已发版本。

### 5. 发布到 npm

```bash
npm publish            # 仓库内：.npmrc 已钉 registry=npmjs.org + publishConfig 双保险
                      # 仓库外执行则显式带 --registry=https://registry.npmjs.org
npm pack --dry-run    # 发布前预览 tarball 内容（files 白名单：lib/、locale/、cordis.patch.yml、README、CHANGELOG）
npm view @eghrhegpe/dsh-connect-qoder version --registry=https://registry.npmjs.org   # 应显示 X.Y.Z
```

- `prepack` 会现场从 `src/` 重建 `lib/` 进 tarball——**tarball 里的产物永远比 git 提交的更新鲜**，
  这是 by design（`github:` 源装的是提交时刻的产物，npm 装的是发布时刻的产物，README 安装节写明了取舍）。
- 用户侧升级：DSH 暂不支持插件自动更新——**先卸旧版再装新版**，市场页的「更新日记」
  会渲染新 tarball 里的 CHANGELOG。

### 5.5 发布内容一致性核验（正序 / 补发都要做）

目的：**证明「用户装到的内容」与「tag 指向的提交」是同一份东西**。

```bash
# 1) 拉已发布版本（包名必须带 @版本，不带版本会打包本地目录！）
npm pack @eghrhegpe/dsh-connect-qoder@X.Y.Z --registry=https://registry.npmjs.org --pack-destination .build
tar -xzf .build/eghrhegpe-dsh-connect-qoder-X.Y.Z.tgz -C .build

# 2) 与本机候选提交的构建产物逐文件比 SHA256
```

判据：

| 检查 | 为什么是这条 |
|---|---|
| 包内 `lib/index.js`、`lib/client.js` 与候选提交的本地构建产物 SHA256 一致 | 「同一份内容」的唯一硬证据 |
| 包内含本版**新增的用户可见字符串** | 证伪「构建用了旧产物 / 发的是上一版」 |
| 包内 `CHANGELOG.md` 含本版节、`package.json.version == X.Y.Z` | 版本文件同步进了包 |

- PowerShell 下比 SHA256 用 `Get-FileHash`；路径分隔符统一成 `/` 再比，
  否则 `lib\` vs `lib/` 会冒假差异。
- 不做这一步的后果：没有任何东西报错——npm 上是一份、tag 指的是另一份，
  在下次有人对比之前一直「看起来都对」。

## 6. GitHub Release：本仓库不设（显式决定）

市场读的是 **tarball 里的 CHANGELOG**，GitHub 首屏读的是 README；0.4.x 期没有建过任何
Release，也没有二进制要走 Release 分发。所以**默认不建**。

若将来要建（例如给普通用户一个浏览入口），照兄弟文档的规矩来：`gh release create vX.Y.Z
--verify-tag`（**务必带 `--verify-tag`**——漏了它，tag 不存在时 gh 会悄悄新建一个指向当前
HEAD 的 tag）、`--title "vX.Y.Z — <一句话>"`（破折号）、正文独立可读、不附任何构建产物。

## 7. 断点续发

- **npm 已成功、只缺 tag**（S2′）：先 §5.5 核验，tag 指到被核验过的提交，推 main 与 tag；
  **不要重新 publish**。
- **npm 已成功、tag 与 main 都在**（S3 完整）：只剩 §8 核对。
- **publish 白跑一轮**：`E401`（没登录）或 `prepack` 失败（构建闸门拒写，REQUIRED 串缺失——
  issue 03 的防线）——修掉原因重跑即可，版本号占用发生在 publish **成功**那一刻，白跑不占号。

## 8. 最终闭环清单（完成判定，不凭感觉）

发版完整 ⇔ 下面四条**全部**成立：

- [ ] **main 可查**：`git log --oneline -1 origin/main` 追得到版本提交
- [ ] **tag 可查**：`git rev-list -n1 vX.Y.Z` 指向该提交
- [ ] **版本文件可查**：`package.json` version == X.Y.Z；`CHANGELOG.md` 顶部是本节且无「（未发布）」
- [ ] **npm 可查**：`npm view @eghrhegpe/dsh-connect-qoder version --registry=https://registry.npmjs.org` 返回 X.Y.Z

推荐（不参与完整判定，但是质量事实）：版本提交的 CI run 结论 `success`。

## 常见问题

- **`npm publish` 报 `E401`**：先跑完 `prepack` 才失败的（别当成构建事故）。
  `npm whoami --registry=https://registry.npmjs.org` 确认 → `npm login --registry=...` 补救。
- **`gh` 在 PowerShell 里 `-q` 报 jq 解析错**：引号被吃了；用单引号包 jq 表达式，
  或改 `--json <字段>` 后自己看。
- **`gh` 命令解析到了 `upstream`（hdhgsysh）仓库**：本仓库有 `upstream` 远端，
  一律显式 `-R eghrhegpe/dsh-connect-qoder`。
- **文档/README 改了用户看不到**：它们不在 tarball 里就不会到用户手里——
  `files` 白名单只有 `lib/ locale/ cordis.patch.yml README.md CHANGELOG.md`，
  改完仓库文件 ≠ 用户读到新版，必须随下一版 publish。
- **npm 上 0.4.3 缺号**：从未发布，可补可跳；本仓库惯例只往前开。
