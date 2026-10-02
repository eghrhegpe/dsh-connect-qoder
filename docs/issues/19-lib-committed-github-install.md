# `lib/` 入库为受版本管理的产物：`github:` 源安装零配置

**P2 · 规模 M · 决策记录（2026-10-03 已落地）**

## 症状

`.gitignore` 曾经把 `/lib/` 整体忽略，README 的三条安装路径里有一条是暗病：

- **npm 路径安全**：`prepack: npm run build` + `files` 白名单含 `lib`，registry tarball 现场构建，产物齐全。
- **市场 `github:eghrhegpe/dsh-connect-qoder` 路径**：克隆里没有 `lib/`（gitignored），而宿主入口
  是 `package.json` 的 `main: ./lib/index.js`。插件"安装成功"但宿主加载 `module-not-found`——
  装上是装了，卡片与路由全不生效，属于红线 1 定义的"静默失败"。

## 证据（宿主行为不是猜的，是读出来的）

1. **DSH 宿主侧**（桌面端 asar 解出的 `@deepseek-ai/dsh-plugin-manager`）：
   - `installBundle(spec)`：`github:` 简写先过 `checkGithubConnection`（带 5 s 超时），然后
     在 profile 目录跑 **`pnpm add <spec>`**——宿主不会自己替插件跑 build。
   - 安装失败时读 `readPendingBuilds(profile.dir)`，支持 `approvedBuilds` 走 `approveBuilds`
     （写 `pnpm-workspace.yaml` 的 `allowBuilds`）后重试——宿主有**显式的构建脚本审批流**。
2. **pnpm 侧**（本机 pnpm 11.8.0 源码，`exec/prepare-package`）：
   - `packageShouldBeBuilt(manifest, pkgDir)`：`scripts.prepare` 非空 → true；否则
     `PREPUBLISH_SCRIPTS`（prepublish/**prepack**/publish）任一非空 **且**
     `manifest.main ?? index.js` 在克隆目录**不存在** → true。
     本插件命中：有 `prepack`、克隆里无 `lib/index.js`。
   - 命中且不在 `allowBuilds` 白名单 → **硬错 `GIT_DEP_PREPARE_NOT_ALLOWED`**；
     命中且已批准 → pnpm 按 `preferredPM`（本仓库提交了 `package-lock.json` → npm）
     在克隆里跑 `npm install`（devDeps：tsdown/typescript/jsdom/react）+ `prepack`。
3. **本机实锤**：`~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 里已有
   `dsh-codearts-auth@git+https://gitee.com/iJetLi/deepseek-harness-codearts.git`（带/不带
   `#sha` 两条）——git 源插件走这套审批流在本机是真实发生过、且能走通的。

## 风险清单（忽略 `lib/` 时的四个故障面）

| # | 故障面 | 后果 |
|---|---|---|
| ① | 审批不是零配置：首次 `pnpm add github:...` 硬错，要用户看懂"批准构建脚本"再重试 | onboarding 悬崖，README 承诺的"粘贴即装"失守 |
| ② | 老版 DSH 若捆绑 pnpm < 11（无 `allowBuilds` 概念），依赖构建脚本被**静默跳过** | 装出的包没有 `lib/`，宿主 module-not-found，卡片无声消失 |
| ③ | 现场构建要 `npm install` 拉 devDeps；仓库 `.npmrc` 把 registry **pin 死在 npmjs.org** | 纯镜像网络（npmmirror）的机器上超时/失败 |
| ④ | 构建靠 `npm` 二进制（preferredPM），DSH 运行环境不一定有 npm | 构建直接失败 |

## 决策（已执行）

1. **`lib/` 入库**：`.gitignore` 移除 `/lib/` 并写明原因；改 `src/` 后 `npm run build`
   并把 `lib/` 与源码**同一次提交**。
2. 克隆里有 `lib/` 后 pnpm 的 `packageShouldBeBuilt` 直接为 false（main 文件存在）——
   **不触发构建、不需要审批、不拉 devDeps**，`github:` 源安装回到零配置。
3. **registry 路径不动**：`prepack` 仍现场重建，`npm publish` 的产物永远比仓库提交新鲜。
   代价是同一版本号下两条路径产物可能不同（npm 更新鲜）——README 已写明。
4. **CI 新鲜度门禁**（`.github/workflows/test.yml` build job）：`npm run build` 后
   `git diff --exit-code -- lib`——仓库提交的产物必须能被一次干净的重建**字节级复现**，
   拦住"src 改了、lib 忘了重建/没提交"的漂移。构建确定性已本地验证（两次构建 SHA256 一致，
   Node 24.16：`lib/index.js` `DB9C…1296`、`lib/client.js` `B681…877C`；CI 的
   "The build is reproducible" 步骤继续兜底同环境复现）。
5. **防再忽略条款**：`AGENTS.md` 红线 3 追加「不许把 `lib/` 加回 `.gitignore`」+ 工作目录
   与验证两节的对应说明 + 本文件；`.gitignore` 原位置留下原因注释。任何后续会话看到
   那两行注释先读这里。

## 验收标准

- [ ] 落地提交同时含 `lib/`、`.gitignore`、`AGENTS.md`、`README.md`、本文件、`docs/issues/README.md` 与 CI 门禁
- [x] 本地 `npm run build` 两次 SHA256 一致（见上）
- [ ] CI build job 新增的 "committed lib matches a fresh build" 步骤绿
- [ ] DSH 市场粘 `github:eghrhegpe/dsh-connect-qoder` 安装：**无**构建脚本审批提示，卡片与模型路由正常
- [ ] 再改一次 `src/` 只提交源码不提交 `lib/` → CI 新鲜度门禁红

## 与上游布局的关系

上游 `hdhgsysh/dsh-connect-qoder` 是「`lib/*.js` 即源码、直接提交」；#17 之后本 fork
翻转为「`src/` 为唯一真相、`lib/` 为纯产物」——本项只回退其中"产物出库"的一半，
**源码真相源仍是 `src/`**（构建脚本、REQUIRED 闸门、verify:* 行为比对全不动）。
