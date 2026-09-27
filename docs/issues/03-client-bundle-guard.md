# 产物完整性守卫：`lib/client.js` 被换成桩时，套件不会变红

**P0 · 规模 S（先行）/ L（根治） · 依赖 —（#09、#14 的前置）**

## 症状

`lib/client.js` 是 2004 行 esbuild 产物，无 sourcemap、无构建脚本、`src/client/*.ts` 从未入库，
`exports["./client"]` 直接指向它。产物被换成桩时**没有任何东西报错**：套件不是变红，
而是"**少 6 条测试**"（269 → 263，仅一条文件级失败）。

## 证据

- `test/client-bundle.test.js:49-96`（正则 + 花括号配平 + `new Function` 提取，
  外加一句 `source.includes('promo.active !== true')`）
- `package.json`：只有 `test` / `test:coverage` / `verify:deploy`，无 `build`
- `docs/KNOWN_GAPS.md:76-99`：自己把"src 入库"列为价值最高的待办
- 真实事故：提交 `5206c4c` 曾把 16 字节 `// gutted stub` 作为 `lib/client.js` 提交
  （`lib/client.js | 1971 +---`），卡片/样式/设置写入整体消失而模型通道照常；
  已 amend 为 `61f8aaf`

## 修法

**第一步（S，先做）**：把产物 sha256 与"关键符号必须存在"写进测试——现有 `promo.active !== true`，
补 `offPeakState`、`rateAt`、`windowLabelOf`、`formatContextWindowForUi`、三个 slot key
（`dsh-connect-qoder` / `dsh-connect-qoder#llm-qoder` / `qoder`，见 `lib/client.js:1990-1992`），
加产物行数/字节数下限；接进 CI。

**第二步（L，排期）**：`src/client/*.ts` 入库 + 固定版本 esbuild 构建脚本；
`lib/client.js` 标注为生成物；加"构建产物 == 入库产物"检查。

## 验收标准

- [ ] 把产物替换成 16 字节桩 → 测试**红**（不允许"少 6 条测试"形态）
- [ ] 删掉产物里的 `promo.active !== true` → `client-bundle.test.js` 变红（现有行为，保持）
- [ ] 删掉 `windowLabelOf` → 新断言变红
- [ ] 第二步完成后：`lib/client.js` 可由 `npm run build` 复现，且构建前后内容一致
