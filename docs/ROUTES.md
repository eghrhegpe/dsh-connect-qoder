# 回环路由契约（12 条）

> **这份文件是什么**：本插件注册在宿主 `webServer` 上的**全部**路由，一条一行，写明方法、
> 能不能改状态、谁在调、干什么。它是「哪些接口能替我动账号」这个问题的唯一答案。
>
> **为什么单独成篇**：README 的安全段曾写「七条路由里三条是 POST」，而 2026-10-17 设备登录
> 落地一次加了 4 条写路由（`b546635`），此后连发两版都没回头改那个数。数字写进散文里就会
> 这样腐坏：**读者拿它去审计，少掉的恰是「登出并删凭据」那一条**。所以清单放在这里按行维护，
> README 只留一句结论 + 本文件的链接。

**真源**（三处必须同时改）：

| 层 | 文件 | 提供什么 |
|---|---|---|
| 路径常量（卡片侧） | `src/client/paths.ts` | 10 个 `QODER_*_PATH`；`__save` 在 `settings-write.ts` 里以字面量出现 |
| 注册点（宿主侧） | `src/host/index.ts` | 12 个 `path:` 挂载项，分两组 `mountRouteGroup` |
| 方法门 | `src/host/handlers.ts` | 每个 handler 第一行 `methodAllowed(req, res, 'GET'|'POST')` |

## 1. 清单

`P` = `/plugins/dsh-connect-qoder`。

| # | 方法 | 路径 | 改状态 | 谁在调 | 作用 |
|---|---|---|---|---|---|
| 1 | GET | `P/models` | 否 | 卡片（`QODER_MODELS_PATH`） | 模型名册：每版区域的行、单价/折扣、可用性、`providerRegistrationError` |
| 2 | GET | `P/usage` | 否 | 卡片（`QODER_USAGE_PATH`） | 用量：套餐内额度与剩余 Credits、今日请求/token（含缓存命中）、7 天趋势、签到状态 |
| 3 | GET | `P/account` | 否 | 卡片（`QODER_ACCOUNT_PATH`） | 账号：每版区域的登录态、`enabledRegions`、标签条文案 |
| 4 | GET | `P/status` | 否 | **无卡片消费者**，供宿主/诊断 | 注册结果自述：哪几条路由挂上了、provider 注册失败的原因（`QODER_STATUS_PATH` 自身的注释解释了为什么需要它） |
| 5 | POST | `P/__save` | **是**（写宿主设置） | 卡片（`settings-write.ts`，字面量） | 写三个字段（模型勾选 / 图像模式 / 每版开关）到宿主设置，写完读回校验；宿主无 settings 服务时 503（而不是假装存上了） |
| 6 | POST | `P/checkin` | **是**（真实账号变更） | 卡片（`QODER_CHECKIN_PATH`） | 领取当日签到积分；轮次由宿主决定，卡片不能自己指定活动 |
| 7 | POST | `P/account/reload` | **是**（读凭据 + 拉起 runtime） | 卡片（`QODER_ACCOUNT_RELOAD_PATH`） | 「重读登录」：重读各版登录态，把回来的那版重新拉起 |
| 8 | POST | `P/account/confirm` | **是**（唯一联网校验） | 卡片（`QODER_ACCOUNT_CONFIRM_PATH`） | 「在线确认」：`fetchUserInfo` 回答「上游现在还认不认这个登录」，失败按 `classifyUpstreamError` 分档 |
| 9 | POST | `P/device-login/start` | **是**（起授权流程） | 卡片（`QODER_DEVICE_LOGIN_START_PATH`） | 开授权页：返回一个用户要在浏览器里批准的 URL |
| 10 | GET | `P/device-login/poll` | 否 | 卡片（`QODER_DEVICE_LOGIN_POLL_PATH`） | 轮询一次待批准的设备登录（这是设备登录组里唯一的读） |
| 11 | POST | `P/device-login/cancel` | **是**（放弃流程） | 卡片（`QODER_DEVICE_LOGIN_CANCEL_PATH`） | 取消一次待批准的设备登录 |
| 12 | POST | `P/device-login/signout` | **是**（**删凭据**） | 卡片（`QODER_DEVICE_LOGIN_SIGNOUT_PATH`） | 删掉本插件为该区域存的那份令牌 |

合计 **12 条：5 条 GET、7 条 POST**；其中 **7 条能改状态**（#5–#9、#11、#12）。

## 2. 两条挂载纪律

两组路由是**全挂或全撤**（`mountRouteGroup`，见 `src/host/route-mount.ts` 头注）：

- **账号组 `P/account`、`P/account/reload`、`P/account/confirm`**：只收下第一条会留下一个
  「能读状态、两个按钮不动」的半截面板，而日志还写着 "account routes unavailable"——那句话
  是假的，比没有日志更坏。
- **设备登录组 `P/device-login/*` 四条**：只有 start 没有 poll 等于开完浏览器什么也不报；
  只有 poll 没有 signout 等于用户拿不回自己的凭据。

组内任一注册被拒 → 已拿到的 release 全部回滚，并**如实**报失败。

## 3. 每条的公共闸（在业务判定之前）

| 闸 | 行为 | 落点 |
|---|---|---|
| 方法 | 不匹配回 405 并带 `Allow` 头；`HEAD` 交给 GET 处理 | `methodAllowed` |
| 同源 | 来源的**地址与端口**必须等于请求实际拨到的地址（比对 `Host` 头，不写死端口），且必须是回环地址，否则 403 | `originAllowed` / `loopbackRequest` |
| 请求体 | POST 的 JSON body 上限 **64 KiB**（`readJsonBody(req, maxBytes = 64 * 1024)`），超限即拒 | `readJsonBody` |

同源检查是 0.7 代的主要安全变更：此前只判「来源主机名是不是本机」，于是**本机任意端口上的
任意 HTTP 服务**都能让它的网页代为签到/改勾选（浏览器挡的是跨域读响应，不是发出请求）。

## 4. 改路由时必须一起动的地方

1. 本表（一行一条，含方法）；
2. `README.md` 安全段那句「十二条路由里七条是 POST」；
3. `src/client/paths.ts`（新增/改名常量）与 `src/client/http.ts` 的调用点；
4. `test/route-gates.test.js`（方法/同源闸）与 `test/account-route-wiring.test.js`（挂载接线）；
5. 若新路由进了 npm 包外的文档口径，确认 `package.json` 的 `files` 仍只含那 6 项。

本表与代码的差异由根目录 `check-docs-consistency.mjs` 抓（数一遍 `index.ts` 的 `path:` 与
本表的行数，再比 README 里那句 POST 数）。
