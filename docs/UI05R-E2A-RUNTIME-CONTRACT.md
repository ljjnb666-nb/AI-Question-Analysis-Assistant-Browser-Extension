# UI05R-E2A — Runtime Contract + Capability Resolver

> **Status**: IMPLEMENTED (E2A scope, Review Fix 01 applied)
> **Branch**: `feat/ui05r-e2a-runtime-contract` (based on `main` @ `6082fbd`)
> **Engineering owner**: Codex · **Frontend owner**: Gemini (untouched) · **Gatekeeper**: ChatGPT
> **PR policy**: OPEN / DRAFT / UNMERGED — do not merge from this document alone.
>
> **NO AUTHORITY CUTOVER IN E2A.** `parseQuestion` still consumes legacy
> `AppSettings`; `provider.supportsVision` + `isLikelyTextOnlyModel` remain the
> production vision authority; `migrateLegacyAIConnectionState()` remains
> unused in production. E2A is behavior-neutral for existing solving.

---

## 1. What E2A adds

Read-side runtime contract only — resolver modules, capability authorities,
tests, and this document:

| Module | Responsibility |
| --- | --- |
| `src/shared/types/connection.ts` (extended) | `AIConnectionRuntimeConfig`, `CapabilityAssessment` (type-safe union), `CapabilityConfidence`, `ModelCapabilityAssessment`, `EndpointProvenance`, layered `TransportMediaCapabilityAssessment` |
| `src/shared/ai/modelCapabilityCatalog.ts` | Explicit static catalog for every shipped model ID; custom model identity stays unknown |
| `src/shared/ai/transportMediaCapabilities.ts` | Two-layer transport authority: adapter encoding ∧ endpoint acceptance, per endpoint provenance; exhaustive protocol switch |
| `src/shared/ai/effectiveMediaCapability.ts` | `planWireMediaDelivery` (source→wire separation) + `resolveEffectiveMediaCapability` (fail closed) |
| `src/shared/utils/aiRuntimeResolver.ts` | `resolveActiveAIConnectionRuntimeMetadata` + revision-fenced `resolveRuntimeCredential` secret boundary |

Nothing else changes: no provider clients, no parseRouter, no Settings UI, no
background writer, no migration execution.

## 2. Runtime metadata resolver

`resolveActiveAIConnectionRuntimeMetadata()` answers: given an initialized
`AIConnectionState`, what exact configuration should a solve operation use?

Resolution steps: load state → require active connection → require selected
model → resolve inherited protocol/endpoint (custom may override) → resolve
endpoint provenance → resolve auth scheme → resolve credential presence/revision
→ assess model capabilities → resolve layered transport capabilities → return
the non-secret `AIConnectionRuntimeConfig` (which includes
`endpointProvenance`).

Stable error codes (class `AIRuntimeResolutionError`, machine-readable `code`):

| Code | Condition |
| --- | --- |
| `AI_CONNECTION_NOT_INITIALIZED` | No `aiConnectionState` key |
| `AI_CONNECTION_MALFORMED` | State fails schemaVersion-1 validation |
| `AI_ACTIVE_CONNECTION_MISSING` | `activeConnectionId === null` |
| `AI_MODEL_MISSING` | Connection has an empty `selectedModelId` |
| `AI_CREDENTIAL_REQUIRED` | Auth scheme requires a credential but none is stored |
| `AI_CREDENTIAL_UNAVAILABLE` | Credential missing at resolution time or fail-closed decryption (Review Fix 01) |
| `AI_RUNTIME_CONFIG_STALE` | Snapshot no longer matches current state at the secret boundary (Review Fix 01) |

There is **no silent fallback to Anthropic** and no legacy fallback inside the
resolver. Malformed state never repairs itself.

## 3. Secret resolution boundary — revision fenced (Review Fix 01)

Metadata and secrets are separate:

- `AIConnectionRuntimeConfig` contains credential **reference + revision
  only** — never envelope, never plaintext.
