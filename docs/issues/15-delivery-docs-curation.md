# 交付漂移、文档与事实不符、默认不策展

**P3 · 规模 S（交付/文档）+ M（策展）· 依赖 —**

## 症状

1. **交付漂移**：`npm run verify:deploy` 实测 `profiles/desktop` 里装的是模块拆分**之前**的 0.2.0
   （9 个 missing、7 个 changed、3 个 `.bak`、3 个"由真实缺陷换来的标记"全缺），而两边 `version` 都是 `0.2.0`——
   任何按版本判断升级的路径都会说"已是最新"。
2. **文档与事实不符**：
   - README 的"零配置"只在 Windows 成立（凭据链只有 PowerShell + DPAPI，其它平台只剩 `QODER_PAT` 环境变量）；
   - README 里两处 503 是两件不同的事（可发生的 `settings-save.js:171-180` vs 不可达的 `index.js:884-887`）；
   - `docs/KNOWN_GAPS.md:171-173` 的基线（branches 87.38）与实测（86.37）不符，
     安全垫被夸大约 43%；凭据层那批零覆盖**未登记**，而 README:203 声称缺口都登记在 KNOWN_GAPS。
3. **默认不策展**：默认不过滤 → 选择器灌入 31 项（CN 14 + 全球 17），含
   `Auto`/`Ultimate`/`Performance`/`Efficient`/`Sonus`/`Cantus` 这类**路由档位别名**（不是模型）；
   没有默认模型；PAT 的账号状态恒判 `ok`，与真实可用性可能不一致。

## 修法

- 重装/清理 `profiles/desktop` 与 `.bak`；把 `verify:deploy` 接进 CI 或启动自检；
  给产物打内容哈希 build id（"版本号相同内容不同"的根治）。
- 文档逐条对齐事实；把账号封禁/条款风险写在显眼位置。
- 给一组默认策展（或至少默认隐藏别名档位）+ 可选默认模型；让账号状态反映真实可用性。

## 验收标准

- [ ] `npm run verify:deploy` 在本机返回 0（无漂移）
- [ ] README 的零配置段落明确写 Windows-only；两处 503 的说明分开
- [ ] `KNOWN_GAPS` 的数字与 `npm run test:coverage` 实测一致，且登记了凭据层缺口
- [ ] 新装用户打开选择器时，别名档位不再与真模型平铺（或有明确分组说明）
