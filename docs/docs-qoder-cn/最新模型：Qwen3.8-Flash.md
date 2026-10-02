# 最新模型：Qwen3.8-Flash

> 了解千问最新模型 Qwen3.8-Flash 的架构创新、能力、规格与接入方式

Qwen3.8-Flash 采用下一代架构（Qwen4 架构预览），总参数 125B 仅激活 6B，以不到 Qwen3.7-Plus 九分之一的训练成本，在编程与办公任务上实现超越 Claude Opus 4.6 的前沿性能。原生支持百万级上下文、图文视频多模态理解，在智能体编程、长程办公自动化和多模态理解方面表现尤为突出。

Model ID：`qwen3.8-flash`

## 核心亮点

**下一代架构** — 沿注意力、残差、嵌入和优化四个维度系统升级：GDN + QSA 混合注意力高效"记忆"并精准"检索"，1M 上下文预填充加速 7.6 倍；门控残差将信息流扩展为 4 条并行通道；N-gram Embedding 以 51B 额外参数近乎零额外计算扩展模型容量；Muon 优化器进一步提升收敛效率。

**智能体编程** — SWE-bench Pro 62.5（超越 Claude Opus 4.6 的 53.4），DeepSWE 1.1 达 58.7，多语言软件工程 81.0。能自主搭建并迭代编程工具，独立完成跨越数天的真实项目。

**办公与工具调用** — CoWorkBench 73.9（长程办公自动化），JobBench 55.7（专业任务），Toolathlon 73.5（真实工具调用）。覆盖法律、金融、设计等数百种专业场景，在数千轮交互中持续规划与闭环迭代。

**多模态智能体** — AndroidWorld 84.5（移动端操控），MathVision 95.7（视觉数学），LVBench 76.6（长视频理解）。原生视觉理解贯穿规划、执行与验证全流程，能跨页理解超长文档并自主发现界面问题。

