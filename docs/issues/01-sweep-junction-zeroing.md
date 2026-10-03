# sweep 跟随目录联接，把插件目录之外的文件清成 NUL

**P0 · 规模 S · 依赖 —**

## 症状

`sweepStaleOscryptDirs` 只按**名字前缀**匹配 `%TEMP%` 下的条目，`statSync` 跟随联接，
然后对目录内**每个条目**无条件 `zeroOutFile`（`open('r+')` + 写零到原长度），最后 `rmSync`。
任何名字撞上 `qoder-oscrypt-*` 的目录/联接，其内容会被静默抹成 NUL，**零上报**，还计入 `reclaimed`。

## 证据

- `src/host/credentials.ts`（前缀匹配、`statSync`、遍历清零、`rmSync`）
- `src/host/credentials.ts`（`zeroOutFile`）
- 本机复现：建 `%TEMP%\qoder-oscrypt-<rand>` → `mklink /J` 指向自己的目标目录 →
  `sweepStaleOscryptDirs(0)` → `reclaimed=2`、无任何上报、联接被删、
  目标目录里的 `victim.txt`（20 字节）**全部变成 NUL**。

威胁模型：`%TEMP%` 是 per-user ACL，现实威胁是**同用户进程/管理员 + 名字撞车的残留目录**
（旧版本、其它工具的残留），不是任意本地用户。但这是"我们自己的启动代码去清别人的文件"，损失不可逆。

## 修法

1. `lstat`（不跟随）判定类型：符号链接/junction/reparse point 一律跳过并上报；
2. 只处理**恰好一个 `key.b64`** 的目录，且校验内容为 base64 解出的 32 字节；
3. 目录内出现任何其它条目 → 不清零、不删除、上报 warning；
4. `reclaimed` 只统计"确认是自己的残留目录且已处理"。

## 实现（已修）

`sweepStaleOscryptDirs` 现在把名字前缀降级为**候选筛选**，处置前三重身份验证，
全部走 `lstat`/`readdir`、不跟随联接进入目录内容：

1. `lstat` 判为符号链接 → 上报并跳过。实测：Windows 下 Node 的 `lstat` 对
   junction 返回 `isSymbolicLink() === true`（`{"isSymlink":true,"isDir":false}`），
   故一条规则同时覆盖 POSIX symlink 与 Windows junction/reparse point；
2. 目录须含身份标记文件 `.dsh-oscrypt`（由 `oscryptKeyFor` 在 `mkdtemp` 后、
   启动子进程前写入，早于任何秘密字节落盘，与既有 ACL 时序约束一致）。无标记
   = 不是我们的目录，**静默跳过、不上报**——第三方工具不该收到一个从未拥有过
   它的插件发来的告警；
3. 有标记但条目不是恰好 `{key.b64, .dsh-oscrypt}` → 冻结并上报（异常形态值得知道）；
4. `key.b64` 可读但 base64 解出非 32 字节 → 判定为冒名异物，不动不删、上报。
   不可读（句柄未及释放，锁也挡读，见 `zeroOutFile`）不在此列——那是"是我们的、
   正被占用"的形状，正是本 sweep 该重试并上报的对象，落到下面回收尝试里上报。

## 验收标准

- [x] junction/symlink 目标目录内的文件**逐字节不变** —— 用例
      `a junction wearing our name is refused and its victim is left byte-for-byte intact`
      （win32 用 `mklink /J` 真建，POSIX 用 `symlinkSync`，CI 双平台覆盖）
- [x] 目录含非 `key.b64` 条目时，既不清零也不删除，且产生一条上报
- [x] 仅含 `key.b64`（+ marker）且年龄超限的残留目录仍被回收，`reclaimed` 计数正确
- [x] 变异验证：删掉 `lstat` 守卫（改回 `statSync`），junction 用例变红；
      删掉 marker 检查，4 条用例变红（含 `an ordinary reclaim is not a problem to report`
      与 foreign-look-alike 用例）——两道守卫各自独立承重
- [x] 无 marker 的同名前缀目录被静默跳过（既不清零也不告警）