- `resolveRuntimeCredential(config)` is the only E2A entry point that returns
  secret material, intended for the moment a real provider request executes.
  Before producing any plaintext it **re-reads the current state and fences
  the snapshot**: `activeConnectionId` must still be `config.connectionId`,
  that connection must still exist with the same `connectionRevision`, its
  `credentialRef` must match, and the referenced credential must still have
  `config.credentialRevision`. Any mismatch throws `AI_RUNTIME_CONFIG_STALE` —
  a stale snapshot is never silently rebound to a new secret.
- Low-level errors never escape the boundary: `MalformedAIConnectionStateError`
  → `AI_CONNECTION_MALFORMED`; `CredentialNotFoundError` and decrypt failures
  (tampered envelope, unsupported version) → `AI_CREDENTIAL_UNAVAILABLE`.
  Messages contain no material.
- `authScheme.kind === "none"` connections need no secret: the boundary
  returns `null` without touching storage. Plaintext is never cached, never
  persisted, and never included in errors, logs, or serialized metadata.

## 4. Required-credential semantics

`credentialRef` missing is NOT automatically invalid:

- `authScheme.kind === "none"` (Ollama, no-auth endpoints) → no credential
  required; resolution succeeds without one.
- `bearer` / `header` / `query` → credential required; its existence is
  verified during resolution (before any request execution would occur).

## 5. Model capability authority

`assessModelCapabilities(presetId, modelId)` — explicit static catalog keyed by
(presetId, modelId):

- Every CURRENT shipped model ID in `PROVIDERS[].models` is explicitly
  classified — in the known catalog (legacy_declared vision) or in the
  explicit-unknown set (`custom::gpt-5.4-mini`). **Custom preset model
  identity is never trusted by its string**: a default model name does not
  prove an arbitrary endpoint serves the official model, so custom capability
  stays unknown until an explicit verified capability source exists.
- Arbitrary manually entered models are `classification: "unknown"`, vision
  `unknown`. **No name inference** ("vision"/"vl"/"gpt"/…).
- `text` is `known_static true` for known models; `reasoning`/
  `structuredOutput` have insufficient evidence → `unknown` for every model.
- Exact drift gate (`auditBuiltinModelClassification`, `E2A-CAP-07`): every
  current built-in model must be classified (no omissions) AND every catalog
  entry must correspond to a current built-in model (no stale entries) unless
  marked `deprecated`.

`CapabilityAssessment` is a type-safe union: `{ value: boolean, confidence:
"known_static" | "legacy_declared" } | { value: null, confidence: "unknown" }`
— a null value cannot claim confidence, and a boolean cannot be unknown.

## 6. Transport capability authority — two layers + endpoint provenance (Review Fix 01)

Transport support is the combination of two explicitly separated layers:

1. **Adapter encoding** (`resolveAdapterEncodingCapability`, protocol ground
   truth, `known_static`): anthropic_messages and gemini_generate_content
   adapters always inline base64 and never emit remote URLs;
   openai_chat_completions can emit remote URLs and otherwise sends data URLs,
   with multiple parts supported.
2. **Endpoint acceptance** (`resolveEndpointAcceptanceCapability`): what the
   concrete endpoint accepts, per **endpoint provenance**:

| Provenance | Meaning | Acceptance knowledge |
| --- | --- | --- |
| `canonical_builtin_endpoint` | Built-in preset on its canonical endpoint | Registry declarations (`legacy_declared`) apply (deepseek rejects media entirely; openai/qwen/moonshot/zhipu/minimax/ollama accept remote+multiple; anthropic/gemini inline-only) |
| `overridden_endpoint` | Built-in preset + `endpointOverride` | **Unknown** in every endpoint-dependent dimension — the endpoint is no longer the canonical provider service |
| `custom_endpoint` | Custom preset (both openai_chat_completions AND anthropic_messages) | **Unknown** — selecting "Anthropic-compatible" does not prove an arbitrary remote server is conformance-verified |
| `unknown` | Undeterminable | Unknown |

Effective dimensions (`inlineBase64`, `remoteImageUrl`, `multipleImages`) =
adapter encoding ∧ endpoint acceptance, with confidence never higher than the
weakest layer — an unknown acceptance layer degrades the effective dimension
to unknown (fail closed). Adapter encoding shape may be known while endpoint
acceptance is unknown; the two are never collapsed into one overconfident
boolean.

