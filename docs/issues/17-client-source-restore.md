# 源码入库：`src/client/*.ts` 还原 + 构建脚本（#03 第二步 L）

**P1 · 规模 L · 依赖 #03（第一步 S 已先行）**

## 症状

`lib/client.js` 是 2004 行的产物，`src/client/*.ts` 从未入库。后果不是"不好看"，而是**卡片代码无法被正常修改**：

1. 改任何一处 UI 都要手改产物；`test/client-bundle.test.js` 只能从产物文本里正则抽函数执行——它证明"那行还在"，证明不了"改对了"。
2. `test/model-row.test.js` 因此保留了一份**手抄副本**的 `offPeakState` 规则。README 自己的判词是"**副本不是防线**"，但没有源码就没有别的办法。
3. #09（卡片自算错峰价/窗口标签）这类"卡片镜像宿主逻辑"的漂移，根治路径就是让卡片和宿主 import 同一个模块——前提是卡片得有模块。

## 证据

- `lib/client.js` 的 `//#region` 标记反推出的源码文件清单与行区间：

  | region | 区间 | 内容 |
  |---|---|---|
  | `src/client/paths.ts` | 10–21 | 5 条路由常量 |
  | `src/client/styles.ts` | 23–173 | `QODER_CARD_CSS`（数组 `join("")`）+ `installStyles()` |
  | `src/client/settings-write.ts` | 175–326 | `QoderSettingsWriteError` / `saveFieldViaHost` / `writeSettingsField` |
  | `src/client/copy.ts` | 328–511 | **只有** `zh` / `en` 文案 |
  | （无标记） | 513–1903 | 1390 行：`IMAGE_MODES`、12 个纯函数、5 个组件 |
  | `src/client/index.ts` | 1904–1997 | `name` / `inject` / `apply` |

- 513–1903 这段**没有任何 region 标记**，是还原里最关键的一个未知量（见下）。
- `test/client-bundle.test.js:50` 按 `function ${name}\([^)]*\) \{` 提取，配平花括号——**只依赖函数名与函数体文本**，不依赖所在文件，所以拆文件不会打断它。
- `package.json`：只有 `test` / `test:coverage` / `verify:deploy`，无 `build`。
- `docs/KNOWN_GAPS.md:76-99` 已把"src 入库"列为价值最高的待办。

**对照组（本机已装）**：`.dsh/profiles/web/node_modules/dsh-connect-workbuddy@2.1.0` 的 bundle 同样保留 region 标记，源码结构是

```
src/status-paths.ts              host↔client 共享的 node-free 常量/类型（不在 client/ 下）
src/client/account-selection.ts
src/client/icon.ts               data URI 图标
src/client/styles.ts             CSS 用模板字符串，不是数组 join
src/client/searched-paths.ts
src/client/WorkBuddyCard.tsx     933 行
src/client/locales.ts            文案单独成文件
src/client/index.tsx             ~80 行，只做注册
```

配套工程化：`"build": "tsdown"`、`"typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.client.json"`（**双 tsconfig**）、`vitest`、`"prepack": "npm run build"`、`files` 不含 `src`。每个源文件带 `@module` 文档头和"参考：`<上游项目>`（MIT）…改动：…"的血缘注释。

## 实测记录（2026-09-27）

两个脚本已落地，源码已还原出 6 个文件 / 1977 行：

| 脚本 | 作用 |
|---|---|
| `docs/history/restore-client-src.mjs` | 按 region 机械切分产物 → `src/client/*.ts`（去缩进、`require`→`import`、`exports.x`→`export`、反推跨文件 import 图） |
| `scripts/build-client.mjs` | 从 `src/` 重建产物并与入库产物比较（`--tsdown` 换 bundler，`--write` 才写 `lib/`） |

还原出的 import 图（从符号引用反推，非猜测）：`card → paths, settings-write`；`index → styles, copy, card`。

**字节一致做不到**，三条原因都有实测支撑：

