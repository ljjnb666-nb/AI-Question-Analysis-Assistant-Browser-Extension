# API Key 安全模型

本文档描述扩展如何本地保护凭据（provider API Key 与账号 authToken），以及这一保护**不**涵盖什么。

## THREAT MODEL

Protects against:

- accidental plaintext inspection of `chrome.storage.local`
- accidental plaintext storage. Normal settings saves write non-empty
  credentials as versioned `qse:v1` ciphertext. Existing legacy plaintext or
  unversioned ciphertext may remain in `chrome.storage.local` until the next
  settings save.

Does not protect against:

- an attacker who can read both the extension bundle and its local storage
  (the key is reproducible offline from public inputs)
- an attacker executing code in the extension context
- a compromised OS / Chrome profile

## CRYPTO FORMAT

`qse:v1:<base64>`，其中 base64 内容为 `IV[12] || AES-GCM ciphertext+tag`。

前缀只是格式/版本标识，不是秘密，不提供额外保密性。

## KEY DERIVATION

PBKDF2-HMAC-SHA-256（100,000 次迭代），输入为**公开的** extension ID 与固定 salt。
因此密钥可被任何读取扩展代码的人离线复现——这是本地混淆，不是秘密支持的保险库。

## PLAINTEXT BOUNDARY

明文凭据只存在于：

- runtime memory（设置缓存与 UI state）
- provider / account 请求本身（`Authorization`、`x-api-key`、Gemini `?key=`）

## NO-SECRET PATHS

logs、parse history、analytics、exports 均不包含凭据（errorLogger 统一脱敏，
analytics 白名单字段，history 不含 settings）。

## LEGACY

旧版本没有格式标记。无 `qse:v1:` 前缀的存储值可能是旧明文或旧无版本密文：

- 两者都仍可读取（读取时宽松解码，绝不因无法解密而清空）
- 迁移到当前 envelope 只发生在下一次设置保存时（load 不做迁移写回）
- 兼容性/支持性写入（如 consent/device-id 迁移）只是原样保留已存储的原始
  settings，本身不构成凭据迁移：compatibility/support writes that preserve
  existing raw settings do not themselves constitute credential migration

已知历史局限：无版本密文被篡改后，从字节结构上无法与任意明文区分，
因此 tamper fail-closed 保证严格适用于 `qse:v1:` 版本化密文。

相关测试：`src/shared/utils/encryption.test.ts`、`src/shared/utils/storage.test.ts`（KEY_01–KEY_15）。
