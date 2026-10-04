# UI05R-E1 — Connection Domain + AI Storage Authority (Engineering Foundation)

> Historical phase report. Current settings domain and legacy cleanup contract: [E2B2B authority closure](UI05R-E2B2B-AUTHORITY-CLOSURE.md). AppSettings is now non-AI; historical compatibility statements below describe that phase only.

> **Status**: IMPLEMENTED (E1 scope, Review Fix 01 applied)
> **Branch**: `feat/ui05r-e1-connection-storage` (based on `main`)
> **Frontend owner**: Gemini (untouched by this branch)
> **Gatekeeper**: ChatGPT
> **PR policy**: OPEN / DRAFT / UNMERGED — do not merge from this document alone.

---

## 1. Scope

E1 introduces the engineering/runtime foundation for the frozen UI-05R provider &
connection architecture:

- `src/shared/types/connection.ts` — the V1 connection domain types.
- `src/shared/utils/aiConnectionState.ts` — the `AIConnectionState` storage SSOT
  (typed load, validated persistence, owner-context write lock, mutation
  helper, non-secret metadata readers, validation invalidation).
- `src/shared/utils/credentialStore.ts` — the bounded credential API.
- `src/shared/utils/aiConnectionPresets.ts` — V1 preset protocol/auth/endpoint
  resolution mirroring the existing runtime registry (`providers.ts`) and wire
  clients (`providerClients.ts`) without changing them.
- `src/shared/utils/aiConnectionMigration.ts` — idempotent legacy migration,
  shipped as a controlled cutover primitive.

E1 does **not** touch: Settings UI, UI-04A, automatic submission, providers list,
`parseRouter`, permissions, or any protocol adapter.

## 2. Staged authority transition (explicit contract)

There is exactly one writable SSOT for AI provider configuration:

```
chrome.storage.local["aiConnectionState"] = AIConnectionState (schemaVersion 1)
```

**E1 (this branch) — storage foundation only:**

- The domain types, storage helpers, credential store, and migration exist as
  foundation code with unit tests.
- **No production migration execution**: E1 does not invoke
  `migrateLegacyAIConnectionState()` anywhere in production. The absent
  `aiConnectionState` key stays absent at runtime, preserving its meaning as
  the migration eligibility marker. E1 is behavior-neutral in production.
- **No production writer exists yet.** Nothing in the running extension writes
  the new state.
- Legacy `AppSettings` AI fields (`providerId`, `apiKey`, `apiModel`,
  `customBaseUrl`, `customProviderProtocol`) remain the **runtime authority**,
  and the frontend does not read or write the new state.

**E2 (next engineering phase) — mutation authority + cutover:**

- The **background service worker becomes the mutation authority** for
  `AIConnectionState` (single writer).
- Settings (and any other surface) sends **mutation commands to the
  background**; direct UI writes are forbidden.
- **Migration + authority cutover happen there**: the background invokes
  `migrateLegacyAIConnectionState()` at the cutover boundary, against the
  then-current legacy authority, and `parseRouter` switches to resolving the
  active connection from the migrated state.
- Only after the cutover does the new state become authoritative and the
  legacy AI fields degrade to a compatibility projection.

## 3. State shape (V1)

```ts
interface AIConnectionState {
  schemaVersion: 1;
  revision: number;                     // whole-state revision, >= 1
  activeConnectionId: string | null;
  connections: Record<string, Connection>;
  credentials: Record<string, EncryptedCredentialRecord>;
}
```

- `Connection`: `id`, `name`, `presetId` (persisted runtime ID, never renamed),
  `endpointOverride?`, `protocolOverride?`, `authScheme`, `credentialRef?`,
  `selectedModelId`, `connectionRevision`, `validation`, `createdAt`,
  `updatedAt`. Official presets inherit protocol/endpoint; only custom
  connections carry overrides.
- `AuthScheme` is a transport location, never secret material:
  `{kind:"bearer"} | {kind:"header",headerName} | {kind:"query",parameterName} | {kind:"none"}`.
- `EncryptedCredentialRecord`: `ref`, `type`, `encryptedValue` (exactly a
  `qse:v1:` envelope — schemaVersion 1 accepts no other envelope version;
  unknown `qse:*` fails state validation), `revision`, `updatedAt`. Plaintext
  is never stored; validation enforces the exact envelope so a plaintext or
  future-versioned value fails closed. This is application-layer AES-GCM in
  local extension storage — it is **not** an OS keychain (the key derives from
  the public extension ID, see `docs/API-KEY-SECURITY.md`).
- `ValidationRecord` binds to `validatedConnectionRevision` /
  `validatedCredentialRevision`, never to credential data.

## 4. Ownership, concurrency, and the write lock

**Single writer ownership (frozen contract).** `chrome.storage.local` has no
atomic compare-and-swap; nothing in this codebase claims otherwise. Cross-context
lost-update safety comes ONLY from the ownership rule:

- AIConnectionState **writes = single writer authority**. From E2, that is the
  background service worker. Other contexts are read-only for state metadata.
- `updateAIConnectionState` must only be called in the writer-authority
  context. It is foundation code in E1 (no production caller).

**Owner-context write lock.** Even inside one JS context, async operations can
interleave across `await`. `withAIConnectionStateWriteLock(task)` strictly
serializes tasks in submission order within the owning context; a rejected task
does not poison the queue. This is an owner-context convenience — the lock does
**not** solve cross-context concurrency, and no pre-write revision re-read is
performed (a read→write gap cannot be closed by re-reading; single-writer
ownership is the actual guarantee).

