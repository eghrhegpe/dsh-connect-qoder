# 上游协议漂移与"没登录"不可区分

**P1 · 规模 M · 依赖 —**

## 症状

这是本插件最根本的品类风险：它克隆私有协议（`COSY_VERSION '1.1.38'`、`CLIENT_TYPE '5'`、
`session_type 'qodercli'`、`Cosy-Data-Policy: disagree`），没有版本协商、没有契约。
上游一次更新就可能让所有请求变成 403 / `10605`，而插件自带的两分钟队列预算会把它当"排队"慢慢等——
**用户看到的是漫长等待，而不是"插件需要更新"**。

平台假设同样无人验证：`MACHINE_OS` 在 darwin 上回落成 `x86_64_linux`，全套件零引用。

## 证据

- `src/host/upstream.ts`（RSA 公钥、COSY 版本、客户端类型等协议常量）
- `src/host/upstream.ts` 的 `MACHINE_OS`（darwin 分支缺失）
- `src/host/upstream.ts`（队列等待预算——正是把"形状变化"吞成"排队"的地方）
- `grep MACHINE_OS test/` → 0 命中

> 行号已移除：旧引用写的是 `lib/upstream.js:160-167` 之类，那是**打包产物**的行号。
> `lib/` 现在只有 `index.js`/`client.js` 两个文件，子模块的行号不再对应任何东西
> （实测 `MACHINE_OS` 现在在 `src/host/upstream.ts:167`，与旧行号只是巧合接近）。
> 按**符号名**查比按行号查可靠。

## 修法

启动 + 每 6 小时做一次廉价探测（复用 catalog 请求），把结果分成三档并在账号状态里表达：
`ok` / `sign-in-expired` / **`protocol-shape-changed`（新档）**；后者的日志与卡片文案明确指向
"插件需要更新"，并且**不**进入队列重试。同时给 `MACHINE_OS` 补平台断言。

## 验收标准

- [x] 新用例：模拟"HTTP 200 但信封结构不符合已知形状" → 分类为 `protocol-shape-changed`，不进队列重试
- [x] 新用例：`darwin` 分支有明确断言
- [x] 卡片在 `protocol-shape-changed` 时给出的下一步动作 ≠ "重新登录"

## 实现（分诊已修 `f8ca26f`；6 小时周期探测仍未做）

三档分诊落地，**周期探测没做**：现在每一次目录请求都在分诊（30 分钟的 TTL 刷新本身就是"每 30 分钟
一次"），所以"启动 + 每 6 小时另做一次廉价探测"这个额外机制目前没有独立价值——它原本要防的正是
"请求失败时什么都不说"，而这已由刷新失败标志覆盖。要不要额外保留一条独立心跳（用于上游长期静默
不可达时也留痕）留待以后。

**判别式写在 [`../../src/host/upstream.ts`](../../src/host/upstream.ts) 的 `readModelCatalogShape`**，
界线取自 [`../../probe/model-shape.mjs`](../../probe/model-shape.mjs) 的**实测**（两端真实账号）：

| 收到 | 判定 | 理由（实测事实） |
|---|---|---|
| `chat: []` | 空目录（issue 04 落盘） | 空分组用 `[]` 表达（`byok_teams` 长度 0） |
| 缺 `chat`、有别的分组 | `protocol-shape-changed` | 分组被改名或重组 |
| `chat` 非数组 / 顶层非对象 | `protocol-shape-changed` | 新包装层 |
| 缺某个兄弟分组 | **正常** | 国际版实测就没有 `developer` |

最后一行是关键：把形状钉在"我在 CN 上见过的全部分组"上，会把国际版的每一次例行响应都判成漂移。

**不进队列**靠 `ProtocolShapeChangedError` 上的 `retryable = false`（[`../../src/host/errors.ts`](../../src/host/errors.ts)），
`queueWaitFor` 因此立即返回 `undefined`——这正是"插件坏了"被当成"在排队"耗掉两分钟预算的那一处。
反方向也有断言：真实队列拒绝仍然照常等待。

**`MACHINE_OS` 补 darwin 之前先量了网关是否认**
（[`../../probe/machineos-probe.mjs`](../../probe/machineos-probe.mjs)：四个 linux/darwin 取值、两端区域、
各 200 且 `chat` 行数完全一致），所以补分支是安全的。**推论也写进了注释**：网关不按这个字段分流，
因此它不能用来检测"平台填错"，它只是一句关于本机的事实。

**验收标准第 3 条的落法**：`refreshNoticeKey` 把 `refreshFailures` 折叠成一个判定，卡片据此显示
"请更新插件（重新登录没有用）"，且**不**显示时间戳——时间戳摆在"你的插件过时了"旁边会让人以为
屏幕上的模型还是当前的。文案本身被断言（不许以"请重新登录"收尾），见 `test/protocol-shape-card.test.js`。

**残留缺口**：`fetchModels` 之外的上游端点（usage / campaigns / userinfo）**没有**做信封形状分诊——
它们各自只取自己那几个字段，形状变化的表现会是"字段读不到"而非漂移告警。chat 端点是最常打的一个，
先分诊它。