1. **import 拓扑在 bundle 里不可恢复。** 产物模块顺序是 `paths, styles, settings-write, copy, card, index`，但 `styles` 与 `copy` 只被 `index` 引用、`paths` 与 `settings-write` 只被 `card` 引用——没有任何 import 顺序能 DFS 出这个序列，除非 `card` 还 import 了 `styles` 和 `copy` 却不使用它们。哪条是真相，bundle 不告诉你。
2. **513–1903 那段没有 region 标记。** 它不是 `copy.ts`（不引用 `zh`/`en`），却紧接在 `copy.ts` 闭合之后。可能的成因是虚拟模块或产物被手工编辑过——两者都无法从仓库内证实。
3. **两个 bundler 都不产出这个形态。** esbuild 会把跨模块 `const` **内联**并删掉声明（产物保留了声明），差异 667 行；tsdown/rolldown 保留 `const`，但会常量折叠 CSS 数组的 `join("")`、重整格式、注入 `\0rolldown/runtime.js` 辅助头，差异 428 行。

内容层面是**等价**的：6 个模块、`writeSettingsField` 等 13 处引用、`offPeakState` / `QoderPluginCard` 等关键符号两侧都在，剩余差异是辅助头、格式化与常量折叠，不是逻辑。

## A 已执行（2026-09-27）

**先补了一个会让卡片当场崩的缺口**：tsdown 默认按 node 平台构建，产出的 CJS 直接写 `module.exports = ...` 却**不声明** `module` / `exports`；宿主只给 factory 传 `require`，那样加载就是 `module is not defined`。加 `platform: 'browser'` 后 tsdown 会发 `Object.defineProperty(exports, Symbol.toStringTag, …)`，再在 wrapper 里补 `var module = { exports: {} }` / `var exports = module.exports` 两行——正好是 `dsh-connect-workbuddy` 产物头部那三行。**只比字节的话，这个缺陷完全看不出来**，因为旧产物有那三行而新产物没有时，行数差异会被淹没在 428 行格式差异里。

验证手段不是"看起来差不多"：

| 手段 | 结果 |
|---|---|
| 行为对拍（`npm run verify:bundle`） | 13 个纯函数 × 420 组输入 = **5460 次调用**，新旧产物的返回值与抛错逐条一致 |
| 错峰门控 needle | 两侧都有 `promo.active !== true` |
| 导出符号 | 两侧同为 `apply` / `inject` / `name` + 13 个内部函数 |
| `npm test` | 269 通过 / 0 失败 |
| 重建幂等 | 连跑三次，sha256 相同 |

对拍脚本固化为 `scripts/verify-bundle-behaviour.mjs`：基线默认 `git show HEAD:lib/client.js`，所以提交后它自动变成"相对上一提交有没有改变行为"的回归门禁。

产物变化 1852 行 / 99KB → 1777 行 / 83.7KB。缩水的部分几乎全是**行注释**：rolldown 只保留 `/** */` 块注释（42 处全在），剥掉了 248 行 `//` 注释。`.dsh/profiles/web/…/dsh-connect-workbuddy` 的产物也是这个特征（16 行 `//`，且多为 region 标记），可见是 rolldown 的既有行为，不是配置失误。注释的完整副本现在在 `src/client/`，产物头部加了一行 `Generated from src/client …`，防止有人再手改产物。

## 构建体系加固（2026-09-27）

换产物之后，"能构建"和"构建可靠"是两件事。加固时发现并修掉的问题：

| 问题 | 证据 | 修法 |
|---|---|---|
| `npm run build` 硬编码了**作者机器的私有目录**（`…/binaries/node/workspace`） | 别人 clone 下来 build 直接失败——源码入库对他就没意义 | `tsdown` 进 `devDependencies`，本地优先解析，`TSDOWN_WORKSPACE` 留作逃生口 |
| `npm install` **根本装不上** | peer 全是 `@deepseek-ai/*`，公共 registry 上没有；npm 7+ 自动装 peer，在装到 devDeps 之前就 ENOTARGET | `.npmrc` 里 `legacy-peer-deps=true`（附注释说明 peer 由宿主提供） |
| 构建可能**成功但残缺** | 首次构建产物只有 84 行——`index.ts` 当时没有 import，bundler 把模块全摇掉，**退出码仍是 0** | `build-client.mjs` 的 `REQUIRED` 自检：缺任一关键串就报错且**不写产物** |
| 对拍有盲区：**两侧同时缺失会判为"通过"** | 反例实测：注入一个两边都不存在的 probe，修复前输出 `behaviour: IDENTICAL` 并退出 0 | probe 缺失单列为失败；引用改用 `typeof` 守卫（未声明名字直接注入会抛 ReferenceError，读起来像"产物坏了"而不是"函数没了"） |

