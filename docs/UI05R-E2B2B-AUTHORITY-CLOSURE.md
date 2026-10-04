# UI05R-E2B2B — AI settings authority closure

Engineering owner: Codex. Gatekeeper: ChatGPT. Frontend visual owner: Gemini Antigravity.
Base: `0e32396491546e113a10b60b4a330f44db268b91`. Branch: `feat/ui05r-e2b2b-authority-closure`. Delivery remains Draft/Open/Unmerged.

## Final authority boundaries

| Domain | Authoritative path |
| --- | --- |
| Ordinary preferences/session | `AppSettings` → `saveSettings` → `APP_SETTINGS_UPDATE` → background appSettings owner queue → sole raw appSettings commit |
| AI editing | `AIConnectionEditorView` → `AI_CONNECTION_UPDATE_ACTIVE` → background AI owner queue → `AIConnectionState` |
| Runtime | `AIConnectionState` → `AIConnectionRuntimeConfig` → endpoint/auth/capability gates → exact attempt credential → final currentness fence → provider request |
| Migration | raw historical appSettings AI fields → private migration input → valid schemaVersion-1 AIConnectionState → serialized physical cleanup |

AppSettings and DEFAULT_SETTINGS have no providerId, apiKey, apiModel, customBaseUrl or customProviderProtocol. `loadSettings()` explicitly projects/validates current ordinary fields; raw historical/unknown keys cannot escape at runtime. It neither loads AI state nor decrypts legacy AI credentials. Only account/session authToken is decrypted in ordinary settings. `saveSettings()` projects an ordinary allowlist even when JavaScript passes extra fields; it never sends an AI command.

Settings loads ordinary values and editor view concurrently. The view contains exactly presetId, selectedModelId, endpointOverride, protocol and hasCredential. The editor read response omits the generic connection metadata projection (metadata is null), so credentialRef is absent from the entire editor response. Stored plaintext/encrypted credentials are never hydrated into React; the password field starts empty. Popup and sidepanel provider labels read AI metadata, and sidepanel updates its label on AI state events.

## Modern mutation and sender policy

`AIConnectionUpdatePatch` accepts presetId, selectedModelId, endpointOverride, supported custom protocolOverride, and explicit KEEP/CLEAR/REPLACE credential action. authScheme is not an input. Official protocol/auth remain background-derived. Existing safe endpoint semantics remain unchanged, including Gemini compatibility restrictions and dropping old endpoint overrides on preset switches. Custom supports only existing OpenAI Chat Completions/Anthropic Messages mutation choices; no adapter or provider was added.

All AI commands require sender.id equal to the current runtime.id. UPDATE_ACTIVE additionally parses sender.url and requires the own extension protocol/host and exact `/sidepanel/sidepanel.html` path. Missing URLs, content pages, popup, another extension, path suffixes and spoof URLs fail with AI_CONNECTION_SENDER_FORBIDDEN before payload encryption, state reads or writes. A legitimate sidepanel opened in a tab is allowed: sender.tab is not an authority rule. Own-extension content scripts retain ENSURE_INITIALIZED and GET_ACTIVE_METADATA. The non-secret editor read also requires matching extension identity.

The legacy patch type and command have been removed from source, unions, handlers, tests and E2E fixtures. Unknown retired commands fail closed. Historical phase reports remain historical and link here.

Same preset and blank input sends KEEP; new input sends REPLACE. Background discards the old credential on a preset switch even if the client sends KEEP. CLEAR is explicitly supported. Switching to Custom retains only an explicitly submitted new Custom endpoint; switching to official presets removes old endpoint overrides. Official protocol/auth ignore frontend custom choices.

Settings save and save-and-test commit AI first, then ordinary preferences, preserving the previous order. There is no cross-key transaction or invented rollback. If either step fails, the UI surfaces failure. A committed credential input is cleared promptly, including when the subsequent ordinary save fails. Connection tests use committed readiness and a real text request with the stored authoritative credential.

## Migration, cleanup and recovery

The historical shape is private to aiConnectionMigration. Migration reads raw appSettings directly and commits encrypted credential material only to AIConnectionState.credentials[*].encryptedValue (`qse:v1:`). Cleanup is a background-internal function, not an RPC. It joins the existing appSettings queue, reads the latest raw object, deletes only the five historical keys, and commits through the same single raw persistence function. It does not normalize language, consent, analytics logs, device/account/session values or unknown recovery fields.

| Condition | Result |
| --- | --- |
| No AI state + legacy input | Migrate to valid authority, then remove five raw keys |
| Valid existing state + stale legacy input | Existing authority wins unchanged; delete stale keys without decoding/import |
| Legacy decoding/encryption failure | No successful state; preserve raw input exactly; allow retry |
| Malformed stored authority | Fail closed; no remigration or cleanup; retain recovery evidence |
| Migration committed + cleanup write fails | Stable AI_LEGACY_SETTINGS_CLEANUP_FAILED; initialization promise resets; committed AI state survives |
| Retry after cleanup failure | Existing valid state wins; retry only cleanup; no duplicate import |
| Worker crashes after migration commit, before cleanup | Next initialization sees valid state and reruns cleanup; no state overwrite or duplicate credential import |
| Restart after successful closure | No remigration or unnecessary write |

