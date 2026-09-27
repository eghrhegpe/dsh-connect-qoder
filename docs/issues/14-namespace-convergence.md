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

- `lib/settings-save.js:89-92`（推导只读 `ctx.fiber.entry?.options.id`，Cordis 本身不提供该字段）
- `lib/client.js:1955-1962`（正则 + `.find`，今天能对上纯属 `llm-qoder` 恰好含 "qoder"）
- `lib/client.js:1990-1992`（三个 slot key：`dsh-connect-qoder` / `dsh-connect-qoder#llm-qoder` / `qoder`，
   与 `llm-qoder` 都不同）

## 修法

推导只留一处并让两侧共享（宿主显式给出或共享同一函数）；先把四套说法的来龙去脉写成一段 ADR
放进 `docs/history/`。**改动卡片前必须先有 #03 第一步的提取测试。**

## 验收标准

- [ ] 仓库里只剩一处命名空间推导，其余位置引用它
- [ ] 新用例：候选之间不一致时能显式报错（而不是静默消失）
- [ ] `docs/history/` 有 ADR 说明各套说法的由来