两条防线都做了**反例测试**（注入必定缺失的串/名字），确认：构建自检拦下写入且 `lib/client.js` 的 sha256 不变；对拍以退出码 1 失败并指名缺谁。

CI 侧新增**独立** build job（`build` → `git diff --exit-code lib/client.js` → `verify:bundle`），主 test job 保持不装任何依赖——两个保证都留着，没有用一个换另一个。`git diff --exit-code` 那条防的是"改了 `src/` 却没重建"，`verify:bundle` 防的是"重建之后行为变了"。

`tsconfig.json` 钉住 `jsx: react-jsx`（产物依赖 `react/jsx-runtime` 而非全局 `React`），`strict` 关着并注明原因：类型标注在还原时被擦除，现在打开只会报几百个没有信息量的错，等人工补回后再收紧。

## 发布前准备（2026-09-27）

对齐 `awesome-dsh-plugin` 的收录要求逐条查过：`dsh.bundle` + `cordis.patch.yml` 有、仓库满 1 天、fork 血缘明确（`isFork: true`）、上游**尚未被收录**（`hdhgsysh__dsh-connect-qoder.yml` 404，不存在撞车）。唯一缺的是 GitHub topic `dsh-plugin`（需人工添加）。

`assets/` 放了两张卡片截图，配 `screenshots.json`（1–8 张、相对路径、GitHub 托管）。**第一张的账号 id 已打码**——原图截进了 `nick…` 那一行，那是个人信息，进公开仓库就不可逆。原图备份在 `.build/screenshots-originals/`（已被 gitignore）。

## 收尾（A 之后）

| 项 | 状态 |
|---|---|
| 浏览器冒烟：展开卡片、切区域、改图像档位、保存 | **待人工** —— `web` profile 是 link 到本 checkout，重启 DSH 后即加载新产物 |
| `desktop` profile 的副本 | **刻意未同步**，见下 |
| 之后的清理 | 独立于 A/B/C，见下 |

`npm run verify:deploy` 现在报 1 处漂移：`desktop` profile 的副本 `lib/client.js` 与 checkout 不同（版本同为 0.2.0，正是那个版本陷阱）。**没同步它是有意的**——它是本机唯一还在跑旧产物的地方，冒烟期间留作安全网。`web` 是 link，已自动加载新产物。冒烟通过后再决定：复制新产物过去，或把 `desktop` 也改成 link（后者能让这个 profile 永不漂移）。

之后（独立于 A/B/C）的清理：

- `copy.ts` 只有文案 → 改名 `locales.ts`；`card.ts` 的 12 个纯函数拆出 `format.ts`；5 个组件各自成文件；`QoderPluginCard` 那 530 行拆 `useQoderCatalog` + `ModelRow`。
- `test/model-row.test.js` 的手抄副本改为 import 真实模块（README 要的"不是副本"）。
- 补 `tsconfig.client.json` 与 `npm run typecheck`；类型标注需人工补（编译期已擦除，无法恢复）。
- `files` 不含 `src`；`npm test` 保持零依赖（devDependency 只影响开发）。

## 验收标准

- [x] `node docs/history/restore-client-src.mjs` 可从当前 `lib/client.js` 稳定重放出 `src/client/`
- [x] `node scripts/build-client.mjs --tsdown` 成功，且报告的差异都属辅助头/格式化/常量折叠，无逻辑行缺失
- [x] 重建产物仍含 `offPeakState` / `rateAt` / `windowLabelOf` / `QoderPluginCard` / `writeSettingsField` 等关键符号
- [x] `test/client-bundle.test.js` 对重建产物仍全绿（提取仍成功）——全套 269 通过 / 0 失败
- [x] `npm run verify:bundle`：5460 次对拍零差异，门控 needle 在位
- [x] `npm run build` 幂等（三次 sha256 相同）
- [ ] **浏览器冒烟通过（展开卡片、切区域、改图像档位、保存）** ← 唯一剩下的
- [ ] 冒烟通过后同步 `desktop` 副本，或把它改成 link
- [ ] `npm test`（零依赖、不 `npm i`）仍全绿
