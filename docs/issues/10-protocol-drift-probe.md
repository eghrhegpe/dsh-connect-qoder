# 上游协议漂移与"没登录"不可区分

**P1 · 规模 M · 依赖 —**

## 症状

这是本插件最根本的品类风险：它克隆私有协议（`COSY_VERSION '1.1.38'`、`CLIENT_TYPE '5'`、
`session_type 'qodercli'`、`Cosy-Data-Policy: disagree`），没有版本协商、没有契约。
上游一次更新就可能让所有请求变成 403 / `10605`，而插件自带的两分钟队列预算会把它当"排队"慢慢等——
**用户看到的是漫长等待，而不是"插件需要更新"**。

平台假设同样无人验证：`MACHINE_OS` 在 darwin 上回落成 `x86_64_linux`，全套件零引用。

## 证据

- `lib/upstream.js:26-40`（RSA 公钥、COSY 版本、客户端类型等协议常量）
- `lib/upstream.js:160-167`（`MACHINE_OS` 的 darwin 分支缺失）
- `lib/upstream.js:1043-1166`（队列等待预算——正是把"形状变化"吞成"排队"的地方）
- `grep MACHINE_OS test/` → 0 命中

## 修法

启动 + 每 6 小时做一次廉价探测（复用 catalog 请求），把结果分成三档并在账号状态里表达：
`ok` / `sign-in-expired` / **`protocol-shape-changed`（新档）**；后者的日志与卡片文案明确指向
"插件需要更新"，并且**不**进入队列重试。同时给 `MACHINE_OS` 补平台断言。

## 验收标准

- [ ] 新用例：模拟"HTTP 200 但信封结构不符合已知形状" → 分类为 `protocol-shape-changed`，不进队列重试
- [ ] 新用例：`darwin` 分支有明确断言
- [ ] 卡片在 `protocol-shape-changed` 时给出的下一步动作 ≠ "重新登录"
