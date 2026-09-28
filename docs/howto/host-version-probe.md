# 如何查清本机 DSH 宿主的版本与兼容性判定

**一句话**：桌面版把整个应用打进一个 `app.asar`，版本、兼容性判定代码、宿主自带的 `semver`
全在里面——它不会出现在插件仓库的任何文件里。所以「桌面版升了、插件红了」这类问题，
只能去宿主身上取答案。取答案的脚本已经固化：

```sh
node probe/host-compat.mjs                       # 版本 + peer 判定 + 范围对照表
node probe/host-compat.mjs --all                 # 附带宿主自带包的完整清单
node probe/host-compat.mjs --grep includePrerelease --in dsh-app-boot
node probe/host-compat.mjs --asar <path/to/app.asar>
```

退出码 0 = 全部 peer 通过；非 0 = 有 peer 被宿主判死。

---

## 一次真实的发现过程（2026-09-29，宿主 0.2.0-rc.1）

现象是插件管理里一行红字 `incompatible-version`，**没有任何日志说哪个范围失败、为什么失败**。
按下面的顺序查到答案，每一步的产出都是下一步的输入：

| # | 做什么 | 得到什么 |
|---|---|---|
| 1 | 看 `~/.dsh/` | 只有**数据**：`profiles/{web,desktop}`、`logs/startup-*.log`、`dsh-asar-unpacked/`。不是程序本体 |
| 2 | 找程序本体 | `~/AppData/Local/Programs/DeepSeek Harness/resources/app.asar`（Electron：代码在 asar 里） |
| 3 | 解 asar 头 | 第一次按 8 字节 framing 去读，JSON 解析直接失败；实测长度在 **offset 12** 上（见下） |
| 4 | 读版本 | app `0.2.0-rc.1`；295 个 `@deepseek-ai/*` 包全线同步到同一版本 |
| 5 | 找谁在判 | `--grep includePrerelease` 命中 `dsh-app-boot/lib/index.js:300`，那一行就是判定本身 |
| 6 | 用**宿主的** `semver` 复算 | 不猜范围语义，把宿主自带的 semver 解到临时目录再 import（7.8.5） |
| 7 | 得出正解 | `<0.2` 被脱糖成 `<0.2.0-0`，配合 `includePrerelease` 把 `0.2.0-rc.1` 挡在外面 → 改成 `<0.3` |

判定行的原文（这就是全部规则）：

```js
if (requirement.trim() === "" || !semver.satisfies(runtimeVersion, requirement, { includePrerelease: true }))
  peers[name] = range;
```

---

## 三个会浪费你时间的坑

**1. asar 的头是 16 字节 framing，长度在 offset 12。**
开头 16 字节里，`readUInt32LE(12)` 才是 header 的字节数；header 是紧随其后的 JSON 树；
文件体从 `16 + align4(headerSize)` 开始。按 8 字节 framing（offset 4）读会得到一堆无意义的
整数和一次 `JSON.parse` 失败，而错误信息完全不会提示"你读错了偏移"。树里的 `offset` 是
**字符串**，要 `Number()` 之后再和基址相加。

**2. `<0.2` 不是 `<0.2.0`，别用直觉改范围。**
semver 把 `<0.2` 脱糖成 `<0.2.0-0`。宿主还开了 `includePrerelease: true`，于是
`0.2.0-rc.1` 这类预发布**也参与比较**且排在 `0.2.0` 之前——所以「把上界抬到 `<0.2.0-0`
好让 rc 进来」是错的，它正是原来那句话的展开形式。真正同时容纳
`0.1.x` / `0.2.0-rc.1` / `0.2.x` 而挡住 `0.3.0` 的写法是 `<0.3`。
探针最后那张对照表就是用来当场验证这件事的，别在脑子里推。

**3. 桌面 profile 里的插件副本会被宿主重写成 registry 版本。**
把 `profiles/desktop/package.json` 的依赖改成 `link:<checkout>` 之后，`check-deploy-drift`
会报 in sync——**但宿主启动时按依赖重装过一次，符号链接被换成了 npm 上的 0.3.2 真实目录**
（2026-09-29 01:10 实证）。所以"改了仓库 + 显示 in sync"并不等于桌面版吃到了你的代码；
判断依据是 `node scripts/check-deploy-drift.mjs` 报的是 `dev link` 还是 `DRIFT (installed vX)`。

---

## 其他入口（同一类问题、不同侧面）

| 想查什么 | 在哪 |
|---|---|
| **web 端** CLI 版本 | `~/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/package.json`。注意它和桌面版**不是同一个宿主**，可能对不上 |
| 上游有什么版本可升 | `npm view @deepseek-ai/dsh dist-tags`——`latest` 与 `next` 常常不是一回事（0.2.0-rc.1 当时只在 `next` 上） |
| 谁被判不兼容 | `~/.dsh/logs/startup-*.log`：不兼容的插件会**点名**（`sensenova`、`trae` 就是这么发现的） |
| 插件副本形态 | `node scripts/check-deploy-drift.mjs`（link / copy / 落后多少文件） |
| 运行时是否真的可用 | web 服务监听 `3080`，卡片路由在 `/plugins/<plugin>/...`，可以直接 `fetch` 打——`/account` 返回裸 400 就是这样定位到"handler 进去后炸了"的 |

**关于 3080 那条**：宿主 web server 的 catch-all 会把 handler 里抛出的异常应答成**没有 body 的 400**，
而且**不写日志**。所以「路由返回 400 但日志干净」几乎总是插件自己的异常，不是权限、不是路径、
不是宿主拒绝。想看到原因就得在路由里自己 try/catch（本仓库的 `GET /account` 已经补上）。

---

## 探针的输出长什么样

```
host archive: C:\Users\...\DeepSeek Harness\resources\app.asar
             11530 files, header read at offset 12 (16-byte framing)
app version : 0.2.0-rc.1

bundled packages: 375 distinct names (295 under @deepseek-ai)
dsh-* runtime version: 0.2.0-rc.1 (all @deepseek-ai/dsh-* in lockstep)

peer check — judged by the host's own semver 7.8.5
            semver.satisfies(version, range, { includePrerelease: true })

  the 8 peers the host's gate checks, against runtime 0.2.0-rc.1:
    ok    dsh-llm                        >=0.1.5 <0.3
    ...

what each dsh-* range would admit (the same judgement, other runtimes):
  range                        0.1.7 0.2.0-rc.1      0.2.0      0.2.7      0.3.0      1.0.0
  >=0.1.5 <0.3                   yes        yes        yes        yes         no         no
```

最后那张表是这份探针最有价值的部分：**改范围之前先看它**。判定分两拨——宿主真正检查的
`@deepseek-ai/dsh-*` 用统一的 runtime 版本判，其余 peer（`cordis` / `schemastery` / `pi-ai`）
按宿主实际带的那份副本判，因为宿主对它们不做兼容门禁。

下次桌面版再升代，先跑它，再看要不要动 `package.json`。
