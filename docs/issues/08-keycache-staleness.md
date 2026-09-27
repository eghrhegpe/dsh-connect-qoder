# `keyCache` 没有失效路径 → Qoder 重装后永久 needs-app

**P1 · 规模 S · 依赖 —**

## 症状

`keyCache` 只增不删；`decryptOscrypt` 失败、DB 行解不开都不会逐出 key；
`invalidateCredential` 只清凭据缓存、不碰 key。Qoder 重装/重置 profile 使 `Local State` 的
`encrypted_key` 变化后，本进程会一直用旧 key 去解 → 区域**永久 needs-app**，只能重启 DSH。

## 证据

- `lib/credentials.js:175`（`keyCache`）、`260-261`（查询）、`339-340`（只写成功）
- `lib/index.js:350-352`（`invalidateCredential` 只清凭据缓存）

## 修法

缓存键带上 `Local State` 的 `mtime+size`（或 `encrypted_key` 的哈希）；不一致就重解。
（若能顺便读取 `encrypted_key` 本身，用其哈希更稳。）

## 验收标准

- [ ] 新用例：改掉 `Local State` 的 mtime/内容后，下一次读取重新调用 PowerShell
- [ ] 新用例：文件不变时命中缓存，不再调用
- [ ] 注释里写清缓存的失效条件（当前注释只解释"为什么失败不缓存"）
