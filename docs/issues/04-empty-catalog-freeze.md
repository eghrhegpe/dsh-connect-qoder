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

- [ ] 新用例：`fetchModels` 返回 `[]` → 目录被清空 + `fetchedAt` 前进 + `invalidate` 被调用
- [ ] 新用例：`fetchModels` 抛错 → 目录**不变**（保留上一份好数据），两者不再混同
- [ ] `test/catalog-store.test.js` + 新用例全绿
