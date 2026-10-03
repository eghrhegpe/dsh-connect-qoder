# 目录刷新"成功但 0 个模型"时冻结，用户点刷新也没有出口

**P0 · 规模 S · 依赖 —**

## 症状

`fetchModels` 成功返回 0 个模型时，既不 `replace` 也不推进抓取时间——"成功但空"与"失败"
被合并成同一条静默路径。账号被收窄或模型全部下线时，卡片与选择器**继续展示上一份目录**。

## 证据

- `lib/index.js:377-386`：`if (entries.length > 0) { this.catalog.replace(entries); this.invalidate?.() }`，
  抛错另有 catch，所以这个长度判断只把"成功但空"和"失败"混为一谈
- 调用形态只有 `refreshCatalog(true)`（`lib/index.js:837` / `1064` / `1159` / `1162`），
  因此 `lib/index.js:368` 的 `if (!force && this.catalog.fresh()) return` 是**死代码**

## 修法

1. 空结果也 `replace([])` 并推进 `fetchedAt`；
2. 卡片上给出"上游当前没有可用模型"这类可读状态（而不是让人以为还在加载）；
3. 顺手删掉 TTL 死分支，或补一个真正的 `force=false` 调用者。

## 验收标准

- [x] 新用例：`fetchModels` 返回 `[]` → 目录被清空 + `fetchedAt` 前进 + `invalidate` 被调用
- [x] 新用例：`fetchModels` 抛错 → 目录**不变**（保留上一份好数据），两者不再混同
- [x] `test/catalog-store.test.js` + 新用例全绿

## 实现（已修，`f8ca26f`）

规则抽到 [`../../src/host/catalog-refresh.ts`](../../src/host/catalog-refresh.ts) 的 `applyCatalogOutcome`，
`RegionRuntime.doRefreshCatalog` 改为把三种结果交给它——因为 `src/host/index.ts` 有 peer 依赖、测试
import 不到，规则本身必须住在够得着的地方（与 `credential-cache.ts` / `catalog-entry.ts` 同套路）。

**原方案第 3 条（删 TTL 死分支）没有做，改为保留**：`if (!force && this.catalog.fresh()) return`
原被指为死代码，但它与新语义是一对——空目录落盘后 `fetchedAt` 会前进，于是这个分支重新有了
真实含义（"目录还新鲜，别去打扰上游"），删掉它反而会让每次卡片读都打一次上游。

**边界来自实测，不是推断**：删掉 `length > 0` 之前先用 [`../../probe/model-shape.mjs`](../../probe/model-shape.mjs)
打了两端真实账号的信封（`chat: array(14)` / `array(17)`，`byok_teams: array(0)`）。两条实测事实决定了
判别式：**空分组用 `[]` 表达**，所以"0 个模型"是可信结果、必须落盘；而"分组键缺失"才是形状变化，
归 issue 10（[`10-protocol-drift-probe.md`](10-protocol-drift-probe.md)）。两者共用一条分界线。

**验收标准的第 2 条**（卡片给出"上游当前没有可用模型"的可读状态）由既有文案承担：
`row.regionEmpty`（"这个版本当前没有可展示的模型…"）此前在 `models.length > 0 && regionModels.length === 0`
时渲染，目录真被清空后它就会显示，未新增文案。

**变异验证**（不是推断）：把空结果重新改成整段跳过，`test/catalog-refresh.test.js` 6 条变红。

