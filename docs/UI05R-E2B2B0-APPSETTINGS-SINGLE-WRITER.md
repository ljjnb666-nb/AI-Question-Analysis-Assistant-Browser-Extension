# UI05R-E2B2B0: AppSettings single-writer ownership

> Historical phase report. Current settings domain and legacy cleanup contract: [E2B2B authority closure](UI05R-E2B2B-AUTHORITY-CLOSURE.md). AppSettings is now non-AI; historical compatibility statements below describe that phase only.

Base: `7e3e10ff758131099ec15bc3f5691b8159f17556`.

## Why this prerequisite exists

`chrome.storage.local.appSettings` is one top-level object. A read/merge/set from another context can overwrite unrelated changes, and a stale snapshot can resurrect nested legacy fields. Chrome storage offers no compare-and-swap. A lock in each client cannot serialize writes across contexts.

This phase exists to make physical nested legacy-field cleanup safe in E2B2B. It centralizes writes now and preserves all five historical AI fields exactly; it does not perform that cleanup.

## Preexisting uncommitted diff audit

VALID_E2B2B0: background routing; shared message types; storage client conversion; new background owner, client and ordinary settings policy; concurrency/ownership tests; real-handler test transports and matching storage, analytics, auth and Settings tests. No production solver, UI or authority redesign is present.

OUT_OF_SCOPE: the preexisting test setup accidentally added the settings RPC to `tabs.sendMessage` and added `tabs.getURL`; those two additions were removed. A stale unused AI-handler test import was removed. STALE_OLD_PHASE implementation: NONE. The preexisting untracked E2B2B audit document and `.mimosa/` are preserved outside this commit.

The E2B1 loadSettings/apiKey contradiction is obsolete. The frozen production credential entry is `resolveRuntimeCredential(AIConnectionRuntimeConfig)`; no old phase is reopened.

## APPSETTINGS_WRITER_MAP_BEFORE

Audited at 7e3e10ff758131099ec15bc3f5691b8159f17556 before implementation.

| File/function | Contexts | Fields | Reason |
| --- | --- | --- | --- |
| shared/utils/storage.ts readSettingsFromStorage:126 | popup/sidepanel/content; background analytics | consent version, enableAnalytics, deviceId, analyticsBaseUrl; whole raw snapshot | Lazy normalization; existing path opportunistically strips legacy AI keys |
| shared/utils/storage.ts saveSettings:242 | popup/sidepanel | route/language/analytics preferences and base/device/account/session fields; whole merged snapshot | Settings UI save, language change, auth login/register/logout/session identity correction |
| shared/utils/storage.ts getOrCreateDeviceId:362 | background onInstalled, UI auth, analytics/content | deviceId, analyticsBaseUrl plus earlier raw snapshot | Device identity initialization |

Callers: PopupApp language; SidePanelApp language; settingsPanel configuration, consent/base, before-auth callback; shared auth.ts credential/identity persistence; analytics.ts load/device; background.ts onInstalled; contentRuntimeBootstrap initAnalytics. Three direct appSettings set sites; no appSettings remove/clear site. Other raw writes own floatingWindowState/history/analyticsLog/errorLog, not appSettings. AI settings subset commits via existing AI_CONNECTION_APPLY_LEGACY_SETTINGS; AI state owner is separate and unchanged. No background settings queue exists at baseline. Prior isolated audit proved load repair can overwrite another context's language update and device initialization can resurrect old keys. All three write paths must move together.

## APPSETTINGS_WRITER_MAP_AFTER

| Boundary | Operation | Context |
| --- | --- | --- |
| `background/appSettingsAuthority.ts:writeAppSettingsUnderLock` | sole raw appSettings set; reads the latest persisted base inside the queue | background service worker |
| `storage.ts:saveSettings` | split AI subset to existing AI command; ordinary patch to APP_SETTINGS_UPDATE; await ACK | popup/sidepanel account, language and Settings callers |
| `storage.ts:readSettingsFromStorage` | read; request APP_SETTINGS_ENSURE_NORMALIZED when needed; reread | UI/content and background analytics after installation initialization |
| `storage.ts:getOrCreateDeviceId` | APP_SETTINGS_GET_OR_CREATE_DEVICE_ID | existing UI/content callers |
| `background.ts:onInstalled` | direct background owner call, then installation event | background; no message to itself |

There is exactly one production owner module and one raw appSettings set site. No production appSettings remove/clear remains. Other storage writes (history, floating state, analytics and error logs) own different keys. UI/content never import the background implementation.

## Commands and authorization

The shared command union has UPDATE, ENSURE_NORMALIZED and GET_OR_CREATE_DEVICE_ID. UPDATE accepts only preferredRoute, language, enableAnalytics, analyticsConsentVersion, deviceId, analyticsBaseUrl, userId, userEmail and authToken. These are the nine actual ordinary AppSettings fields. Unknown/AI/prototype keys and invalid values return APP_SETTINGS_PAYLOAD_INVALID. Null clears account/session fields; clients translate explicit undefined account fields to null before Chrome JSON messaging.

