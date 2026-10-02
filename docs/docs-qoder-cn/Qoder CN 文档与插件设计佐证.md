# Qoder CN 文档与 dsh-connect-qoder 插件设计佐证

> 本目录下的 `*.md` 是从 Qoder CN 官方文档（`docs.qoder.cn`）抓回并清洗为纯 Markdown 的资料。
> 它们**不是孤立素材**——本仓库 `dsh-connect-qoder` 正是一个把本机已登录的 Qoder 模型接入
> DeepSeek Harness 的插件，而这些文档正是它对接的**上游产品（Qoder CN）的官方说明**。
> 以下逐条比对：文档里的概念在插件代码里都有对应实现，可佐证文档与现有设计自洽。

## 1. 模型阵容与「始终思考」模型

| 文档出处 | 文档内容 | 插件代码佐证 |
| --- | --- | --- |
| `最新模型：Qwen3.8-Flash.md` | `reasoning_effort` / `enable_thinking`、深度思考档位 | `src/host/shim.ts`（`DEFAULT_THINKING_EFFORT='low'`、`THINKING_LEVEL_RANK`）、`src/host/pi-model.ts`（`thinkingLevelMapFor`，注释明确提到 `provider_error 1210`） |
| `README.md:118` | `GLM-5.3-Flash`、`Kimi-K3` 声明推理档位但**不允许关闭思考**，发 `enable_thinking:false` 会被上游以 `provider_error 1210` 拒绝；插件**完全省略**该字段 | `src/host/domain.ts:414`：`alwaysThinking` 与 `enableThinking` 区分——前者标记"拒绝 `enable_thinking:false` 的模型"，后者是请求里的开关；`pi-model.ts:251-254` 注释直接写出 `provider_error 1210` |

**结论**：文档中"Qwen3.8-Flash 默认开启思考、可用 `reasoning_effort` 调节"与插件对 `alwaysThinking` 模型的特殊处理（省略字段而非发送 `false`）互为印证；README 点名的 `GLM-5.3-Flash`/`Kimi-K3` 也出现在系数调整通知表里，是同一批模型。

## 2. 错峰折扣（22:00–08:00）

| 文档出处 | 文档内容 | 插件代码佐证 |
| --- | --- | --- |
| `Qwen 系列模型特惠折扣.md` | 错峰时段 **北京时间 22:00–08:00**，Qwen3.8-Max / Qwen3.7-Plus 享 4 折（0.2x / 0.04x） | `src/host/offpeak.ts`：`windowIsOpen` 专门处理"结束不晚于开始"的跨午夜窗口（`22:00`–`08:00` 正是该 case），并强制按 `Asia/Shanghai` 解析；`effectiveRate` 用 `before × discount` 还原折前/折后价 |
| `README.md:127` | 日次数用尽时给出"22:00-08:00 错峰价"作为仍有效的路 | `src/host/offpeak.ts` 顶部注释："reading `price_factor` alone understates the cost … during working hours these models bill at the *before* rate, which is 2.5x to 5x higher"——与文档"常规时段无折扣、折后仅影响计价"一致 |

**结论**：文档的时段、币种（Credits 倍率）、"仅影响计价不影响质量"三要素，都被 `offpeak.ts` 的本地时钟算术精确实现，且注释里点名的 `22:00 rate flip` 正是文档的错峰边界。

## 3. 每日签到 100 Credits

| 文档出处 | 文档内容 | 插件代码佐证 |
| --- | --- | --- |
| `每日领取 100 Credits.md` | 每日 **10:00（UTC+8）** 开放领取、每轮 **100 通用 Credits**、需主动领取、30 天有效 | `src/host/claim.ts:5-6`："Qoder hands each account a fresh campaign every day at **10:00 (UTC+8)** — a new `campaignId` each round, always carrying a **100-Credit** benefit"；`src/client/copy-usage.ts`：`usage.checkinAvailable` = "今日可领 {amount} Credits" |
| 同上 | 领取入口、过期不补 | `src/host/index.ts` `QODER_CHECKIN_PATH = '/plugins/dsh-connect-qoder/checkin'`、`src/host/claim.ts` 的 `checkinStateFrom`（区分 `todayCheckedIn` / `alreadyClaimed`） |

