# 修复计划（dsh-connect-qoder）

这份文件把一次完整的功能审计（协议层、宿主接线、凭据层、卡片产物、测试与验收声明）收敛成一份
**可执行的优先级清单**。每条都带：症状 → 证据（file:line）→ 为什么这个优先级 → 修法 → 验收标准（含要加的测试）。

拆成 issue 的草稿在 [`issues/`](issues/README.md)。

---

## 0. 基线与现场事实

审计锚点：HEAD `61f8aaf`，工作树干净，`npm test` **269/269**，`npm run test:coverage` 实测
**lines 72.20 / branches 86.37 / functions 72.62**（门槛 68/85/66）。

三条**本机实测**出来的事实（不是推断），它们决定了下面的排序：

1. **sweep 会越界清零**：在 `%TEMP%` 造一个 `qoder-oscrypt-*` 目录联接指向别处，
   调 `sweepStaleOscryptDirs(0)` → 返回 `reclaimed=2`、**零上报**、联接被删、
   目标目录里的 `victim.txt` 20 字节**全部变成 NUL**。
2. **明文主密钥会残留**：`%TEMP%\qoder-oscrypt-*\key.b64` 实测 48 字节全非零
   （即 OSCrypt 主密钥的 base64，凭据级材料）；唯一回收点是下次启动的 sweep。
3. **产物被破坏不会有任何东西报错**：把 `lib/client.js` 换成 16 字节桩后，套件不是变红，
   而是"**少 6 条测试**"（269 → 263，仅一条文件级失败）。

另外记录一次真实事故，它本身就是第 3 条的证明：提交 `5206c4c` 曾把 16 字节的
`// gutted stub` 作为 `lib/client.js` 提交进去（`lib/client.js | 1971 +---`），
卡片/样式/设置写入整体消失而模型通道照常。该提交已被 `git commit --amend` 修为 **`61f8aaf`**
（分支 `fix/0.1.7-settings-rewrite` 本地未推送，原 tip 仍在 reflog，可 `git reset --hard 5206c4c` 回退）。

---

## 1. 排序原则

> **不可逆损失 > 用户被误导 > 体感 > 技术债 > 交付与文档。**

贯穿性主题：**这个插件的缺陷几乎都是"失败不发声"型**——目录冻结却显示"已更新"、假"已保存"、
凭据读不出统一说成"没登录"、上游改协议表现为无限排队、卡片被桩没有任何东西报错、
命名空间不匹配整行消失。所以清单里凡是"让失败说出来"的改动，一律优先。

规模：**S** ≤ 1 小时，**M** ≤ 半天，**L** ≥ 1–2 天（含测试）。

---

## 2. 总览

