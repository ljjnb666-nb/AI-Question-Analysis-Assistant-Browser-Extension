# UI05R-E1 — Connection Domain + AI Storage Authority (Engineering Foundation)

> **Status**: IMPLEMENTED (E1 scope)
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
  (typed load/save, revision-aware mutation, non-secret metadata readers).
- `src/shared/utils/credentialStore.ts` — the bounded credential API.
- `src/shared/utils/aiConnectionPresets.ts` — V1 preset protocol/auth/endpoint
  resolution mirroring the existing runtime registry (`providers.ts`) and wire
  clients (`providerClients.ts`) without changing them.
- `src/shared/utils/aiConnectionMigration.ts` — idempotent legacy migration.
- `src/background/background.ts` — one additive hook: migration runs on
  `chrome.runtime.onInstalled` (install/update). Normal runtime behavior is
  unchanged.

E1 does **not** touch: Settings UI, UI-04A, automatic submission, providers list,
`parseRouter`, permissions, or any protocol adapter.

## 2. Staged authority transition (explicit contract)

There is exactly one writable SSOT for AI provider configuration:

```
chrome.storage.local["aiConnectionState"] = AIConnectionState (schemaVersion 1)
```

**E1 (this branch) — shadow migration/foundation:**

- `aiConnectionState` is created and migrated from legacy `AppSettings`.
- Legacy `AppSettings` AI fields (`providerId`, `apiKey`, `apiModel`,
  `customBaseUrl`, `customProviderProtocol`) remain the **runtime authority**.
- The frontend does not read or write the new state; the Settings save flow is
  untouched; `parseRouter` is untouched.
- No permanent dual-write exists: the legacy fields are only ever read by the
  migration, never written by it.

**E2 (next engineering phase) — runtime cutover:**

- `parseRouter` resolves the active connection from `aiConnectionState`.
- The new state becomes authoritative; the legacy AI fields degrade to a
  compatibility projection for older reads.
- Only after E2 may the legacy TypeScript fields be deleted.

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
- `EncryptedCredentialRecord`: `ref`, `type`, `encryptedValue` (always a
  `qse:v1:` envelope), `revision`, `updatedAt`. Plaintext is never stored;
  validation enforces the `qse:` namespace so a plaintext save fails closed.
  This is application-layer AES-GCM in local extension storage — it is **not**
  an OS keychain (the key derives from the public extension ID, see
  `docs/API-KEY-SECURITY.md`).
- `ValidationRecord` binds to `validatedConnectionRevision` /
  `validatedCredentialRevision`, never to credential data. Credential
  replacement increments the credential revision and marks bound `validated`
  connections `stale`.

## 4. Storage API and concurrency assumptions

- `loadAIConnectionState()` — `null` when absent (the migration marker);
  throws `MalformedAIConnectionStateError` on invalid state (fail closed).
- `saveAIConnectionState(state)` — validated, unconditional write. Only for
  callers that observed the state in the same context turn.
- `updateAIConnectionState(mutate, {maxAttempts})` — read → mutate → revision
  bump → re-read → write, retrying on revision conflict;
  throws `AIConnectionStateConflictError` instead of clobbering newer state.
- `getActiveConnectionMetadata()` / `getConnectionMetadata(id)` — non-secret
  `ConnectionMetadata` projections (resolved protocol/endpoint, credential
  presence + revision). They never return plaintext or envelopes.

**Concurrency contract** (documented + tested): `chrome.storage.local` has no
transactions or compare-and-swap. Within one extension context, JavaScript
execution is event-loop serialized, so load→save sequences cannot interleave.
Across contexts, `updateAIConnectionState` closes the window by re-reading the
stored revision immediately before writing, retrying the mutator on top of the
newer base (bounded), and failing loudly on exhaustion rather than silently
clobbering.

## 5. Credential store boundary

| API | Decrypts? | Notes |
| --- | --- | --- |
| `getCredentialPresence(ref)` | no | `{exists, revision?, updatedAt?}` only |
| `replaceCredential(ref, plaintext)` | encrypts in | increments credential revision; marks bound validations stale |
| `clearCredential(ref)` | no | idempotent; drops `credentialRef` references |
| `resolveCredentialForRuntime(ref)` | **yes — the only path** | fails closed on unknown ref / tampered `qse:v1` / unknown `qse:*` |

General connection readers never return plaintext. Nothing ever logs credential
material (`errorLogger` redaction remains the second layer).

## 6. Migration (`migrateLegacyAIConnectionState`)

Marker contract:

- No `aiConnectionState` key → eligible; migrate.
- Valid `schemaVersion: 1` state → `already_migrated` no-op (never rewritten).
- Malformed state → `failed: AI_CONNECTION_STATE_MALFORMED`; nothing written,
  legacy data preserved; retry is safe.
- Tampered `qse:v1` / unknown `qse:*` legacy key →
  `failed: LEGACY_CREDENTIAL_UNDECODABLE`; nothing written.
- Repeat runs are deterministic: at most one `conn_legacy_default` is ever
  created, and a concurrent winner is deferred to (re-read before the final
  write).

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
  matrix, plaintext-save rejection, metadata leak regression, conflict
  retry/exhaustion, malformed-base refusal.
- `src/shared/utils/credentialStore.test.ts` — envelope round trip, revision
  increments, validated→stale rebinding, presence metadata, tamper/unknown-
  envelope fail closed, no plaintext in logs.
- `src/shared/utils/aiConnectionMigration.test.ts` — full E1-MIG-01…16 matrix
  plus security regressions (plaintext absent from stored state, metadata leak,
  no plaintext logging, no `appSettings` rewrite, legacy preservation on every
  failure path).
