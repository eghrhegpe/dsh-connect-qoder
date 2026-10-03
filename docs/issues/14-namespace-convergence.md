# 设置命名空间有四套说法，失配时整行从设置页消失

**P2 · 规模 S · 依赖 #03 第一步**

## 症状

同一个"命名空间"在仓库里有 **4 套说法**：

1. `cordis.patch.yml:5` 的 Loader 条目 id → `llm-qoder`
2. `lib/index.js:56` 的常量 → `dsh-connect-qoder`
3. `__save` 的候选三元组 `[settingsNs, 'dsh-connect-qoder', 'llm-qoder']`
4. 卡片第三套推导：`entry.ns === "dsh-connect-qoder" || /qoder/i.test(entry.ns)` 交给 `.find`，
   先命中者胜（`lib/client.js:1957`）

失败形态在代码里已写明：宿主按**精确匹配**查 `namespaces.get(entry.settingsNs)`，
不匹配就把该 provider 判为"未配置" → **整行消失，不报错、不灰显**。

## 证据

- `src/host/settings-save.ts`（推导只读 `ctx.fiber.entry?.options.id`，Cordis 本身不提供该字段）
- `lib/client.js:1955-1962`（正则 + `.find`，今天能对上纯属 `llm-qoder` 恰好含 "qoder"）
- `lib/client.js:1990-1992`（三个 slot key：`dsh-connect-qoder` / `dsh-connect-qoder#llm-qoder` / `qoder`，
   与 `llm-qoder` 都不同）

## 修法

推导只留一处并让两侧共享（宿主显式给出或共享同一函数）；先把四套说法的来龙去脉写成一段 ADR
放进 `docs/history/`。**改动卡片前必须先有 #03 第一步的提取测试。**

## 验收标准

- [ ] 仓库里只剩一处命名空间推导，其余位置引用它 —— **仍不可行**：`src/client/index.ts` 与
      `src/host/index.ts` 打进两个 bundle，client 无法 import host 模块（ADR 已登记）。
- [x] 新用例：候选之间不一致时能显式报错（而不是静默消失）—— 已在两处落地：
      (1) `resolveNamespace` 发现宿主**在服务若干命名空间、其中没有本插件的**时打
      `console.error` 并说明修复只需改 `cordis.patch.yml` 的行 id 与两处字面量；
      宿主一个都不服务（无 Loader 条目）时**不**报，那是正常形态，报了就成了噪声；
      (2) `test/plugin-identity.test.js` 新增两条对拍：`PROVIDER_NS` 必须等于
      `cordis.patch.yml` 的行 id（源码与产物各查一次），宿主 fallback
      `QODER_SETTINGS_NS` 必须等于客户端 fallback。两条都做过变异验证。
- [ ] `docs/history/` 有 ADR 说明各套说法的由来 —— 见
      [`../history/0.5.0-abi-cutover.md`](../history/0.5.0-abi-cutover.md) 第 12、38-39 行，
      该文件已覆盖 Loader 条目 id 与共享候选对；缺的只是"为什么不能跨 bundle 共享"一节。

## 为什么"对拍"是这里唯一能做的事

两侧推导**本来就读同一个源**：宿主读 `ctx.fiber.entry.options.id`（Loader 行 id），
客户端读 `configForms.describe()` 的 `namespaces` 列表——都是活的。真正的风险不在推导，
而在 `PROVIDER_NS` 这个**字面量**：`cordis.patch.yml` 改行 id 时，宿主会跟着变，客户端
不会，于是 `resolveNamespace` 找不到就静默回落，slot key 也指向不存在的行。跨 bundle
共享函数做不到，但**把这个字面量钉在它的源上**可以做到，且这正是 `plugin-identity.test.js`
对 `package.json#name` 一直在做的事（同一套思路：一次改名只应改一个文件）。
