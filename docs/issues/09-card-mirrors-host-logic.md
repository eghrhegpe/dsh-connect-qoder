# 卡片自算错峰价与窗口标签，与宿主算法分歧（第三处镜像）

**P1 · 规模 M · 依赖 #03 第一步（产物守卫）**

## 症状

宿主已经把 `effectiveRate` / `offPeakActive` / `promotion.remainingSeconds` / `contextWindow` /
`contextWindowLabel` 发到卡片，卡片**一个都不读**，全部自算。历史上已因此出过
"把拿不到的折扣价显示给用户"的缺陷（宿主按 `before` 价计费，卡片显示折后价）。
现在**又有现场分歧**：`contextOptions=[128000,200000]` + `defaultContextWindow=0` 时，
宿主判定"非真实窗口"不显示标签，卡片取 `widest` 显示 `128K`。

## 证据

- 错峰：`lib/offpeak.js`（单一事实源）vs `lib/client.js:622-693`（卡片 `offPeakState` / `rateAt`）
- 窗口标签：`lib/pi-model.js:109-134` vs `lib/client.js:664-670`（`windowLabelOf`）
- 测试守卫现状：`test/model-row.test.js:44-118` 是**手抄副本**；
  `test/client-bundle.test.js:87-96` 只是一句产物文本断言
- `docs/KNOWN_GAPS.md:76-99` 已把这条列为"价值最高的待办"

## 修法

卡片改读宿主字段，删掉自算路径。**在 #03 第一步的提取测试到位之前，不要再往卡片加新的判定逻辑。**

## 验收标准

- [ ] 对拍用例：同一 catalog 条目，卡片侧与宿主侧算出的费率/标签逐状态相等
      （含 `promotion.active=false`、`defaultContextWindow=0`、跨零点窗口）
- [ ] 产物中不再存在第二份窗口算术（提取测试断言 `windowLabelOf` / 本地格式函数已消失）
- [ ] 变异验证：把卡片门控改坏 → 新对拍用例变红（当前 `model-row.test.js` 抓不住）
