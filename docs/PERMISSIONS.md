# Extension permission contract

This document records the production authority in the REL-PERM-01 release candidate. Source and built manifests are checked against the same explicit set by `npm run verify:permissions` and `npm run verify:artifact`.

| Permission / host authority | Status | Required by | Why weaker authority is insufficient | User-facing capability | Security consequence |
| --- | --- | --- | --- | --- | --- |
| `storage` | RETAINED | Settings, authentication state, parse history, analytics consent and local state, and UI synchronization | Those state lifecycles persist across popup, Side Panel, and content contexts | Settings and workspace state remain available | Stores only the extension's existing local state |
| `scripting` | RETAINED | Dynamic `content/content-main.js` bootstrap when a tab has no receiving content script | The current runtime lifecycle injects on demand; permanent content scripts are a separate architecture change | Detection, screenshot requests, and answer workflows start on supported pages | Permits injection only where current host authority allows it |
| `sidePanel` | RETAINED | Popup directly opens the primary Side Panel workspace | The product's main workspace calls `chrome.sidePanel.open()` | Opens the Side Panel workspace | Keeps Side Panel access available |
| `activeTab` | RETAINED | Real `chrome.tabs.captureVisibleTab()` screenshots and block-image capture | On the local HTTP experiment, Chrome rejected capture with `Either the '<all_urls>' or 'activeTab' permission is required` when `activeTab` was omitted. The retained HTTP(S) host permissions do not satisfy this API's capture authority | User-invoked page capture and vision fallback | Provides temporary access for an invoked tab; does not widen supported URL schemes |
| `tabs` | REMOVED | No named permission needed by the tested production operations | With HTTP(S) host permissions, `tabs.query({currentWindow:true})` returned the matching tab and its `id`, `url`, `windowId`, and `active` fields; `tabs.get` revalidated origin URL/window; `tabs.sendMessage` reached the content runtime. Cross-tab Phase 8 Side Panel Fill remains covered by E2E | Site detection and origin-bound Side Panel Fill remain available | No history, closed-tab, or unrelated tab access was added |
| `debugger` | REMOVED | Legacy `REAL_CLICK` fallback only | The authoritative fill path uses fresh semantic mapping, `buildValidatedAnswerPlan`, `buildActionPlan`, and `executeTransaction`; it does not reach the legacy `fillAnswerIntoScope` helper | Supported controls still fill and verify; controls that require trusted-only input fail closed | Removes DevTools Protocol mouse injection authority |
| `http://*/*` | RETAINED | Arbitrary HTTP learning-page detection, injection, and origin revalidation | A fixed list of learning domains would reduce the product's site-general behavior | Works across arbitrary HTTP hostnames and ports | Grants page access on HTTP origins |
| `https://*/*` | RETAINED | Arbitrary HTTPS learning-page detection, injection, and origin revalidation | A fixed list of learning domains would reduce the product's site-general behavior | Works across arbitrary HTTPS origins | Grants page access on HTTPS origins |

No optional permissions or optional host permissions are declared. `content/contentRuntimeBootstrap.js` remains web-accessible only to the same HTTP(S) host patterns. The supported URL check remains limited to `http:` and `https:`.

The debugger call graph before this change was:

```text
REAL_CLICK -> background clickRealPoint -> chrome.debugger.attach/sendCommand/detach
requestRealClick -> REAL_CLICK
fillChoiceLikeAnswer -> requestRealClick (legacy helper)
fillAnswerIntoScope -> fillChoiceLikeAnswer (legacy helper; no production caller)
fillParsedAnswerInPage -> fillVerifiedAnswerIntoScope -> executeTransaction (no requestRealClick edge)
auto-solve -> fillParsedAnswerInPage
Side Panel FILL_PARSED_ANSWER -> fillParsedAnswerInPage
```

The accepted fill result still requires fresh DOM state readback. The extension does not spoof `event.isTrusted`, use alternate browser-level input APIs, or submit the learning page.

The screenshot E2E probes the real content-to-background path. In Playwright without an actual browser-toolbar action invocation, Chrome returns its explicit capture-authority error; the extension does not provide placeholder image data. This test harness limitation does not remove the runtime requirement for `activeTab`.
