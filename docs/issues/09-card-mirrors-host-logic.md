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

- [x] 对拍用例：同一 catalog 条目，卡片侧与宿主侧算出的费率/标签逐状态相等
      （含 `promotion.active=false`、`defaultContextWindow=0`、跨零点窗口）
- [x] 产物中不再存在第二份窗口算术（提取测试断言 `windowLabelOf` / 本地格式函数已消失）
- [x] 变异验证：把卡片门控改坏 → 新对拍用例变红（当前 `model-row.test.js` 抓不住）

## 实现（窗口标签已修；错峰**有意保留**在卡片）

### 窗口标签：分歧确实存在，已修

`test/card-host-parity.test.js` 先把分歧**测出来**再修：`contextOptions` 非空但
`defaultContextWindow === 0` 时，宿主按 `contextWindowIsReal` 判"非真实窗口"发空标签，
卡片按自己的规则发 `200K`。这个状态可达——`context_config` 列了窗口但没标默认的模型。

修法是卡片改读宿主已经算好的 `contextWindowLabel`，只保留**宿主无法表达的**那一小部分：
逐行开关切换到"最宽窗口"（点击即生效，不等任何刷新）。守卫也换成宿主的规则
（必须有默认窗口），所以两边不可能再漂移。

产物断言按**形状**而非字符串：旧的"三元取最宽或默认"那个写法若回来，测试变红
（变异验证过）。同时断言 `windowLabelOf` 确实读了 `contextWindowLabel`——
否则对拍用例可能在一个"转写正确但发货的是别的东西"的状态下通过。

### 错峰：这是**必要的重复**，不是待收敛的镜像

`offPeakState` / `localSecondsOf` / `parseClock` 留在卡片，理由是它们必须能在浏览器里
**每秒重算**：22:00 与 08:00 的翻转要自动发生，不能等一次刷新。宿主那份只在请求时算一次，
两者语义不同、用途不同。

关键区别在于**这次的失败形态变了**：`offPeakState` 那条门控由
`test/client-bundle.test.js` **从产物文本里提取并执行**（不是手抄），所以卡片侧被改坏会当场
变红；`test/model-row.test.js` 里那份手抄转写只作为**规格**存在，它的注释已经写明这一点。
这正是 issue 03 的根治手段——把"镜像"从纪律问题变成门禁问题。

因此本 issue 的实际结论是：**唯一还有分歧的规则已修**，剩下的重复都有产物级门禁守着。

