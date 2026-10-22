# 新模型标记：额度胶囊挂「· N 新模型」

**P3 · 规模 S · 依赖 无 · ✅ 已实现（2026-10-22）**

对话框用量胶囊原来只有两段读数（`Qoder CN · 1,034`）。Qoder 上新模型时用户**没有任何
信号**：名册会变，但变的唯一痕迹是下拉里多一行，而那一行和别的行长得一样。本条目给胶囊
加第三段 `· N 新模型`，并把「新」这件事的**口径**钉死。

## 1. 为什么必须说「本机首次见到」而不是「网关新增」

Qoder 的目录行只有 `display_name` / `key` / 价格字段，**没有「上架时间」**。上游没公布的
事实，本插件不能替它宣布。本插件能证明的只有一件事：**本机上次记下的名册里没有它**。

所以文案是「本机新见 / 本机首次见到的模型」（`pill.newModelsRow` / `pill.newModelsTitle`），
不是「网关新增」。这不是措辞洁癖：说成网关新增，等于把「我刚升级插件、第一次看到这份
名册」也报成上游上了新模型——而这恰好是**最常发生**的误报场景。

## 2. 落点

| 层 | 文件 | 做什么 |
|---|---|---|
| 历史 | `src/host/roster-seen-store.ts` | 每区域一份 `.qoder-roster-seen.<region>.json`（id → 首次见到的时间戳）；`note()` 一次调用同时 diff 与落盘 |
| 接线 | `src/host/index.ts` | `RegionRuntime` 持有 store；**只在 refresh 提交成功时** `noteRoster(entries)`；`newModelIds()` 是纯读 |
| 载荷 | `src/host/catalog-entry.ts` | `buildModelRowsPayload` 增 `newModelIds`（只发 id，不发名字） |
| 契约 | `src/host/handlers.ts` | `RouteRuntimeLike.newModelIds?()` 可选 |
| 纯函数 | `src/client/pill-model.ts` | `newModelsOf`（与名册求交）、`newModelNamesOf`（最多 3 个名字） |
| 渲染 | `src/client/composer-usage-pill.tsx` | 胶囊第三段 + 面板「本机新见」行 |
| 文案 | `src/client/copy-usage.ts` | `pill.newModels` / `newModelsRow` / `newModelsTitle` / `newModelsSep`，中英各一份 |

## 3. 五条规则（每条都有测试钉住）

`test/roster-seen-store.test.js` 是这份规则的验收基线：

1. **第一次写入是「播种」，不是宣布**。首次运行把整份名册按「一个窗口之前」记下，返回
   空列表。否则升级那一刻，所有老用户都会被通知「全名册都是新的」。
2. **窗口 7 天**（`ROSTER_NEW_WINDOW_MS`）。短于一周，一周开两次面板的用户永远看不见；
   长于一周，标记就成了永久家具。窗口内反复读**仍然算新**，所以标记不会在两次 5 分钟
   轮询之间闪掉。
3. **离开名册的 id 被丢弃**，再上架算新的。退役又回来的模型是一次值得说的变化。
4. **不认识的形状不覆盖**：文件能解析但 `version` 不认识 → 属于更新的版本，本版本只读
   不写（`refused`）。**解析失败**是另一回事——垃圾文件没有主人，重建而不是永久拒绝，
   否则一次截断写入就让标记在本安装的余生里失效。
5. **超过 `ROSTER_SEEN_MAX_IDS`（200）什么都不写、什么都不报**。这是形状漂移闸，不是
   队列：淘汰一个**还在名册里**的 id，下一轮它就成了「没见过的」，于是重新报一遍——
   实测会 50→100/轮地振荡。会自己发明新模型的历史文件比没有历史更坏。

另外两条边角同样有测试：未来时间戳在下一次写入时被夹到当时（时钟回拨不该把标记停在
未来）；空名册是 no-op 不是清空。

## 4. 为什么写在 refresh 提交路径上

`GET P/models` 在 `docs/ROUTES.md` 里明写「改状态：否」。把历史写入挂在 GET 上会当场
让那句话变成假的。所以：

- 写入只在 `doRefreshCatalog` 拿到上游答案、`applyOutcome` 返回 `committed: true` 之后；
- `GET` 只调 `newModelIds()`（纯读），不碰磁盘写；
- 一次刷新失败**不**推进历史（否则等于给一个没人服务过的答案做 diff）。

`noteRoster` 与 `newModelIds` 都 catch 后记日志：标记是建议不是事实，为它让整份名册
读不出来是本末倒置。降级后的画面与「首次运行」完全一致——不挂标记。

## 5. 边界

- **不推广到兄弟插件**是刻意的，不是漏了：WorkBuddy 的名册行已经有上游促销徽章（限免/
  试用/夜间），再加一套「本机新见」就是同一个事实两本账；ModelScope 的胶囊是纯展示、
  没有展开面板；Agnes 的胶囊正文预算最紧（12px 单行，已载套餐前缀 + 两个读数 + 陈旧标记）。
  Qoder 是唯一「有名册轮询 + 有可展开面板 + 正文还有余量」的那个，所以先只做它。
- **活动/促销变化不提醒**：本插件没有 campaign 的 diff（`grep campaign src/` 里没有历史
  记录），而错峰窗口与签到状态本来就实时画在面板里，不需要第二条提醒路径。
- **不加 toast / 弹窗**：DSH Host Service 目录里没有通知服务，插件无从弹窗（2026-10-22
  核实）。若宿主将来提供通知服务，这个事实应当搬过去，而不是在插件里自建。
