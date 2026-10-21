# 第三方致谢与合规（Third-Party Notices）

本插件除下列各项外，源码与文档均为本仓库原创，按根目录 [LICENSE](./LICENSE)（MIT）授权。

## 1. `docs/docs-qoder-cn/` —— Qoder CN 官方文档的转换件

| 项 | 内容 |
|---|---|
| 出处 | Qoder CN 官方文档站 `docs.qoder.cn`（个人订阅计费、Credits、每日领取、模型折扣与特惠、模型清单等页面） |
| 形态 | 抓回后用根目录 `convert-qoder-docs.ps1` 清洗为纯 Markdown；**原始抓取件（`.txt`）已删除**，本目录是唯一留存形态 |
| 目的 | **核对平台事实**（计费系数、Credits 口径、签到规则、哪些模型免费/限时免费），不是再分发内容产品；插件运行时**不读**这些文件 |
| 权利 | 内容版权归 Qoder / 阿里云所有，此处按「引用与核对」用途收录，未做商业再分发 |
| 是否随 npm 包发布 | **否**。`package.json#files` 只含 `lib/`、`locale/*.json`、`cordis.patch.yml`、`icon.svg`、`README.md`、`CHANGELOG.md`；`docs/` 整目录不进包 |
| 清洗规则的门禁 | `test/docs-markdown.test.js`：只查转换器真能损坏的形状（双重转义、注释开合、围栏配对、MDX 残留）并带存活守卫；转换规则改动后重跑该测试 |

文件清单（8 份，含 1 份本仓自写的对照说明）：

| 文件 | 性质 |
|---|---|
| `计费说明.md` | 官方页转换件 |
| `Credits.md` | 官方页转换件 |
| `每日领取 100 Credits.md` | 官方页转换件 |
| `最新模型：Qwen3.8-Flash.md` | 官方页转换件 |
| `Qwen 系列模型特惠折扣.md` | 官方页转换件 |
| `Qwen3.8-Flash 限时免费使用.md` | 官方页转换件 |
| `Qoder CN 模型用量参考系数调整通知.md` | 官方页转换件 |
| `Qoder CN 文档与插件设计佐证.md` | **本仓原创**：把上面每一条平台事实锚到具体源文件（`file:line`），供审查对照；不属第三方内容 |

若权利方要求撤下，删除整个 `docs/docs-qoder-cn/` 目录**还不够**：没有任何代码依赖它（插件运行时
不读这些文件），但 `test/docs-markdown.test.js` 会在模块加载时 `readdirSync` 该目录、并由「存活守卫」
断言其中至少 7 份、每份不短于 200 字符——目录消失时它会**响亮地失败**（这是刻意的：宁可报错，
也不让一个对着空目录跑零次的循环装成绿的）。所以撤下时要一并删除该测试文件，或在其中改为
「目录不存在即跳过」。

## 2. 与本插件通信的上游产品

- **Qoder / Qoder CN**（`qoder.cn`、`qoder.console.aliyun.com`、客户端本地接口）：插件读取本机
  Qoder 桌面应用已登录的凭据并以其名义请求模型。这些**不是**本仓库的代码，也不随包分发；
  使用须遵守 Qoder 的服务条款（README「免责声明」已写明：本项目与 Qoder 无关联）。
- **DSH（DeepSeek Harness）**：宿主运行时提供 `webServer` / `settings` / `llm` 等 peer 服务，
  由宿主安装，不随本包分发。

## 3. 开发期工具链

构建与测试使用 `tsdown`、`typescript`、`react`（peer，不打包）等开源包，均按其各自许可证使用，
**不复制其源码进本仓库**；依赖清单见 `package.json`，锁文件入库。本仓库不内置任何第三方
代码副本，除上文 `docs/docs-qoder-cn/` 的文档转换件外无需额外声明。