以上完整评测数据详见[发布博客](https://qwen.ai/blog?id=qwen3.8-flash-next)。

## 模型能力与规格

| 能力                                                               | 支持 | 能力                                                           | 支持 |
| ---------------------------------------------------------------- | -- | ------------------------------------------------------------ | -- |
| [文本生成](/developer-guides/getting-started/text-generation-models) | ✓  | [深度思考](/developer-guides/text-generation/thinking)           | ✓  |
| [函数调用](/developer-guides/tool-calling/function-calling)          | ✓  | [结构化输出](/developer-guides/text-generation/structured-output) | ✓  |
| [图像理解](/developer-guides/multimodal/vision)                      | ✓  | [视频理解](/developer-guides/multimodal/vision)                  | ✓  |
| [上下文缓存](/developer-guides/run-and-scale/context-cache)           | ✓  | [批量推理](/developer-guides/text-generation/batch)              | ✓  |
| [联网搜索](/developer-guides/tool-calling/web-search)                | ✓  | [PDF 理解](/developer-guides/tool-calling/pdf-understanding)   | ✓  |
| [代码解释器](/developer-guides/tool-calling/code-interpreter)         | ✓  | [网页抓取](/developer-guides/tool-calling/web-scraping)          | ✓  |
| [以文搜图](/developer-guides/tool-calling/image-search)              | ✓  | [以图搜图](/developer-guides/tool-calling/image-search)          | ✓  |

| 参数           | 值               | 参数           | 值             |
| ------------ | --------------- | ------------ | ------------- |
| 上下文长度        | 1,000,000 token | 最大思维链长度      | 262,144 token |
| 最大输入长度       | 991,808 token   | 最大输出长度       | 131,072 token |
| 最大输入长度（思考模式） | 983,616 token   | 最大输出长度（思考模式） | 131,072 token |

定价详情见[模型市场](https://www.qianwenai.com/models/qwen3.8-flash)。

## 快速接入

```python Python
  import os
  from openai import OpenAI

  client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://maas.qianwenaiapi.com/compatible-mode/v1"
  )

  response = client.chat.completions.create(
    model="qwen3.8-flash",
    messages=[
      {"role": "user", "content": "用动态规划解决最长递增子序列问题，给出时间复杂度分析。"}
    ]
  )
  print(response.choices[0].message.content)
  ```

  ```javascript Node.js
  import OpenAI from "openai";

  const client = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: "https://maas.qianwenaiapi.com/compatible-mode/v1"
  });

  const response = await client.chat.completions.create({
    model: "qwen3.8-flash",
    messages: [
      { role: "user", content: "用动态规划解决最长递增子序列问题，给出时间复杂度分析。" }
    ]
  });
  console.log(response.choices[0].message.content);
  ```

  ```bash curl
  curl -X POST https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "qwen3.8-flash",
      "messages": [
        {"role": "user", "content": "用动态规划解决最长递增子序列问题，给出时间复杂度分析。"}
      ]
    }'
  ```

## 使用说明

### 深度思考

默认开启思考模式，通过 `reasoning_effort` 调节推理力度：

| 值           | 说明      | 适用场景           |
| ----------- | ------- | -------------- |
| `xhigh`（默认） | 最大推理深度  | 数学证明、架构设计、复杂编程 |
| `medium`    | 平衡推理与速度 | 日常开发、文档生成      |
| `low`       | 快速响应    | 简单问答、信息提取      |

`max` 和 `high` 会自动映射为 `xhigh`。思考模式下 temperature 默认 0.6，传入更小值会自动调整为 0.6。如需整体关闭思考，可设置 `enable_thinking=false`，模型将直接作答、不再返回 `reasoning_content`。

### 多模态理解

Qwen3.8-Flash 支持图片、视频和文本的联合理解，适合需要视觉信息参与决策的 Agent 场景。

- **图片理解**：在消息中传入 `image_url` 类型内容，模型直接分析图片内容。支持截图分析、设计稿还原、文档 OCR 等任务。高分辨率图像默认会被压缩，可通过 `vl_high_resolution_images`、`max_pixels` 调整视觉 token 上限以保留更多细节。
- **视频理解**：传入视频 URL，模型自动抽帧分析。通过 `fps` 控制抽帧频率，在细节捕获与成本间取得平衡。适合视频内容审核、教程摘要、会议记录等场景。
- **PDF 理解**：以 `file_url` 或 Base64 `file_data` 传入 PDF，模型解析其中文字与图片。

详细用法参见[图像与视频理解](/developer-guides/multimodal/vision)与[PDF 理解](/developer-guides/tool-calling/pdf-understanding)。

### 工具调用与思考链

开启思考后进行工具调用，模型会先推理应调用哪些工具、如何使用返回结果，再生成回答；响应中工具调用前会包含 `reasoning_content`，多轮工具调用时需将其一并回传，省略会降低准确性。

多轮对话中，模型默认不读取历史消息里的 `reasoning_content`；qwen3.8-flash 的 `preserve_thinking` 默认开启，会将思考过程拼接到下一轮输入。

详细规则参见[思考模式](/developer-guides/text-generation/thinking)与[函数调用](/developer-guides/tool-calling/function-calling)。

### 上下文缓存

上下文缓存将重叠请求的公共前缀进行缓存，避免重复计算，在不影响回答质量的前提下降低成本、加快响应：

| 模式   | 说明                                                         |
| ---- | ---------------------------------------------------------- |
| 隐式缓存 | 自动开启，系统识别公共前缀缓存，不保证命中                                      |
| 显式缓存 | 手动创建，确定性命中，更低延迟                                            |
| 会话缓存 | Responses API 专用，请求头添加 `x-dashscope-session-cache: enable` |

详细用法与计费参见[上下文缓存](/developer-guides/run-and-scale/context-cache)。

## 在编程工具中使用

在 Claude Code、Codex、OpenCode 等编程工具中使用 Qwen3.8-Flash，推荐订阅 [Token Plan](/token-plan/overview)——以 Credits 统一计量、支持 Qwen3.8-Flash 及其他多种模型，较按量计费更优惠。