Protocol handling is exhaustive: `switch (protocol)` with `assertNever` — a
newly added `ProtocolId` without a transport branch fails to compile, and the
drift gate (`E2A-CAP-08`) iterates the authoritative `PROTOCOL_IDS` list
directly.

## 7. Source vs wire media + effective capability (Review Fix 01)

**Remote SOURCE ≠ remote WIRE.** Production acquires remote source images into
data URLs unless the endpoint is known to accept remote URLs
(`prepareQuestionPackageForProvider`), so a remote source never by itself
requires remote-URL wire support.

`planWireMediaDelivery({ inlineSourceCount, remoteSourceCount }, transport)`
encodes that planning: remote sources stay on the remote wire only when
`remoteImageUrl` acceptance is known-true; otherwise they are planned as
inline wire media (acquisition itself remains an E2B runtime concern).

`resolveEffectiveMediaCapability` then operates ONLY on the wire plan
(`wireInlineImageCount` / `wireRemoteImageCount`):

- No wire media → not a vision decision; proceed.
- Wire media present requires, in order:
  1. model vision known-true — unknown ⇒ `AI_MODEL_CAPABILITY_UNKNOWN`,
     known-false ⇒ `AI_MODEL_VISION_UNSUPPORTED`;
  2. every required transport encoding dimension known-true — unknown ⇒
     `AI_TRANSPORT_CAPABILITY_UNKNOWN`, known-false ⇒
     `AI_TRANSPORT_MEDIA_UNSUPPORTED` (checked per inline / remote URL /
     multiple-images requirement).

**Unknown in any REQUIRED dimension fails closed.** Pure decision only;
enforcement inside solving belongs to E2B.

**Frozen E2B pipeline order:**

```
source media
  -> media acquisition / delivery planning   (planWireMediaDelivery)
  -> wire representation requirements
  -> model capability check                  \
  -> transport capability check              / resolveEffectiveMediaCapability
  -> provider adapter
```

## 8. Endpoint security note (for E2B — NOT implemented in E2A)

Runtime metadata resolution alone does NOT make an endpoint safe. Before any
provider request executes, E2B MUST apply endpoint security validation:

- URL scheme policy (https required; plaintext http only where an explicit
  local-runtime exception applies);
- loopback / private-network policy (which hosts may be contacted, DNS
  rebinding considerations included);
- origin-changing redirect policy (redirects must not be followed into
  private networks or unrelated origins);
- credential forwarding restrictions (never send Quiz Solver account tokens
  to AI endpoints; never send AI credentials anywhere except the validated
  endpoint).

## 9. What remains legacy until E2B

- `parseQuestion`/`parseRouter` still read `AppSettings` and decide vision via
  `provider.supportsVision` + `isLikelyTextOnlyModel`.
- The wire adapters (`callAnthropic`, `callOpenAICompat`, `callGemini`) are
  untouched.
- `migrateLegacyAIConnectionState()` is still not invoked in production; no
  automatic `AIConnectionState` initialization exists.
- The background service worker is still not a mutation writer.

## 10. Test coverage

- `E2A-RUN-01…11` — resolver matrix (anthropic/openai/gemini/ollama/custom
  openai/custom anthropic; missing state, missing active connection, missing
  required credential, no-auth without credential, malformed state), plus
  `AI_MODEL_MISSING`, provenance assertions, and secret-boundary checks.
- `E2A-CAP-01…08` — capability catalog, layered transport authority, effective
  decision, unknown fail-closed, and the built-in model / protocol drift gates.
- Review Fix 01 regressions: `E2A-RF01-RACE-01…04` (credential replacement,
  connection revision change, active connection switch → `AI_RUNTIME_CONFIG_STALE`;
  unchanged snapshot resolves), `E2A-RF01-MEDIA-01…04` (remote source → inline
  permitted for anthropic/gemini; explicit remote wire + remote-false
  rejected; inline-unknown fail closed), stable error translation
  (`AI_CREDENTIAL_UNAVAILABLE`, `AI_CONNECTION_MALFORMED`, state-deleted →
  stale), endpoint provenance degradation (official override / custom openai /
  custom anthropic), custom model identity unknown, exact model drift gate
  (unclassified + stale), and the `CapabilityAssessment` invariant enforced by
  the type system.