The single appSettings writer AST contract remains intact. Ordinary updates and cleanup use the same queue; either enqueue order preserves a concurrent language=en update and leaves all legacy keys absent. Ordinary writers cannot resurrect AI fields after cleanup.

## Runtime and parser closure

An already bound logical-solve lease fences its expected runtime, validates that expected endpoint/auth and returns it without resolving the newly active connection. Switching A to unconfigured B yields AI_RUNTIME_CONFIG_STALE, not a missing-credential/configuration error, with zero B dispatches.

One logical solve retains one authority lease. Timeout fallback aborts its old request before replacement, with maximum live provider concurrency 1. Each dispatch resolves the exact current credential and retains the final pre-dispatch fence, redirect:error, secret redaction, model/transport assessments and source-to-wire media policy.

parseRouter no longer exports getProvider, PROVIDERS, ProviderConfig, ProviderId, isProviderRuntimeConfigured or getProviderNotConfiguredMessage. Legitimate catalog and error-copy consumers import their actual modules. The dead model-name heuristic and unused old review-model selectors are removed. Result provenance/fill authority is unchanged.

providers.ts remains a DISPLAY/UI CATALOG, including inventory used by the drift audit. Runtime endpoint/model defaults live in aiConnectionPresets; runtime dispatch never consults provider display flags. Model capability authority remains the existing capability catalog. AIConnectionState schemaVersion is unchanged at 1.

## Initial E2B2B_AUDIT_MAP

Audit was returned in chat before implementation. E2B2B0 at the base supplied the sole appSettings raw writer and queue. The previous untracked blocked audit was copied to ignored `output/e2b2b/prior-audit.md` before replacing this document; preexisting `.mimosa/` was preserved.

| Surface | Baseline finding → closure |
| --- | --- |
| AppSettings/DEFAULT_SETTINGS/storage | Mixed AI fields, raw spread, state projection, apiKey decryption and combined save → explicit ordinary domain and allowlist |
| appSettingsAuthority | Existing serialized sole writer → same queue/internal narrow cleanup, same commit site |
| aiConnectionMigration/Authority | Public historical type and stale comments; no cleanup → private input, ordered cleanup, retry semantics |
| AI messages/background | Legacy payload/command, no sender policy → modern patch/editor read, authorization before secret/state work |
| SettingsPanel/Sections | AI values loaded from AppSettings → editor view plus ordinary settings; committed separate saves |
| popup/sidepanel | Provider labels from old settings/raw events → dedicated AI metadata and AI events |
| parser/review heuristics | Catalog facade, unused model-name/review selection, redundant runtime resolution for bound leases → remove dead exports/helpers; retain expected lease |
| auth/analytics | Ordinary token encryption/session/consent/device logic → preserved, cleanup touches none of these |
| low-level writers | Background authority plus initialization migration; no direct UI/content writer → guarded by static tests |
| migration/E2E fixtures | Historical fixtures and old command scaffolds → migration raw input retained, current edits use modern real sidepanel sender |

## Verification and Gemini handoff

Focused suite covers ordinary domain/static/runtime projection, injected ordinary save, editor secrecy, modern command validation, sender matrix, six migration outcomes, failure/restart recovery, cleanup queue interleavings, real Settings save-and-test and lease classification. Full check, build, artifact and real extension E2E outcomes and exact-head push/PR CI links are recorded in the delivery report.

Removing the extra AI read from ordinary settings exposed an existing session hint race: a server rejection clears credentials, its storage event invalidates the in-flight validation generation, and the later rejection result loses its UI hint. The existing coordinator now retains only that non-authoritative rejection hint for the corresponding credential-clear event; explicit logout, newer login/validation and dispose invalidate it. Auth state and stale-result/401 credential fences are unchanged. Deterministic tests and the unchanged AUTH_UI_05 browser regression verify this repair.

No Settings layout, spacing, colors, copy architecture or animations were redesigned. Credential-presence state only suppresses the existing missing-key hint when a key is actually stored. UI04/candidate/workspace/history/fill/provenance/submission/cross-tab policy, permissions and auth/analytics authority are unchanged. No UI-06, new provider, protocol adapter or schema bump is included. Gemini can continue visual work against the separated editor/ordinary contracts after Gatekeeper review.

Final local gates: targeted 176/176; check 1382/1382 across 129 files; production build PASS; artifact and permission verification PASS; real installed Chromium extension E2E 52/52 with one worker. Lint has zero errors and nine existing warnings. Exact-head push and PR CI evidence is supplied in UI05R_E2B2B_REPORT.
