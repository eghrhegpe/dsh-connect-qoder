# 文档体系（docs/）

本目录是 `dsh-connect-qoder` 插件的详细文档，与根 `README.md`（安装、凭据来源、工作原理、测试）互补、不重复。

**这里是文档层的唯一索引。** `AGENTS.md` 的「去哪查」只留最高频的四条指针，完整地图就是下面这张表——两处都**不再**各自维护一份清单。

AI 协作会话从根目录 [AGENTS.md](../AGENTS.md) 进入：验证怎么跑、红线、门禁真源都在那里，本目录提供细节。

> **手里有症状，先看 [howto/symptom-triage.md](./howto/symptom-triage.md)**（按**屏幕上的原文**排，不是按模块名）。
> 「额度那栏是空的」「一直要求重新登录」「改了代码没生效」这类问题从那里进；
> 每一行都落到一个结论或一个 `issues/NN`。
> `PLAN.md` / `KNOWN_GAPS.md` / `issues/` 三份都按编号或模块组织，对症状没有入口——别从它们开始。

| 文档 | 内容 | 何时查 |
|---|---|---|
| [howto/symptom-triage.md](./howto/symptom-triage.md) | **症状入口**：按界面原文组织（`已保存（未确认）`、`上次更新：{time}（刷新失败）`……），每条给「看到什么 → 去哪查 → 是什么」 | **排查问题的第一站**（先有症状、后有主题） |
| [PLAN.md](./PLAN.md) | 一次完整功能审计（协议层 / 宿主接线 / 凭据层 / 卡片产物 / 测试与验收声明）收敛成的 **P0–P3 优先级清单**：每条带症状 → 证据（`file:line`）→ 为什么这个优先级 → 修法 → 验收标准 | 动手前通览事故史与优先级、判断「这条值不值得现在做」 |
| [KNOWN_GAPS.md](./KNOWN_GAPS.md) | **已知覆盖缺口**：明确知道**没有测试保护**的地方，每条写清「为什么现在没有」与「要补上它需要先做什么」。缺口是待办，不是旁白 | 想知道「这个现象是已知问题还是新 bug」、加测试前先看这里有没有既定口径 |
| [ROUTES.md](./ROUTES.md) | **回环路由契约**：12 条路由逐条列方法、能不能改状态、谁在调；两条挂载纪律（账号组 / 设备登录组全挂或全撤）与三道公共闸 | 审计「哪些接口能替我动账号」、加/改路由、核对 README 安全段那个数字 |
| [issues/README.md](./issues/README.md) | issue 草稿索引（按**编号与状态**排）+ 建 issue / 打标签的命令 | 要提 issue、要看某条修没修 |
| `issues/NN-*.md` | 单条 issue 草稿：症状、证据、修法、验收标准（份数以 `issues/README.md` 的表为准，**别在此写死**） | 改某个已知问题前 |
| [ratchet-ledger.md](./ratchet-ledger.md) | **棘轮账机制**：阈值为什么不写死在脚本里、怎么改阈值；`npm run typecheck`（只管 `src/`）与测试树两套程序为什么不能混 | 改验证阈值、疑惑「typecheck 绿了为什么测试文件没被检查」 |
| [issues/03-client-bundle-guard.md](./issues/03-client-bundle-guard.md)、[issues/17-client-source-restore.md](./issues/17-client-source-restore.md)、[issues/19-lib-committed-github-install.md](./issues/19-lib-committed-github-install.md) | **产物链路三件套**：产物被桩不报错、client 源码如何逆向恢复并入库、`lib/` 为什么必须入库（`github:` 源安装能开箱即用的前提）。机制契约在 `scripts/build-client.mjs` 头注 | 改 client 构建 / 动 `lib/` / 市场源安装出问题 |
| [howto/host-version-probe.md](./howto/host-version-probe.md) | 怎么查本机 DSH 宿主的版本与兼容性判定——答案在桌面版 `app.asar` 里，插件仓库任何文件都没有 | 「桌面版升了、插件红了」、要判定宿主代际 |
| [howto/plugin-error-where-to-look.md](./howto/plugin-error-where-to-look.md) | 报错去 **Host 进程**还是 **Client 控制台**看（本插件不是「永远 200」） | 已经知道要看日志，但不确定去哪个进程 |
| [history/README.md](./history/README.md) | **归档补丁**：0.1.x 线的 patch 与说明，每个都已应用到源码树，留档只为可追溯「这块代码为什么长这样」（冻结） | 回溯 0.1.x 历史 |
| [history/0.5.0-abi-cutover.md](./history/0.5.0-abi-cutover.md) | 0.5.0 砍掉 0.1.x ABI 的取证、决定与「为什么下限是 `>=0.2.0-rc.0`」（冻结） | 动设置激活路径 / 宿主代际问题前 |
| [history/2026-10-21-test-tree-type-debt.md](./history/2026-10-21-test-tree-type-debt.md) | 测试树类型检查欠账的由来与处置（冻结） | 疑惑测试文件为什么不在 `typecheck` 射程内 |
| [docs-qoder-cn/](./docs-qoder-cn/) | **上游官方文档转换件**（计费说明、Credits、每日领取、模型折扣与特惠、模型清单）：平台事实的原始出处，供人工核对 | 核对计费系数 / Credits / 签到 / 免费模型，别靠记忆 |

## 文档边界（不在此目录写的内容）

- **代码与测试**：源码改动、补测试、修产物——属实现工作，由对应会话处理；纪律与门禁见 `AGENTS.md`。
- **发布流程**：`RELEASING.md`（根目录）是唯一权威，本目录不重复。
- **平台事实**：`docs-qoder-cn/` 是上游页面的转换件，**以它为准**；插件自己的结论（例如「哪些字段可信」）写在 `KNOWN_GAPS.md` 或对应 issue，不往转换件里掺。
- **现行真相的优先级**：`KNOWN_GAPS.md` 是「缺口声明」的单一真源（`test/docs-facts.test.js` 钉住）；`PLAN.md` / `issues/` / `history/` 是**历史档案**，描述失真是预期内的，冲突时以 `src/` + `KNOWN_GAPS.md` 为准。

## 同步约定

- **新增文档必须登记到上表**，否则没人会读到它（本仓没有「每个 `docs/*.md` 必须被索引」的机械门禁，靠这条约定）。
- **不写死会变的计数**：issue 份数、测试数、套件数一律给「去哪量」，不写数字（理由见 `AGENTS.common.md` §验证约定）。
- 逻辑改动若影响协议、凭据来源、产物链路或路由契约，须同步更新对应文档；根 `README.md` 始终只做安装与用户手册，细节下沉到本目录。
