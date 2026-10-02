# Credits

## 什么是 Credits

Credits 是 Qoder CN 系列产品调用 AI 模型时使用的计量单位，用于衡量任务消耗的计算资源。以 Qoder CN IDE 为例，以下操作会消耗 Credits：

- Editor
- Inline Chat
- Ask 模式
- Agent 模式
- Quest
- Agent 模式
- Experts 模式
- 知识中心
- RepoWiki
- 知识卡片

实际消耗量由任务复杂度和所用模型决定。

## Credits 共享规则与互通性

自 2026 年 9 月 8 日起，订阅 Qoder CN（全家桶）后获得的 Credits 共享范围如下：

- 个人免费版 Free / 个人专业版 Pro / 个人高级版 Pro+ / 个人旗舰版 Ultra：Credits 可在 Qoder CN、Qoder CN IDE、JetBrains 插件、Qoder CN CLI、Qoder CN Wake、Qoder Cloud Agents、Qoder CN Mobile、QoderWork CN 之间共享消耗。
- 企业 Teams / Enterprise / VPC：Credits 当前可在 Qoder CN、Qoder CN IDE、JetBrains 插件、Qoder CN CLI、Qoder CN Wake、Qoder CN Mobile、QoderWork CN 之间共享消耗。

> **💡 提示**
> Qoder CN（原灵码）订单的 Credits 与全家桶订单的 Credits 不互通。如果您购买的是 Qoder CN（原灵码）个人专业版或企业版（commodityCode 含 `lingma_` 前缀），其 Credits 仅在原灵码产品线内（Desktop / JetBrains 插件）生效，不能在 QoderWork CN 或 Qoder CN CLI 中使用。如需在 QoderWork CN 或 Qoder CN CLI 中使用付费功能，须单独订阅 Qoder CN（全家桶）。

## 扣减与计费规则

- **扣减优先级**：系统会优先消耗最先到期的 Credits，帮助您最大化利用资源。
- **失败请求不扣费**：模型调用失败时不扣减 Credits，仅在调用成功时计费。

## Credits 用尽后

Credits 用尽后：

- 高级模型（Agent 模式、Quest 等高消耗功能）将不可用。
- 系统自动切换到基础模型，继续提供有限的代码补全等基础能力。
- 可购买资源包（即时生效）或等待下一计费周期 Plan Credits 重置。

**Plan Credits 的重置周期以购买日为准**，而非自然月。例如：7 月 5 日购买，下一次重置为 8 月 5 日。到期时未用完的 Plan Credits 不累积到下个周期，会归零重置。资源包（Add-on Credits）有独立的有效期，不跟随订阅周期重置。

## 查看 Credits 使用情况

### 在产品内查看

- **Desktop、JetBrains 插件：**在窗口右下角点击 Credits 用量按钮，查看当前用量。
- **QoderWork CN：**在应用右上角点击 Credits 用量按钮，查看当前用量。
- **Qoder CN CLI ：**执行内置斜杠命令 `/usage`，查看当前账户的 Credits 用量。

### 在 Qoder CN 官网查看

仅 QoderWork CN 和 Qoder CN CLI 支持在官网查看用量。

登录 [Qoder CN 官网](https://qoder.cn/account/usage)，点击右上角头像，进入 **Settings > Usage**，查看当前方案信息以及各类 Credits 的可用余额与使用明细：

- **Plan Credits**：方案包含的 Credits，在当前订阅周期内有效，周期结束时归零。
- **Add-on Credits（资源包）**：通过购买或活动获得，仅供个人使用。
- **消耗优先级**：优先使用最先到期的 Credits；到期时间相同时，先扣 Plan Credits，再扣 Add-on Credits。
- **到期时间**：不同来源的 Credits 到期时间不同，可在 Credits 日志中查看。实际到期时间可能因升级等操作提前，详见下文「Credits 日志」。

## 消耗异常排查

如果您感觉 Credits 消耗比预期快，请参考以下常见原因。

### Agent 模式消耗远大于 Ask 模式

Agent 模式在后台会触发多次模型调用（工具调用、代码修改、验证等），单次 Agent 请求的消耗通常是 Ask 模式的 2–4 倍。Quest Experts 模式并行协调多个智能体，消耗最高。如果日常使用以对话咨询为主，建议优先使用 Ask 模式以节省 Credits。

### 上下文窗口越大，消耗越高

200K 上下文窗口的请求比 50K 的消耗更高。如果项目文件较多且已开启自动上下文，实际消耗会高于 50K 上下文窗口的参考值。

### 对话重试或刷新也会消耗

每次重试或刷新对话内容都会触发一次新的模型调用并产生独立计费。反复重试同一个问题会累计消耗。

### 简单任务可关闭思考模式或切换轻量模型

思考模式让模型在回答前进行更深入的推理，对复杂问题更准确，但会额外消耗 token。

- 对于简单问答、格式转换、信息提取等不需要深度推理的任务，建议关闭思考模式。此类任务关闭思考模式几乎不会影响结果，响应通常更快、消耗更低。
- 对于涉及多步推理、代码逻辑、方案设计等复杂任务，可以考虑开启思考模式。

不同模型的尺寸和计费单价不同。处理简单任务时，建议切换到轻量模型并新开对话。模型选择器提供的消耗倍率是 Qoder 产品团队基于特定任务场景模拟测算的相对参考值，仅供参考，不作为实际抵扣依据；实际 Credits 抵扣以真实请求产生的服务消耗为准。

### 更换话题或切换模型时建议新开对话

旧对话的上下文会持续带入后续请求，即使不再相关也会产生额外模型消耗。新开对话可以清除无关上下文，从零开始。

### 系统异常导致循环消耗

如果客户端持续显示“系统繁忙”，但后台不断刷新且 Credits 异常快速下降，可能是系统异常。请：

1. 立即关闭当前对话或退出应用。
2. 通过 IDE 或 QoderWork 内的反馈入口上报问题。
3. 附上时间段和异常行为描述，以便团队核查用量。

## Credits 日志

Credits 日志记录了所有 Credits 的获取历史，包含获取原因、数量、生效日期和到期日期。常见的获取类型：

| **Description** | **说明**     |
| ------------------ | ------------- |
| Plan Credits       | 方案包含的 Credits |
| Credit Purchase    | 资源包购买         |

日志中的到期日期为发放时的初始预估值。升级方案等操作可能使实际到期日期提前，请结合方案变更记录确认。

Credits 日志仅记录获取信息。如需查看当前可用余额，请前往 Usage 页面的 Credits 卡片。

## 常见问题

### Qoder CN 的 Credits 与 Qoder 的 Credits 等价吗？

否。Qoder CN 与 Qoder 定价不同，两者的 Credits 不等价，不可互通使用。

### 购买了资源包，但用量页面没有显示？

请确认查看的页面与产品线一致：Qoder CN（原灵码）请前往 [Qoder CN 控制台](https://qoder.console.aliyun.com)，Qoder CN（全家桶）请前往 [Qoder CN 官网](https://qoder.cn/account/usage)。两条产品线的用量不互通。如确认产品线正确仍未显示，请退出账号后重新登录。

### 为什么 QoderWork CN 里看不到我的原灵码订阅额度？

Qoder CN（原灵码）订单的 Credits 不在 QoderWork CN 中生效。QoderWork CN 属于全家桶产品线，需要单独订阅 Qoder CN（全家桶）才能使用付费功能。详见上文[Credits 共享规则与互通性](#credits-共享规则与互通性)。
