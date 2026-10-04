# UI05R-E2B1 control-plane cutover — SPEC REVISION 01

AIConnectionState V1 is the only writable AI authority. Provider, model,
endpoint, protocol, auth, credential and active-connection identity live in the
single `aiConnectionState` storage key. No schema bump or second credential
mirror is introduced. Non-AI settings and account/session data remain in
`appSettings`.

## Initialization and writes

The background service worker owns `ensureAIConnectionAuthorityInitialized`.
Every AI command awaits its shared initialization promise, under the existing
state write lock. Absent state allows the existing migration primitive to run;
valid state always wins over historical appSettings; malformed state fails
closed. Decode/encryption/persistence failure creates no partial state and
clears the promise so a repaired installation can retry. A worker restart reads
the existing authoritative state. Initialization does not depend on onInstalled.

Typed ensure, metadata and apply commands return only metadata or stable safe
errors. The apply command validates its exact payload, provider, protocol, model,
URL shape and explicit credential action. Encryption and the coherent mutation
share the existing lock. Configuration changes increment connectionRevision;
credential replacement increments credential revision. A combined save commits
once and invalidates validation once. Saves mutate the active connection rather
than creating a connection on every save.

The compatibility save bridge routes AI fields to the background first. Only
after successful AI commit may the ordinary non-AI write complete. This is not a
cross-key transaction: a later non-AI persistence failure does not undo the AI
commit. Explicit filtering prevents a merge with projected settings from
repersisting AI fields. Normal storage cache invalidation observes both keys;
an asynchronous save does not republish a projection invalidated during it.

Credential intent is KEEP, REPLACE or CLEAR. Same provider with a blank visible
key means KEEP. A provider switch with no new key clears the active reference;
with a new key it uses only the replacement. The writer also enforces this rule
for an explicit KEEP received during a switch. Canonical official protocol/auth
is derived in background. The caller cannot override official AuthScheme.

Official-to-official and custom-to-official switches reset endpoint overrides,
even if the old form resubmits its prior URL. Official-to-custom accepts the
explicit supplied custom URL. This temporary form bridge cannot distinguish a
fresh official override from a stale prior provider URL, so it uses safe reset.

## Read and solve boundaries

General/UI `loadSettings` projects active connection metadata and always returns
apiKey="" once authority exists. It never decrypts an AIConnectionState key.
Before initialization it may read historical legacy settings, but cannot migrate;
AI-aware consumers must ensure authority first. Popup, SidePanel Auto Solve and
content Auto Solve use metadata-only readiness, never a plaintext key or sentinel.

THE RUNTIME COMPATIBILITY ADAPTER IS TEMPORARY.

`loadLegacyRuntimeSettingsCompat` ensures background initialization, reads
ordinary settings, resolves authoritative runtime metadata, resolves the exact
fenced credential snapshot and returns a transient AppSettings object for the
immediate existing solve path. No global plaintext cache, storage write, React
Settings state, analytics/log entry or background response receives that key.
Custom protocol/auth combinations that the existing clients cannot represent
fail closed instead of being silently mapped to a different wire contract.

Callsite audit:

| Consumers                                                                              | Classification and data source                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Auth/session coordinator, auth helpers, analytics, device identity, SidePanel language | GENERAL/UI SETTINGS; ordinary loadSettings                                       |
| Settings form and popup label                                                          | GENERAL/UI SETTINGS; ensure plus ordinary projection                             |
| Popup and SidePanel/content Auto Solve guards                                          | Non-secret authoritative readiness                                               |
| SidePanel batch, vision retry, risky retry                                             | RUNTIME/SOLVE SETTINGS; compatibility loader injected into existing operations   |
| Content manual capture and Auto Solve tier/retry parsing                               | RUNTIME/SOLVE SETTINGS; compatibility loader injected into existing pipelines    |
| parseQuestion / parseQuestionPackage and provider clients                              | Existing supplied-settings contract; no internal authority cutover               |
| Settings connection test                                                               | Existing draft provider/model/URL/key contract; no stored-secret materialization |

The connection test still tests the visible draft. A blank key for a provider
requiring credentials cannot transparently test its stored key; this is
E2B2_REQUIRED_CHANGE. Stored plaintext must not be exposed to fix that UI.
Settings save failures use the existing feedback surface and never report success
before the background AI commit. Layout, styles and UX composition are unchanged.

## Physical legacy data and deferred closure

Migration may leave historical appSettings AI material physically present as
DEFERRED_INERT. Once valid authority exists it is ignored by Settings and runtime,
never reimported, and never updated with a new AI key. Legitimate ordinary
appSettings writes opportunistically omit it; no separate background nested
cleanup races non-AI writes. Final physical legacy cleanup remains E2B-2 closure.

The adapter returns a self-consistent provider/model/endpoint/credential snapshot.
State can change after projection creation and before fetch. E2B-1 does not close
that stale-dispatch window. E2B-2 must consume AIConnectionRuntimeConfig directly,
plan media/capabilities, resolve the exact credential, and call
assertRuntimeConfigCurrent at the last responsible moment immediately before
provider request dispatch. The final fence remains necessary after plaintext
resolution. Final endpoint-security and capability enforcement are also deferred.

## Production ownership audit

Only `background/aiConnectionAuthority.ts` calls migration and state mutation
from production entrypoints. Initialization calls migrateLegacyAIConnectionState
which persists V1; apply calls updateAIConnectionState which persists its validated
commit. credentialStore replaceCredential/clearCredential remain unused foundation
primitives with no production callers. UI, content, parseRouter and storage UI
helpers do not directly write AIConnectionState. Tests may call these primitives.

No provider client, parseRouter authority, UI04, permission or autosubmit changes
are included. Targeted INIT, WRITE, COMPAT-RUN, READY and APP tests exercise the
real background handler/storage bridge, including safe failures and concurrency.
An additional test feeds compatibility settings through unchanged parseQuestion
and a mocked transport to verify endpoint, model, credential and provider result.

The real extension SPA and accessible-root E2E fixtures also configure AI through
the background command. They previously opened Popup (which now initializes
authority) and then wrote legacy appSettings AI fields. Those inert writes can no
longer configure solving. The fixture change retains their model, local endpoint,
credential and all existing stale-result/fill assertions.
