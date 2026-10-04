# UI05R-E2A — Runtime Contract + Capability Resolver

> **Status**: IMPLEMENTED (E2A scope)
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
| `src/shared/types/connection.ts` (extended) | `AIConnectionRuntimeConfig`, `CapabilityConfidence`, `CapabilityAssessment`, `ModelCapabilityAssessment`, `TransportMediaCapabilityAssessment` |
| `src/shared/ai/modelCapabilityCatalog.ts` | Explicit static catalog for every shipped model ID; unknown/custom models are `unknown` |
| `src/shared/ai/transportMediaCapabilities.ts` | Per-protocol (+ per-endpoint) media encoding authority |
| `src/shared/ai/effectiveMediaCapability.ts` | `resolveEffectiveMediaCapability`: model ∧ transport decision, fail closed |
| `src/shared/utils/aiRuntimeResolver.ts` | `resolveActiveAIConnectionRuntimeMetadata` + `resolveRuntimeCredential` secret boundary |

Nothing else changes: no provider clients, no parseRouter, no Settings UI, no
background writer, no migration execution.

## 2. Runtime metadata resolver

`resolveActiveAIConnectionRuntimeMetadata()` answers: given an initialized
`AIConnectionState`, what exact configuration should a solve operation use?

Resolution steps: load state → require active connection → require selected
model → resolve inherited protocol/endpoint (preset defaults; custom
connections may override) → resolve auth scheme → resolve credential
presence/revision → assess model capabilities → resolve transport
capabilities → return the non-secret `AIConnectionRuntimeConfig`.

Stable error codes (class `AIRuntimeResolutionError`, machine-readable `code`):

| Code | Condition |
| --- | --- |
| `AI_CONNECTION_NOT_INITIALIZED` | No `aiConnectionState` key |
| `AI_CONNECTION_MALFORMED` | State fails schemaVersion-1 validation |
| `AI_ACTIVE_CONNECTION_MISSING` | `activeConnectionId === null` |
| `AI_MODEL_MISSING` | Connection has an empty `selectedModelId` |
| `AI_CREDENTIAL_REQUIRED` | Auth scheme requires a credential but none is stored |

There is **no silent fallback to Anthropic** and no legacy fallback inside the
resolver. Malformed state never repairs itself.

## 3. Secret resolution boundary

Metadata and secrets are separate:

- `AIConnectionRuntimeConfig` contains credential **reference + revision
  only** — never envelope, never plaintext. General/catalog readers can consume
  it freely.
- `resolveRuntimeCredential(config)` is the only E2A entry point that returns
  secret material, intended for the moment a real provider request executes.
  It returns `null` for `authScheme.kind === "none"` connections, throws
  `AI_CREDENTIAL_REQUIRED` when a required reference is absent, and otherwise
  delegates to E1's `resolveCredentialForRuntime` (fail closed on tampering).
- Plaintext is never cached, never persisted, and never included in errors,
  logs, or serialized metadata.

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
  classified (`E2A-CAP-07` drift gate forces future models to get a decision).
- `text` is `known_static true` for all shipped models.
- `vision` mirrors the current runtime decision (registry `supportsVision`
  downgraded by the legacy text-only heuristic) with confidence
  **`legacy_declared`** — clearly labeled as the old authority's evidence.
- Arbitrary manually entered models (e.g. under Custom) are `classification:
  "unknown"`, vision `unknown`. **No name inference** ("vision"/"vl"/"gpt"/…)
  happens in this authority.
- `reasoning`/`structuredOutput` have insufficient repository evidence →
  `unknown` for every model (nothing invented).

Confidence model: `known_static` | `legacy_declared` | `unknown`. Unknown
vision must fail closed (§7). `ProviderConfig.supportsVision` is not used as
unquestioned final authority — it only feeds the labeled `legacy_declared`
source until E2B deletes the heuristic.

## 6. Transport capability authority

`resolveTransportMediaCapabilities(presetId, protocol)` — audited from the
current adapters (`providerClients.ts`, `providerMediaPreparation.ts`):

| Protocol | inlineBase64 | remoteImageUrl | multipleImages |
| --- | --- | --- | --- |
| `anthropic_messages` (anthropic/custom) | known true — adapter always inlines base64 blocks | known false — adapter never consumes remote URLs directly | known true |
| `gemini_generate_content` (gemini preset) | known true — `inline_data` parts | known false | known true |
| `openai_chat_completions` (openai/qwen/moonshot/zhipu/minimax/ollama) | known true — data-URL parts | `legacy_declared` per registry | `legacy_declared` per registry |
| `openai_chat_completions` (deepseek) | `legacy_declared` false | `legacy_declared` false | `legacy_declared` false |
| `openai_chat_completions` (custom + any unknown combo) | **unknown** | **unknown** | **unknown** |

Custom OpenAI-compatible endpoints fail closed — arbitrary endpoint support is
never overclaimed. Every protocol resolves to an explicit per-dimension
outcome; there is no default "everything supported" fallback (`E2A-CAP-08`).

## 7. Effective capability + fail-closed policy

`resolveEffectiveMediaCapability({ model, transport, inlineImageCount,
remoteImageCount })`:

- No media → not a vision decision; proceed.
- Media present requires, in order:
  1. model vision known-true — unknown ⇒ `AI_MODEL_CAPABILITY_UNKNOWN`,
     known-false ⇒ `AI_MODEL_VISION_UNSUPPORTED`;
  2. every required transport encoding dimension known-true — unknown ⇒
     `AI_TRANSPORT_CAPABILITY_UNKNOWN`, known-false ⇒
     `AI_TRANSPORT_MEDIA_UNSUPPORTED` (checked per inline / remote URL /
     multiple-images requirement, e.g. N>1 images require `multipleImages`).

**Unknown in any REQUIRED dimension fails closed.** The result is a pure
decision (no side effects); enforcing it inside solving belongs to E2B.

## 8. What remains legacy until E2B

- `parseQuestion`/`parseRouter` still read `AppSettings` and decide vision via
  `provider.supportsVision` + `isLikelyTextOnlyModel`.
- The wire adapters (`callAnthropic`, `callOpenAICompat`, `callGemini`) are
  untouched.
- `migrateLegacyAIConnectionState()` is still not invoked in production; no
  automatic `AIConnectionState` initialization exists.
- The background service worker is still not a mutation writer.

## 9. Test coverage

- `E2A-RUN-01…11` — resolver matrix (anthropic/openai/gemini/ollama/custom
  openai/custom anthropic; missing state, missing active connection, missing
  required credential, no-auth without credential, malformed state), plus
  `AI_MODEL_MISSING` and secret-boundary assertions (no envelope/plaintext in
  metadata, decrypt only at the explicit boundary, no caching).
- `E2A-CAP-01…08` — capability catalog, transport authority, effective
  decision, unknown fail-closed, and the built-in model / protocol drift
  gates.
