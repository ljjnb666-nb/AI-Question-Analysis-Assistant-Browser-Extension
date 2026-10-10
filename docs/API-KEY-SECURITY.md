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


## Phase 14D-02 · Explicit credential header redaction

The centralized error logger masks structured `Cookie`, `Set-Cookie`,
`Proxy-Authorization`, session/CSRF identifiers, private-key and client
assertion fields. Common authentication fields in HTTPS query parameters are
also masked. When thrown error messages or stack traces contain literal
HTTP `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie` or
`(X-)Api-Key` header lines, their full values are redacted before logs
are retained, persisted, exported or printed in development. Legacy stored
entries are scrubbed on load/export.

This protects **known credential representations**; it is not a guarantee
that an arbitrary unknown secret or private question text in a free-form
error string can be identified. Callers must still avoid logging raw
credentials, page content, and private request/response bodies. No new
analytics payload or network behavior is introduced.


## Phase 14D-03 · Error-log retention for legacy storage

The local `errorLog` store retains at most **100 recent entries**.
On both new writes and legacy loads, older entries are dropped before
per-entry sanitization. Successful legacy loads rewrite only the retained,
sanitized entries to local storage before those entries can be exported.
This is an **entry-count** budget; it is not a per-entry byte-size,
storage quota, or general-purpose sensitive-text detection guarantee.
Clear operations remain serialized with preceding and subsequent writes.


## Phase 14D-04 · Per-entry logging resource ceilings

The logger rejects whole raw strings over **8192 UTF-16 code units** with
`[REDACTED_OVERSIZED_LOG_VALUE]` before regex or URL parsing. Deep or
high-cardinality arrays and objects, recursive URL processing, and excessive
node counts fail closed with fixed markers. A single entry whose **compact
sanitized JSON** exceeds **32 KiB UTF-8** is replaced with a fixed diagnostic
before memory retention, console output, persistence or export. Existing
HTTP header, URL and structured-field credential masking still applies to
normal-sized inputs and historical records.

These are per-entry budgets, not a total storage byte ceiling or a promise
that Chrome's initial legacy storage read is allocation-free. Pretty-printed
exports may use additional whitespace. Unknown free-form secrets are not
guaranteed to be recognized by the credential sanitizer.


## Phase 14D-05 · Aggregate log storage and export budget

In addition to the 100-entry count and 32 KiB compact-JSON per-entry
limits, the logger retains only a **newest contiguous suffix** whose
entire **pretty-printed JSON export** fits within **256 KiB UTF-8**.
The same selected records are used for in-memory logs, FIFO-serialized
local persistence, sanitized historical loads and JSON exports. Oldest
entries are evicted first, with no partial unredacted truncation.
Ordinary small logs remain unaffected, and the earlier user-requested
clear ordering is unchanged.

This limit applies **after Chrome returns historical data**. Chrome's
initial `storage.local.get` cannot avoid deserializing the old value,
and hostile getter/proxy execution or transient construction memory
is not strictly bounded by this policy. This is a final retained-output
budget, not a proof of total CPU or initial-storage-read memory limits.