**结论**：文档的"每日 10:00 / 100 Credits / 主动领取"，与 `claim.ts` 的字段级证据（`actionType=CLAIM_BENEFIT`、`claimStatus` 门控、10:00 UTC+8）完全对应，连"错过不可补领"也由 `alreadyClaimed` 状态落实。

## 4. 绑定模型的资源包（免费额度）

| 文档出处 | 文档内容 | 插件代码佐证 |
| --- | --- | --- |
| `Qwen 系列模型特惠折扣.md` / `Qwen3.8-Flash 限时免费使用.md` | 特定模型（如 Qwen3.8-Max）的专属折扣/免费额度 | `src/host/upstream.ts:781-782` 注释："`Qwen3.8-Max 免费额度 1402 / 2000 次` — a package bound to a set of models"；`normalizeDedicatedPackage` 处理"绑定到具体模型而非整个账号"的资源包 |

**结论**：文档里的"某模型限时免费 / 专属折扣"在产品侧表现为 per-model 资源包，插件正是按这种包结构去归一化用量面板。

## 5. Credits 计量与跨产品共享

| 文档出处 | 文档内容 | 插件代码佐证 |
| --- | --- | --- |
| `Credits.md` | Credits 是计量单位、Plan / Add-on 分类、扣减优先级、失败不扣费 | `src/host/upstream.ts` `normalizeBucket`（`unit` 默认 `'credits'`、优先消耗最早到期）、`src/client/copy-usage.ts` `usage.planCredits` / `usage.credits` |
| `计费说明.md` | Qoder CN 全家桶跨产品共享 Credits | `src/host/credentials.ts:193-194` 把 `Qoder CN / QoderWork CN` 等归到同一 `displayName: 'Qoder CN'` 区域；`README.md:133` 账号状态按区域收敛 |

**结论**：文档对 Credits 的定义、分类、共享范围，与插件"按 region/catalog 归一化用量"的实现口径一致。

## 6. 上游错误语义（日次数 vs 排队）

| 文档出处 | 文档内容 | 插件代码佐证 |
| --- | --- | --- |
| `README.md:123-130` | 上游把"今日请求次数用完"伪装成排队（约两小时重试），实为日次数耗尽→改为 **429** 独立状态 | `src/host/errors.ts` `classifyUpstreamError`："先认 110、再认队列标记"，由 `test/daily-limit.test.js` 钉住；`src/host/index.ts:1285-1313` 返回 `alreadyClaimed` / 限流状态 |

**结论**：这是 README 自述的已知行为，底层依据正是 Qoder 上游的报文语义——与文档所述"每日次数上限/错峰不计入日次数"相衔接。

## 总评

- 文档覆盖的**模型命名、系数、错峰时段、每日签到额度、资源包形态、Credits 计量**六条主线，在 `src/host/*`（upstream / offpeak / claim / catalog-entry / pi-model / shim）和 `README.md` 里均有**逐字段级别**的实现对应。
- 插件 README 与代码注释中**直接写明的型号名（`GLM-5.3-Flash`、`Kimi-K3`、`Qwen3.8-Max`）、错误码（`provider_error 1210`）、时间点（10:00 UTC+8、22:00–08:00）**，都能在文档里找到官方出处，说明文档是插件对接的权威信源，而非杜撰。
- 因此这批 `.md` 可作为**上游协议的事实基准**：上游若调整系数/活动（如系数通知里 DeepSeek-V4-Pro 0.8→0.5、Kimi-K3 0.8→1.4），插件的 `offpeak.ts` / `catalog-entry.ts` 只需从 catalog 实时读取，无需硬编码——这正与文档"参考系数周期性校准、不影响实际消耗"的设计意图吻合。

> 注：抓取时间为 2026-09 下旬；若需对外发布，建议以 `docs.qoder.cn/llms.txt` 索引的最新页面复核系数与活动结束时间。
