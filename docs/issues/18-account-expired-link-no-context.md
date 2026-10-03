# 账号面板失效提示：裸链接跳官网、无说明（UX 修复）

**P2 · 规模 S · 依赖 —**

## 症状

账号面板在「登录已过期 / 在线校验过期 / 读不到 / 本机没装这个版本」等状态下，
提示文案后面挂着一个「到 Qoder 管理页」链接（`manageUrl`：qoder.com.cn / qoder.com）——
不写清点它会去哪，点一下就被带到官网首页，而用户真正要做的事（在客户端里重新登录、
没装客户端去装）一句没说。

## 修法（已落地，本记录即验收基线）

- 「登录已过期 / 在线校验过期」：先提示请在 Qoder 客户端里重新登录（文案带具体应用名），
  再点「重新读取登录状态」；第二行给下载指引 + 明确的「下载 {版本}」链接。
- 「本机没装」：第一行说明没装，第二行直接给「下载 {版本}」链接。
- 「读不到」：补上原因与下一步（确认本机有已登录客户端，或点重新读取）。
- 所有外链带 `title`（悬停可见完整 URL）与明确文字；不再出现无说明的裸链接。
- host 侧：`src/host/credentials.ts` 的 `REGIONS` 新增 `downloadUrl`
  （国内 `https://qoder.com.cn/download`，国际 `https://qoder.com/download`），
  经 `src/host/account-state.ts` 的 state record 与 `lib/index.js` 的 usage 路由一并带给卡片。

## 验收标准

- [x] 卡片源码中失效态不再渲染 `manageUrl` 裸链接（`account.openManage` 文案已删）
- [x] 下载链接带 `title` 与「下载 {版本}」文字
- [x] 585 条测试全绿；`lib/client.js` 已按 `npm run build` 重新生成