**Initialization rule.** Ordinary mutation on absent state fails with
`AIConnectionStateNotInitializedError` — mutations never auto-initialize, so
the absent key keeps its meaning as the migration eligibility marker. Only
`persistAIConnectionState` (explicit initialization/internal persistence
primitive, used by the migration and by `updateAIConnectionState`) can write
the first state. Ordinary consumers must never call it directly.

**Fail-closed reads.** `loadAIConnectionState` returns `null` for the absent
key (the marker) and throws `MalformedAIConnectionStateError` on invalid state.

- `getActiveConnectionMetadata()` / `getConnectionMetadata(id)` — non-secret
  `ConnectionMetadata` projections (resolved protocol/endpoint, credential
  presence + revision). They never return plaintext or envelopes.

## 5. Credential store boundary

| API | Decrypts? | Notes |
| --- | --- | --- |
| `getCredentialPresence(ref)` | no | `{exists, revision?, updatedAt?}` only |
| `replaceCredential(ref, plaintext)` | encrypts in | returns committed non-secret metadata `{ref, revision, updatedAt}`; increments credential revision; invalidates validation of every referencing connection; preserves `connectionRevision` |
| `clearCredential(ref)` | no | removes the record; for referencing connections: drops `credentialRef`, increments `connectionRevision`, refreshes `updatedAt`, invalidates validation; idempotent no-op on unknown ref |
| `resolveCredentialForRuntime(ref)` | **yes — the only path** | fails closed on unknown ref / tampered `qse:v1` / unknown `qse:*` |

`invalidateConnectionValidation(connection)` encodes the invalidation rule for
any runtime-relevant change: prior `validated`/`failed`/`testing`/`stale`
becomes `stale` with `validatedConnectionRevision`, `validatedCredentialRevision`,
`validatedAt`, and `errorCode` cleared; `never_tested` stays `never_tested`;
the validation `generation` always increments so a previously in-flight
validation can never later be honored as current.

General connection readers never return plaintext. Nothing ever logs credential
material (`errorLogger` redaction remains the second layer).

## 6. Migration (`migrateLegacyAIConnectionState`) — controlled cutover primitive

E1 ships the migration but **does not execute it in production**. It will be
invoked by the background single-writer context at the E2 authority-cutover
boundary, against the then-current legacy authority.

Marker contract:

- No `aiConnectionState` key → eligible; migrate.
- Valid `schemaVersion: 1` state → `already_migrated` no-op (never rewritten).
- Malformed state → `failed: AI_CONNECTION_STATE_MALFORMED`; nothing written,
  legacy data preserved; retry is safe.
- Tampered `qse:v1` / unknown `qse:*` legacy key →
  `failed: LEGACY_CREDENTIAL_UNDECODABLE`; nothing written.
- Repeat invocations are deterministic and idempotent (at most one
  `conn_legacy_default` is ever created; a valid existing state is never
  rewritten). The marker re-check before the final write is a best-effort
  guard — **no atomic multi-context CAS behavior is claimed**; production
  safety comes from running the migration only in the single-writer context.

Because `loadSettings` returns a decrypted `apiKey`, the migration reads the RAW
persisted `appSettings` and operates on known plaintext before (re-)encryption:
`qse:v1` → decrypt → re-encrypt (no double envelope); unversioned values →
`tryDecryptLegacyValue` → encrypt; empty → no credential record.

### Mapping tables (runtime IDs unchanged)

| Legacy `providerId` | Protocol | Auth scheme | Endpoint |
| --- | --- | --- | --- |
| `anthropic` | `anthropic_messages` | header `x-api-key` | preset |
| `openai`, `deepseek`, `qwen`, `moonshot`, `zhipu`, `minimax` | `openai_chat_completions` | bearer | preset |
| `gemini` | `gemini_generate_content` | query `key` | preset (`customBaseUrl` is ignored at runtime, so no override) |
| `ollama` | `openai_chat_completions` | none | preset |
| `custom` (+`openai`) | `openai_chat_completions` (override) | bearer | `customBaseUrl` |
| `custom` (+`anthropic`) | `anthropic_messages` (override) | header `x-api-key` | `customBaseUrl` |

Non-empty `customBaseUrl` becomes `endpointOverride` for every protocol except
`gemini_generate_content`, mirroring `settings.customBaseUrl || provider.baseUrl`
in the current clients. Unknown/absent `providerId` falls back to `anthropic`
(the runtime `getProvider` fallback). Initial revisions (state, connection,
credential) are 1; migrated validation is `stale` when a credential exists,
`never_tested` otherwise, generation 0.

## 7. Test coverage

- `src/shared/utils/aiConnectionState.test.ts` — schema validation fail-closed
  matrix (including exact `qse:v1` envelope enforcement), plaintext-save
  rejection, metadata leak regression, owner-context write-lock serialization,
  queue recovery after a failed mutation, absent-state mutation block, and the
  migration marker staying writable only through the initialization primitive.
- `src/shared/utils/credentialStore.test.ts` — envelope round trip, revision
  increments, validation invalidation (validated/failed/testing → stale with
  bound revisions cleared and generation bumped), clear semantics
  (connectionRevision/updatedAt bumps, generation invalidation), presence
  metadata, tamper/unknown-envelope fail closed, no plaintext in logs.
- `src/shared/utils/aiConnectionMigration.test.ts` — full E1-MIG-01…16 matrix
  plus security regressions (plaintext absent from stored state, metadata leak,
  no plaintext logging, no `appSettings` rewrite, legacy preservation on every
  failure path). Labeled E1-RF01 tests cover the Review Fix 01 contract:
  absent-state mutation blocked without consuming the migration marker
  (INIT-01), same-owner concurrent mutation serialization (CONC-01), queue
  recovery after failure (CONC-02), replace/clear invalidation semantics
  (CRED-01…05), and exact-envelope validation (ENV-01).