All commands require sender.id equal to chrome.runtime.id. UPDATE additionally requires a parsed URL matching the runtime extension protocol and host, no URL userinfo and exactly /popup/popup.html or /sidepanel/sidepanel.html. URL components are used because extension URL origin may be null in JS engines. A real extension UI page can also be opened as a tab: Chrome then includes sender.tab, which does not make it a content script. Exact trusted sender URL determines UI authority; presence of tab is not rejected. A real-browser probe confirmed this sender shape. Content arbitrary updates are forbidden before any storage/encryption. Existing internal content analytics may request the bounded normalization and device commands; foreign extensions cannot.

Success responses expose only ok, deviceId and analyticsDisabled. Failure responses use stable codes, never underlying errors or command contents. There is no arbitrary record-write API.

## Queue, commit and recovery

Every update, normalization and device creation enters the same module-private promise tail. Mutation N+1 waits for N, including normalization and analytics-log removal. A rejected predecessor is caught before the next command; failure never poisons the queue. The newest raw object is read only inside the serialized task. Only supplied ordinary fields are applied; historical AI data and unrelated existing fields are retained.

The mutation commit point is successful chrome.storage.local.set resolution. ACK follows this commit and any required analytics-log removal. An unchanged normalized object can skip the set; its ACK confirms the existing durable state. After ACK a subsequent raw read contains the committed patch. Reads otherwise use Chrome storage guarantees, without an added transaction snapshot.

While one service worker instance is alive, all writes are serialized. The in-memory queue does not survive termination. No other production extension context writes this key, and a terminated worker cannot continue a concurrent JS mutation. A storage operation may have committed before termination/response loss. After restart the next owner reads persisted Chrome storage as its authoritative base. This is single-owner serialization, not CAS or a distributed lock.

Commands are retry-safe: language/route/consent assignments are idempotent, clears stay cleared, normalization is idempotent, and an existing device ID is reused. An authToken retry may generate a different envelope but preserves the same logical value. Failure after commit (for example analytics removal) does not roll back settings; retry completes the side effect. No exactly-once promise is made, and a later explicit retry remains a later assignment.

## Device identity and normalization

Device creation happens only under the owner queue. Ten concurrent callers obtain the same persisted UUID; a new owner instance reuses it. Empty device patches retain an existing ID. Normalization disables old-version analytics consent, sets the current consent version, fills ordinary defaults, creates a missing ID and normalizes the analytics base URL. Client reads request repair and reread; they never set appSettings.

## Account/session secret and analytics

Background encrypts explicitly supplied authToken before persistence using the existing versioned encryption utility. An existing unmarked account token is decoded and secured if an owner rewrite is needed; existing versioned envelopes are retained. No plaintext token is returned, logged, included in errors or analytics. AI provider credentials remain a separate unchanged authority.

On disabling analytics, commit occurs first; the background removes analyticsLog before ACK. The client then invalidates its analytics generation, drains pending local work and removes analyticsLog again to preserve the existing in-flight write cleanup. Existing storage.onChanged listeners invalidate other-context settings and analytics caches, so convergence does not depend on the initiating client's cache update. The owner queue does not wait on client analytics work.

## Verification and frozen boundaries

appSettingsAuthority.test executes the real owner and queue for SW-01 through SW-15: cross-client updates, 32 interleaved patches, failed-set recovery, ten device callers/restart, normalization, no raw client writes, sender denials, account secret encryption/safe failures, cross-context cache invalidation, AI rejection and untouched AI state. Additional tests cover lost ACK retry and direct background initialization. The AST contract walks production TypeScript writes/removals/clears, resolves literal/computed KEYS and payload variables/spreads, fails on unresolved storage keys and requires exactly the owner persistence site. It also forbids non-background imports of that implementation.

Existing storage, analytics, session, Settings and popup tests exercise real background handlers behind the test messaging transport. Historical cleanup assertions now require preservation of the original raw AI fields, as explicitly required in this prerequisite; encrypted authoritative AI state and blank UI keys remain asserted.

Frozen: AIConnectionState -> runtime config -> exact credential -> final dispatch fence -> fetch. parseRouter, provider execution, runtimeRequest, endpoint/capability/media/retry/timeout behavior, UI04, fill/submission authority, permissions and Settings visuals remain unchanged.

Deferred to E2B2B: physical legacy AI field deletion, AppSettings AI type/domain removal, LegacyAISettingsPatch cleanup, AI_CONNECTION_APPLY_LEGACY_SETTINGS rename, final storage cleanup and parser legacy export cleanup. No merge is performed in this phase delivery.