| # | 优先级 | 症状 | 关键证据 | 规模 | 依赖 |
|---|---|---|---|---|---|
| P0-1 | 不可逆 | sweep 跟随联接，把插件目录**之外**的文件清成 NUL | [credentials.js:779-813](../lib/credentials.js#L779-L813) | S | — |
| P0-2 | 不可逆 | 明文 `key.b64` 残留，回收只靠下次启动 | [credentials.js:260-342](../lib/credentials.js#L260-L342) | S | P0-1 同区 |
| P0-3 | 误导 | 产物被桩不报错，卡片可整体消失 | [test/client-bundle.test.js:49-96](../test/client-bundle.test.js#L49-L96) | S→L | 分两步 |
| P0-4 | 误导 | 刷新成功但 0 模型时目录冻结 | [index.js:377-386](../lib/index.js#L377-L386) | S | — |
| P0-5 | 误导 | "已更新（时间）"用的是响应时刻，刷新失败也照显 | [index.js:848](../lib/index.js#L848) | S | — |
| P0-6 | 误导 | 假"已保存" + 503 分支不可达（同一处修复关掉两个） | [index.js:876-887](../lib/index.js#L876-L887)、[client.js:311-322](../lib/client.js#L311-L322) | M | — |
| P1-1 | 体感 | 账号路由同步起 PowerShell（上限 30 s）阻塞事件循环 | [credentials.js:272-281](../lib/credentials.js#L272-L281) | M | — |
| P1-2 | 功能 | `keyCache` 无失效路径 → 重装后永久 needs-app | [credentials.js:175](../lib/credentials.js#L175) | S | — |
| P1-3 | 误导 | 卡片自算错峰价/窗口标签，与宿主分歧 | [client.js:622-693](../lib/client.js#L622-L693) | M | P0-3① |
| P1-4 | 品类 | 上游协议漂移与"没登录"不可区分 | [upstream.js:34-40](../lib/upstream.js#L34-L40) | M | — |
| P2-1 | 债 | 44.7% 的 lib 代码不在覆盖率分母里 | 见 §5 | L | — |
| P2-2 | 债 | 12 处小时级小口子（含注释与代码相反） | 见 §5 | S | — |
| P2-3 | 债 | dispose 两条尾巴（在途刷新、路由未注销） | [index.js:738-754](../lib/index.js#L738-L754) | M | 需先确认宿主语义 |
| P2-4 | 债 | 设置命名空间四套说法 | 见 §5 | S | P0-3① |
| P3-1 | 交付 | 两份 0.2.0 内容不同，靠事后漂移检查发现 | `npm run verify:deploy` | S | — |
| P3-2 | 文档 | 零配置=Windows、基线数字、缺口未登记 | README / KNOWN_GAPS | S | — |
| P3-3 | 功能 | 默认不策展（31 项含别名）、PAT 恒判 ok | 见 §6 | M | — |

---

## 3. P0 详情

### P0-1 sweep 越界清零 —— S

**症状**：`sweepStaleOscryptDirs` 只按**名字前缀**匹配，`statSync` 跟随联接，然后对目录内**每个条目**
无条件 `zeroOutFile`（`open('r+')` + 写零到原长度），最后 `rmSync`。任何名字撞上
`qoder-oscrypt-*` 的目录/联接，其内容会被静默抹成 NUL，而且**零上报**、还计入 `reclaimed`。

**证据**：[credentials.js:788-800](../lib/credentials.js#L788-L800)（前缀匹配 + `statSync` + 遍历清零）、
[429-478](../lib/credentials.js#L429-L478)（`zeroOutFile`）。本机复现见 §0-1。

**威胁模型（更正一条更早的表述）**：`%TEMP%` 是 per-user ACL，所以现实威胁是
**同用户进程/管理员 + 名字撞车的残留目录**（旧版本、其它工具的残留），不是任意本地用户、更不是远程。
即便如此也必须修：这是**我们自己的启动代码去清别人的文件**，损失不可逆。

**修法**
- `lstat`（不跟随）判定类型：是符号链接/junction/reparse point 一律跳过并上报；
- 只处理**恰好一个 `key.b64`** 的目录，且校验内容是 base64 解出的 32 字节；
- 目录里出现任何其它条目 → 不删、不清、上报一条 warning；
- `reclaimed` 只统计"确认是自己的残留目录且已处理"的情况。

**验收标准**
- [ ] `%TEMP%` 里的 junction/symlink 目标目录内的文件**逐字节不变**（新增用例）；
- [ ] 目录含非 `key.b64` 条目时，该目录**既不清零也不删除**，且产生一条上报；
- [ ] 正常残留目录（仅 `key.b64` + 年龄超限）仍被回收，`reclaimed` 计数正确；
- [ ] `test/credential-cleanup.test.js` 全绿，且新增用例在"删掉 `lstat` 守卫"时会变红（变异验证）。

### P0-2 明文密钥残留 —— S

**症状**：清理失败时 `key.b64` 原样留在共享 `%TEMP%`；唯一回收点是**下次插件启动**的 sweep，
没有定时器。实测残留文件 48 字节全非零。

**证据**：[credentials.js:260-342](../lib/credentials.js#L260-L342)（`oscryptKeyFor` 的 `finally` + 只清内存缓存）、
[index.js:592-601](../lib/index.js#L592-L601)（启动时 sweep 是唯一调用点）。

**修法**：清理失败时立刻重试一次；仍失败则**先把文件截断为 0**（保留数据比"删不掉"更糟）；
`process.on('exit')` 的路子里补一次扫描；给残留加可观测的 TTL 上报。

**验收标准**
- [ ] 模拟"文件被独占句柄锁住"：断言该次调用后文件长度必须为 0（当前实现会保留 48 字节）；
- [ ] 残留出现时产生一条可被 `setCredentialDiagnosticSink` 收到的上报；
- [ ] 正常路径仍然删除目录（不回退）。

### P0-3 产物完整性守卫 —— S（先行）→ L（根治）

**症状**：`lib/client.js` 是 2004 行 esbuild 产物，无 sourcemap、无构建脚本、源码从未入库；
`exports["./client"]` 直接指向它。产物被换成桩时**没有任何东西报错**，只是"少 6 条测试"。

**证据**：[client-bundle.test.js:49-96](../test/client-bundle.test.js#L49-L96)（正则 + `new Function` 提取，
外加一句 `source.includes('promo.active !== true')`）；`package.json` 无 `build` 脚本；
`docs/KNOWN_GAPS.md:76-99` 自己把"src 入库"列为价值最高的待办。

**修法（两步，别合并）**
1. **今天就能做 S**：把产物 sha256 与"关键符号必须存在"写进测试——现有 `promo.active !== true`，
   补 `offPeakState`、`rateAt`、`windowLabelOf`、`formatContextWindowForUi`、三个 slot key
   （`dsh-connect-qoder`、`dsh-connect-qoder#llm-qoder`、`qoder`，见 [client.js:1990-1992](../lib/client.js#L1990-L1992)）；
   断言产物行数/字节数下限；接进 CI。产物变了必须有人改一次哈希——这正是要点。
2. **排期 L**：`src/client/*.ts` 入库 + 构建脚本（esbuild 固定版本），`lib/client.js` 标注为生成物，
   加 `npm run build` 与"构建产物与入库产物一致"的检查。

**验收标准**
- [ ] 把产物替换成 16 字节桩 → 测试**红**（文件级失败也要红，不允许"少 6 条"形态）；
- [ ] 故意删掉产物里的 `promo.active !== true` → `client-bundle.test.js` 变红（现有行为，保持）；
- [ ] 删掉 `windowLabelOf` → 新断言变红；
- [ ] 第二步完成后：`git checkout lib/client.js` 后可复现重建，且构建前后内容一致。

### P0-4 目录刷新"成功但空"导致冻结 —— S

**症状**：`fetchModels` 成功返回 0 个模型时，既不 `replace` 也不推进抓取时间；
"成功但空"和"失败"被合并成同一条静默路径。账号被收窄或模型全部下线时，
卡片与选择器**继续展示上一份目录**，用户点刷新也没有出口。

**证据**：[index.js:377-386](../lib/index.js#L377-L386)。
附带确认：`refreshCatalog(true)` 是生产里唯一的调用形态（837 / 1064 / 1159 / 1162），
所以 `if (!force && this.catalog.fresh()) return` 那条 TTL 分支实际是**死代码**。

**修法**：空结果也用 `replace([])` 并推进 `fetchedAt`，同时在卡片上给出"上游当前没有可用模型"
这一类可读状态（而不是让人以为还在加载）；顺手删掉 TTL 死分支或补一个真正的调用者。

**验收标准**
- [ ] 新用例：`fetchModels` 返回 `[]` → 目录被清空 + `fetchedAt` 前进 + `invalidate` 被调用；
- [ ] 新用例：`fetchModels` 抛错 → 目录**不变**（保持上一份好数据），两者不再混同。

### P0-5 `refreshedAt` 撒谎 —— S

**症状**：payload 里的 `refreshedAt` 取响应生成时刻（`const now = new Date()`），
真实抓取时间 `CatalogStore.fetchedAt` 从不外发；刷新失败只 warn 后继续，于是卡片照显"已更新（刚）"。

**证据**：[index.js:848](../lib/index.js#L848)、[catalog-entry.js:157](../lib/catalog-entry.js#L157)、
[index.js:837-847](../lib/index.js#L837-L847)（失败只 warn）。

**修法**：外发真实 `fetchedAt` + 一个 `lastRefreshFailed` / `lastRefreshError` 标志，
卡片据此显示"上次更新：X 前"或"刷新失败"。

**验收标准**
- [ ] 新用例：刷新抛错后 payload 的 `refreshedAt` **不变**且带失败标志；
- [ ] 新用例：成功刷新后 `refreshedAt` 前进到真实抓取时刻。

### P0-6 假"已保存" + 不可达的 503 —— M（一次改动关掉两个）

**症状（两条是一条链）**
- 卡片的 `__save` 回退路径：端点失败后走 `scope.set`，然后**从同一个 scope 快照读回**做校验，
  命中就 `return null` 而不抛错；`save()` 没抛错就显示"已保存"。
  `scope.set` 在 0.1.7 上恰好可以"更新内存快照但不落盘"——整个 `__save` 设计要消灭的场景在回退分支原样复活。
- 主机侧那个 503 分支（`webCtx.get('settings')` 为空）**实际不可达**：路由注册在
  `ctx.inject(['webServer','settings'])` 内部，settings 缺失时回调根本不执行、路由不存在，
  客户端拿到的是 **404**，于是走进上面那条回退。

**证据**：[client.js:276-325](../lib/client.js#L276-L325)（其中 311-322 是自读回）、
[client.js:1565-1583](../lib/client.js#L1565-L1583)（不抛错即"已保存"）、
[index.js:876-887](../lib/index.js#L876-L887)（不可达的 503）、
[settings-save.js:171-180](../lib/settings-save.js#L171-L180)（真正会发生的那个 503，README 把两者混为一谈）。
卡片自己在 [client.js:1562-1563](../lib/client.js#L1562-L1563) 写着"要么落盘、要么抛错"。

**修法**
1. 把 `__save` 路由从 `ctx.inject(['webServer','settings'], …)` 挪到 `['webServer']`，
   在 handler 内用 `webCtx.get('settings')` 判空 → 让现存的 503 分支真正可达。
   端点存在但如实失败，客户端就不会走回退——**这一处同时让 README 的说法成真**。
2. 回退路径只在"端点不存在（404，legacy 宿主）"时启用；启用时提示降级为"已保存（未确认）"，
   并且读回校验改为"优先读文档、读不到才读快照"。
3. 顺便把 `__save` 的 handler 抽成可测函数（与 `applySettingsSave` 同套路），让路由级断言成为可能。

**验收标准**
- [ ] 新用例（抽出的 handler + 假 settings）：settings 缺失 → **503 带 body**，而不是 404；
- [ ] 新用例：端点 503 + `scope.set` 只更新快照 → 卡片显示失败，不显示"已保存"；
- [ ] 新用例：端点 404（legacy）→ 允许回退，但产物里的文案是"已保存（未确认）"；
- [ ] 变异验证：把 503 分支改回 `inject(['webServer','settings'])` 结构，第一条用例变红。

---

## 4. P1 详情

### P1-1 凭据读取阻塞事件循环 —— M（已修，见 docs/issues/07）

**症状**：`/account` 每次渲染都同步起 PowerShell（`execFileSync`，`timeout: 30000`），
而且**失败不缓存**、`account-state` 还绕过 `CredentialCache` 直调 `loadCredential`。
Qoder 目录存在但 `Local State` 解不开时（正是账号面板要解释的状态），每次打开卡片/切页签都同步阻塞
一次，最多 30 s × 候选目录数。实测单次**成功**解包也要 0.43–0.69 s。

**修法（已落地）**：失败结果加 60 s TTL；`/account` 只读缓存（`cachedOnly`），凭据读取走
`loadCredentialAsync`（`execFile` 而非 `execFileSync`），`needs-app` 判定用目录存在性 + 已记录原因。
实测异步读 29 ms 返回（同步版 490 ms），期间事件循环跑 30 次（`test/async-unwrap.test.js`）。
同步版仅保留给启动 sweep 与 `probe/` 脚本。

**验收标准**（全部达成）
- [x] 新用例：连续 3 次 `/account` 渲染，PowerShell 只被 spawn 一次（`test/account-payload.test.js:142-163` 双 region 并发 + `test/async-unwrap.test.js` 结构断言）
- [x] 新用例：解包失败后 60 s 内不重试；超过 TTL 才重试（`test/unwrap-failure-window.test.js:37-86`）
- [x] 手工验证：解不开的机器上卡片仍能快速渲染出 `needs-app`（由 `cachedOnly` 达成，见下）

### P1-2 `keyCache` 没有失效路径 —— S

**症状**：`keyCache` 只增不删；`decryptOscrypt` 失败、DB 行解不开都不会逐出 key；
`invalidateCredential` 只清凭据缓存。Qoder 重装/重置 profile 使 `Local State` 的
`encrypted_key` 变化后，本进程会一直用旧 key → 区域**永久 needs-app**，只能重启 DSH。

**证据**：[credentials.js:175](../lib/credentials.js#L175)、[260-261](../lib/credentials.js#L260-L261)、
[339-340](../lib/credentials.js#L339-L340)；`invalidateCredential` 见 [index.js:350-352](../lib/index.js#L350-L352)。

**修法**：缓存键带上 `Local State` 的 `mtime+size`（或 `encrypted_key` 的哈希）；不一致就重解。

**验收标准**
- [ ] 新用例：改掉 `Local State` 的 mtime/内容后，下一次读取重新调用 PowerShell；
- [ ] 新用例：不变时命中缓存，不再调用。

### P1-3 卡片与宿主的单一事实源 —— M（依赖 P0-3①）

**症状**：同一个数被算两遍。宿主已经把 `effectiveRate` / `offPeakActive` / `promotion.remainingSeconds` /
`contextWindow` / `contextWindowLabel` 发到卡片，卡片却**一个都不读**，全部自算。
历史上已经因此出过"把拿不到的折扣价显示给用户"的缺陷；现在**又有现场分歧**：
`contextOptions=[128000,200000]` + `defaultContextWindow=0` 时宿主不显示标签、卡片显示 `128K`。

**证据**：[offpeak.js](../lib/offpeak.js) 与 [client.js:622-693](../lib/client.js#L622-L693)（错峰）、
[pi-model.js:109-134](../lib/pi-model.js#L109-L134) 与 [client.js:664-670](../lib/client.js#L664-L670)（窗口标签）、
[client.js:1957](../lib/client.js#L1957)（`/qoder/i` 正则猜命名空间）。

**修法**：卡片改读宿主字段，删掉自算路径；命名空间改为宿主显式给出（或共享同一推导函数）。
在 P0-3① 的提取测试到位之前，**不要**再往卡片加新的判定逻辑。

**验收标准**
- [ ] 对拍用例：对同一 catalog 条目，卡片侧与宿主侧算出的费率/标签逐状态相等（含 `promotion.active=false`、
      `defaultContextWindow=0`、跨零点窗口）；
- [ ] 产物中不再出现第二份窗口算术（提取测试断言关键标识符已消失）。

### P1-4 协议漂移探测 —— M

**症状**：这是本插件最根本的品类风险。它克隆私有协议（`COSY_VERSION '1.1.38'`、`CLIENT_TYPE '5'`、
`session_type 'qodercli'`、`Cosy-Data-Policy: disagree`），没有版本协商、没有契约。
上游一次更新就可能让所有请求变成 403 / `10605`，而插件自带的两分钟队列预算会把它当"排队"慢慢等——
用户看到的是漫长等待而不是错误。平台假设也无人验证：`MACHINE_OS` 在 darwin 上回落成 `x86_64_linux`
（[upstream.js:160-167](../lib/upstream.js#L160-L167)），全套件零引用。

**修法**：启动 + 每 6 小时做一次廉价探测（复用 catalog 请求），把结果分成三档并在账号状态里表达：
`ok` / `sign-in-expired` / **`protocol-shape-changed`（新档）**；后者的日志与卡片文案明确指向
"插件需要更新"，而不是"你的账号有问题"。同时给 `MACHINE_OS` 补平台断言。

**验收标准**
- [ ] 新用例：模拟"HTTP 200 但信封结构不符合已知形状" → 分类为 `protocol-shape-changed`，且**不**进队列重试；
- [ ] 新用例：`darwin` 分支有明确断言（当前是落进 linux 分支）；
- [ ] 卡片在 `protocol-shape-changed` 时给出的下一步动作 ≠ "重新登录"。

---

## 5. P2 详情（技术债）

### P2-1 覆盖率把三个大文件纳入分母 —— L（handler 抽取部分已完成）

**症状**：`lib/adapter.js`（239 行）、`lib/client.js`（2004 行）、`lib/index.js`（1166 行）
**从未被 import**，不在覆盖率报告里——**3409 / 7626 行 = 44.7% 的 lib 代码不受阈值约束**。
`upstream.js` 行覆盖 49.93% / 函数 38.89%（SSE 主循环、目录抓取整段未覆盖）；
`credentials.js` 的整条 PowerShell+DPAPI 链路 0%。

**修法**（KNOWN_GAPS #2 已给方案）：`--experimental-test-module-mocks` 桩掉 `@deepseek-ai/*` 与 pi-ai；
或把路由 handler 抽成 `(req, deps) => result` 纯函数（`applySettingsSave` 已证明可行）。
顺带把 KNOWN_GAPS 里那批**未登记**的凭据层缺口补进去。

**进展**：module-mocks 路线经实测不可行（peer 包不装 + index.ts 顶层静态 import），已放弃；
改走「抽出 handler」这条路——七条卡片路由的 handler 本体抽进无 peer 依赖的
`src/host/handlers.ts`，`index.ts` 每条路由只剩 `webServer.register` + deps 装配一行委托，
`test/handlers.test.js` 以假 req/res **直接执行**每条 handler。`handlers.ts` 已进覆盖率分母。
第二轮把 **provider 注册与回滚**也抽出来：`publishRegions` 原是 `activate()` 里的内联闭包，
包着十一个可变绑定，回滚三层 catch **零可执行覆盖**（只有 `account-route-wiring.test.js`
一条正则确认零区域早退还在）。现抽进无 peer 依赖的 `src/host/publish-regions.ts`，
两处宿主注册调用改为注入，`test/publish-regions.test.js` 13 例钉住每个终态。
**仍余**：`adapter.ts`（顶层 import pi-ai，且该包 5 个 peer 实测全 `ERR_MODULE_NOT_FOUND`）
与 `index.ts` 的路由注册/dispose 接线还没进分母。

**验收标准**
- [x] 至少 6 条路由有直接断言（method/鉴权/错误码）——`test/handlers.test.js` 覆盖全部 7 条，38 例；
- [x] `handlers.ts` 进入覆盖率分母（行 100% / 函数 100%）；`publish-regions.ts` 亦已进分母
      （回滚每个终态可执行断言）；`lib/index.js`、`lib/adapter.js` **整体**尚未（余路由注册/dispose 接线）；
- [ ] 门槛数字重新标定后写回 `package.json` 与 KNOWN_GAPS——本轮 handlers 入分母后整体仍
      90.29/82.33/86.35，地板（68/82/66）**未动**，故此项留空（无需重标）。

### P2-2 十二处小时级小口子（一个 PR 清掉） —— S

| 位置 | 问题 | 修法 |
|---|---|---|
| [shim.js:397-399](../lib/shim.js#L397-L399) vs [423](../lib/shim.js#L423) | 注释说"绝不发 `[DONE]`"，代码发了 | 二选一，并补一条断言 |
| [index.js:1053](../lib/index.js#L1053)、[1092](../lib/index.js#L1092) | `readJsonBody` 的坏 body 打进 catch-all → 裸 400 无 body | 包 try → 400 + `errorName` |
| [index.js:884-887](../lib/index.js#L884-L887) | 503 分支不可达（见 P0-6） | 随 P0-6 一起 |
| [index.js:826](../lib/index.js#L826) 等 6 处 | 405 缺 `Allow`，HEAD 也被 405 | 补 `Allow`，HEAD 交给 GET 路径 |
| [index.js:229-233](../lib/index.js#L229-L233) | 响应无 `Cache-Control` | 卡片内部端点补 `no-store` |
| [catalog-store.js:36-37](../lib/catalog-store.js#L36-L37) | `lastSaveError` 只写不读 | 删掉或真的上报 |
| [index.js:910](../lib/index.js#L910) | `Object.assign(preferences, …)` 被 live source 覆盖（死代码） | 删掉，或让 `current()` 真的合并它 |
| [index.js:1022-1033](../lib/index.js#L1022-L1033) vs [1081-1082](../lib/index.js#L1081-L1082) | reload 响应形状与 GET 不一致，卡片还不用它 | 统一形状 |
| [index.js:368](../lib/index.js#L368) | TTL 分支 `refreshCatalog(false)` 无调用者 | 删掉或补调用者 |
| [client.js:528](../lib/client.js#L528) | `__hide-all__` 哨兵作为合法值进设置文档 | 用 `null`/显式字段表达"全隐藏" |
| [index.js:272-282](../lib/index.js#L272-L282) | 缺 Origin 即放行、Origin 只比主机名不比端口 | 至少文档写清，设置写路由可加 token |
| [index.js:608-611](../lib/index.js#L608-L611) | 0 区域启动时整块 return → "没登录"文案不可达，用户看到 404 | 路由照常注册，回答"无区域可用" |

### P2-3 生命周期尾巴 —— M（已修，见 docs/issues/13）

**症状**：（a）在途的 `doRefreshCatalog` 没有 AbortController，dispose 后仍会 `catalog.replace()`（落盘）
并向已释放的 fiber `emit('llm/adapters-updated')`；（b）所有 `webServer.register()` 的返回值被丢弃，
全程没有任何注销路径——若宿主不按 fiber 回收注册，dispose 后再 POST reload 会新起 shim + interval 而
cleanup 已结束，**永久泄漏**。

**修法（已落地）**：（a）每次抓取建 `AbortController`，dispose 时 `abort()`，且
`isRefreshObsolete` 在**成功与失败两条路径**都查（只查一条是典型的"改一半"）；
（b）宿主语义**无法确认**（`@deepseek-ai/dsh-host-webserver` 打在宿主 `app.asar` 里，
插件 checkout 读不到，本机四条路都试过），故**不猜**：把 7 处 `register()` 的返回值
收集进 `lifecycle.ts` 的 sink，**仅当它是可调用的**才在 dispose 时调用——随 fiber 回收的
宿主会忽略这次多余调用，不回收的宿主则拿到了它原本缺失的注销。

**验收标准**（全部达成）
- [x] 新用例：dispose 后调用在途刷新，`catalog.replace` 与 `emit` 都不再发生
- [x] 宿主语义有明确结论并写进注释（"无法确认，故两种宿主语义下都正确"——第三种答案，
      比题面给的两种更诚实：它不对看不见的契约下断言，形状变了也只退化成今天的行为）

### P2-4 设置命名空间收敛 —— S（依赖 P0-3①）

**症状**：同一个命名空间有**四套说法**：Loader 条目 id `llm-qoder`、
常量 `dsh-connect-qoder`、`__save` 的三元候选、卡片第三套推导
（`entry.ns === "dsh-connect-qoder" || /qoder/i.test(entry.ns)` 交给 `.find`，
[client.js:1957](../lib/client.js#L1957)）。失败形态是"整行从设置页消失，不报错"。

**修法**：推导只留一处并让两侧共享；先把四套说法的来龙去脉写成一小段 ADR 放在 `docs/history/`。
注意：这条只有等 P0-3① 的提取测试到位才敢动卡片。

---

## 6. P3 详情

- **P3-1 交付**（S）：`npm run verify:deploy` 实测 `profiles/desktop` 是模块拆分**之前**的 0.2.0
  （9 个 missing、7 个 changed、3 个 `.bak`、3 个由真实缺陷换来的标记全缺），而两边版本号都是 `0.2.0`。
  重装 + 清 `.bak`；把 `verify:deploy` 接进 CI 或启动自检；给产物打**内容哈希 build id**，
  彻底消灭"版本号相同内容不同"。

  **进度（2026-09-26）**：desktop 副本已按本仓库内容刷新——16 个 `lib/**` 文件 SHA256 零差异、
  三个 `.bak` 已清、`verify:deploy` 回到 exit 0；旧副本完整备份在
  `~/.dsh/fork/.backup/dsh-connect-qoder-desktop-20260926-235548`。
  **仍未根治**：该 profile 的 `package.json` 仍写着 `"dsh-connect-qoder": "^0.2.0"`，
  `pnpm-lock.yaml` 里带 registry 的 `integrity: sha512-6kDkwQmU…`——也就是说
  **下一次 `pnpm install` / 市场更新会把内容静默还原成发布版**（版本号一样，看不出区别）。
  根治办法是在 app 关闭时把依赖改成 link：`dsh plugin add <本仓库路径> --profile desktop`
  （web profile 就是这么装的，`verify:deploy` 认它是 `dev link`）。
- **P3-2 文档**（S）：零配置 = Windows-only（凭据链只有 PowerShell + DPAPI，其它平台只剩 `QODER_PAT`）；
  README 里两处 503 是两件事；`KNOWN_GAPS:171-173` 的基线（branches 87.38）与实测（86.37）不符，
  安全垫被夸大约 43%；把凭据层的实测缺口登记进去；把账号封禁/条款风险写显眼。
- **P3-3 功能取舍**（M）：默认不策展 → 选择器灌入 31 项，含 `Auto`/`Ultimate`/`Performance`/`Efficient`/
  `Sonus`/`Cantus` 这类**路由档位别名**（不是模型）；考虑给一组默认策展与可选默认模型；
  让 PAT 的账号状态（恒判 `ok`）与实际可用性对齐。

- **P3-4 每日签到（已实现，2026-09-27）**：插件历史上只有读操作，签到是**第一个、也是当前唯一的写操作**——
  这条边界是被有意打破的，必须在 README 与这里都写清。实现要点（便于上游漂移时回溯）：

  - 协议：复用用量面板已经在读的 `GET /sash/api/v1/me/campaigns`，挑 `actionType === "CLAIM_BENEFIT"`
    且 `claimStatus === "CLAIMABLE"` 的当轮；领取走 `POST .../campaigns/{campaignId}/claim`。
    （`fetchCampaigns` 的旧只读副本只抽促销文案，新逻辑在 `lib/claim.js` + `lib/upstream.js` 的 `claimCampaign`。）
  - 两个过滤器缺一不可：同一账号下还有 `VIEW_DETAILS` 活动同样带 `claimStatus:"CLAIMED"` 却无 benefit；
    顶层 `claimable` 在「已领」与「没活动」时都是 `false`，且 `c.claimable` 字段根本不存在。判据以真实返回
    （`test/claim.test.js`，2026-09-27 双区实测）锁死。
  - **只手动、不自动**：卡片按钮三态（`立即签到`/`签到中…`/`今日已签到`），每次点击先重读活动取当轮 id，
    绝不复用渲染时的旧 id（一天一轮，旧 id 即上一轮）；领取后 `invalidateUsage()` 作废用量缓存重读，
    因为 Credits 落在 `addOnQuota`。`replayed` 幂等（重复领不发券），`expiresAt` 是 RFC 3339 字符串——
    解析统一收口到 `lib/time.js`（曾因 `upstream.js`/`claim.js` 两份 `toEpochMs` 阈值漂移而漏解析）。
  - 路由 loopback-only（403 守卫）、POST-only（405）、区域未知 404、失败 502 带原因；
    「未开放 / 已领 / 登录失效」三档分流，不统一弹一句失败。
  - 风险：这是替用户的账号去领额度，性质不同于读。README 免责声明与 P3-2 的「封禁/条款风险写显眼」在此闭合。
    CN 免费层计划额度为 0，签到资源包是其唯一额度来源——价值高，但封禁成本也高，故**不做定时自动签到**。

---

## 7. PR 划分与依赖

```
P0-3①（产物守卫） ─────► P1-3 / P2-4（卡片与命名空间可改的前提）
P0-6（路由挪出 inject）► 同时关掉假"已保存"与不可达 503
P0-1 ──► P0-2（同一片代码，同一个 PR 做完）
P2-1（覆盖率分母） ────► P2-2 / P2-3 的护栏
P1-1（异步凭据） ──────► 独立，可并行
```

- **PR-1「不出不可逆损失」**：P0-1 + P0-2 + P0-4 + P0-5 + P0-6。全是 host 侧、纯逻辑/路由级，测试都能写。
- **PR-2「产物守卫」**：P0-3 第一步 + 把 `5206c4c` 那次桩事故写成回归用例。
- **PR-3「源码入库」**：P0-3 第二步（`src/client/*.ts` + 构建脚本）。
- **PR-4「体感与真相」**：P1-1 + P1-2 + P0 的小尾巴。
- 之后才是 P1-3 / P1-4 / P2 系列。

## 8. 反优先级（现在别做）

- 别再往卡片加判定逻辑（无源码 + 无提取测试 = 每加一处多一个漂移点，这次的 `windowLabelOf` 就是例子）。
- 别为了提高覆盖率数字去写文本断言——`KNOWN_GAPS` 已经用实测证明那种测试"抓不住任何东西"。
- 别在 P0-3① 之前做卡片大改；别在 P2-1 之前做路由重构。
- 别调高覆盖率门槛：它是地板不是分数，地板下面还有 44.7% 没铺。

## 9. 要新增的测试（清单）

| 测试文件 | 覆盖的条目 | 关键断言 |
|---|---|---|
| `test/credential-cleanup.test.js`（扩） | P0-1 | junction/symlink 目标不变；非 `key.b64` 条目不被清；上报不为空 |
| `test/credential-zeroize.test.js`（新） | P0-2 | 零写失败时文件长度仍为 0 |
| `test/client-bundle.test.js`（扩） | P0-3① | 关键符号齐备 + 产物哈希/规模下限；桩 → 红 |
| `test/catalog-refresh.test.js`（新） | P0-4 / P0-5 | 空成功 vs 失败分野；`refreshedAt` 用真实抓取时间 |
| `test/save-route.test.js`（新） | P0-6 | settings 缺失 → 503 带 body；回退路径不再假成功 |
| `test/account-state.test.js`（扩） | P1-1 | 三次渲染只 spawn 一次；失败 TTL |
| `test/oscrypt.test.js`（扩） | P1-2 | `Local State` 变化 → 重新解包 |
| `test/offpeak-parity.test.js`（新） | P1-3 | 卡片与宿主逐状态对拍 |
| `test/protocol-drift.test.js`（新） | P1-4 | 未知信封形状 → `protocol-shape-changed` |
| `test/host-route-mocks.test.js`（新） | P2-1 / P2-3 | 路由 method/鉴权/错误码；dispose 后不再 emit |

## 10. 0.5.0 ABI 切割记录（2026-10-03）

宿主升到 0.2 代（现场 0.2.0-rc.2）后，0.1.x 双线兼容不再有人用：宿主已移除
`installSection` 与 `settingsScope`（asar 取证零命中，见
`docs/history/0.5.0-abi-cutover.md`）。0.5.0 一次砍掉：

- **P2-4 的四套说法收敛为两**：客户端 `resolveNamespace` 的子串推导
  （`/qoder/i`）改为与宿主 `settingsNamespaceOf` 共享的精确候选对
  （`dsh-connect-qoder` / `llm-qoder`）；宿主 `__save` 候选去重。
  完全体（跨 bundle 共享推导函数）仍受双 bundle 边界限制，登记在 ADR。
- **P2-2 表随之关闭三条**：`asVolatile` 退化分支（随 schemastery 下限
  `^3.18.3` 失去对象）；`installSection`/`setSource` 双探测（不可达死分支）；
  `settingsScope` 客户端探针（宿主已无此服务）。
- 附带同批小修：shim 流中失败的 `[DONE]` 注释与代码矛盾（P2-2 #1 的
  "二选一"——代码是对的，注释改对了并补钉住契约的测试）；目录刷新的
  TTL 死分支（P2-2 #9，删）。
- peer 范围收紧：`dsh-* >=0.2.0-rc.0 <0.3`（下限含预发布的理由在 ADR）、
  `schemastery ^3.18.3`、`pi-ai ^0.87.1`、`cordis >=4.0.4 <5.0.0`。

**未做/移交**：P3-1 桌面 profile 的 registry 副本漂移（需要 app 关闭时
`dsh plugin add <本仓库> --profile desktop`，属人机 handoff）；P3-3 默认策展；
P2-1 覆盖率分母扩到 index/adapter（L，需 module-mocks 的替代方案）。
