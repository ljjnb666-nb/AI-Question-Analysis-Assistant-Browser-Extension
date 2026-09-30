# Extension permission contract

This document records the release-hardened production permission contract (the REL-PERM-01 work is frozen and merged). Source and built manifests are checked against the same explicit set by `npm run verify:permissions` and `npm run verify:artifact`.

| Permission / host authority | Status | Required by | Why weaker authority is insufficient | User-facing capability | Security consequence |
| --- | --- | --- | --- | --- | --- |
| `storage` | RETAINED | Settings, authentication state, parse history, analytics consent and local state, and UI synchronization | Those state lifecycles persist across popup, Side Panel, and content contexts | Settings and workspace state remain available | Stores only the extension's existing local state |
| `scripting` | RETAINED | Dynamic `content/content-main.js` bootstrap when a tab has no receiving content script | The current runtime lifecycle injects on demand; permanent content scripts are a separate architecture change | Detection, screenshot requests, and answer workflows start on supported pages | Permits injection only where current host authority allows it |
| `sidePanel` | RETAINED | Popup directly opens the primary Side Panel workspace | The product's main workspace calls `chrome.sidePanel.open()` | Opens the Side Panel workspace | Keeps Side Panel access available |
| `activeTab` | RETAINED | Real `chrome.tabs.captureVisibleTab()` screenshots and block-image capture | On the local HTTP experiment, Chrome rejected capture with `Either the '<all_urls>' or 'activeTab' permission is required` when `activeTab` was omitted. The retained HTTP(S) host permissions do not satisfy this API's capture authority | Screenshots only while Chrome has granted access to the requested active tab | No successful toolbar-granted capture or grant-lifecycle result has been recorded; see the evidence matrix below |
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

## Screenshot authority evidence

Automated CI (`AUTOMATED_ACTIVE_TAB_UNAVAILABLE_FAILS_CLOSED`) opens an extension page and calls `chrome.action.openPopup()` from that page. That is not a real browser-toolbar action click. In this harness Chrome returns `Either the '<all_urls>' or 'activeTab' permission is required`; the content `CAPTURE_BLOCK_IMAGE` request returns `ok: false`, no `dataUrl`, and the same authority error. This proves fail-closed behavior only. It does not prove successful screenshot authority.

Real browser release acceptance (`REAL_USER_ACTIVATION_SCREENSHOT_SUCCESS`) remains **NOT RUN**. It requires a physical Chrome toolbar action invocation on a controlled HTTP page, a returned non-trivial PNG from the production `CAPTURE_TAB_SCREENSHOT` route, and a valid cropped image from `CAPTURE_BLOCK_IMAGE`. No toolbar-granted PNG evidence, Chrome version, or browser console record is available in this checkout session.

### Production screenshot call graph and expected authority

All production screenshot calls converge on `src/background/background.ts:captureTab` -> `chrome.tabs.captureVisibleTab()`. Content workflows send `CAPTURE_TAB_SCREENSHOT` through `src/content/imageCapture.ts:screenshotWithRetry`; block capture then crops that result. Side Panel-originated block capture instead sends `CAPTURE_BLOCK_IMAGE` to the fixed candidate's content script, which uses the same capture bridge.

| Entrypoint | Call path | Target tab | User gesture and grant expectation |
| --- | --- | --- | --- |
| Popup Manual Capture | Real toolbar action -> popup button -> `START_MANUAL_CAPTURE` -> content manual pipeline -> `CAPTURE_TAB_SCREENSHOT` | Active tab at toolbar invocation, expected to remain the visible target | Toolbar invocation: expected grant YES for that tab; success has not been observed |
| Popup Auto Detect / Full Page Detect | Toolbar action -> popup button -> Side Panel open + detection message; scan itself is DOM-based | Active tab at toolbar invocation | Toolbar invocation: expected grant YES. Scanning alone is not screenshot proof; later Side Panel image capture is conditional |
| Popup Auto Solve | Toolbar action -> popup button -> Side Panel open + `START_AUTO_SOLVE_ALL` -> content `parseBlockForAutoSolve` image capture / vision retry | The tab receiving the start message; visible capture is the active tab in its window | Toolbar invocation: expected grant YES for the invoked tab. Screenshot fallback may run after the popup closes; grant persistence during that workflow is unverified |
| Side Panel Detect / Full Page Detect / Batch Parse | Side Panel action -> selected candidate/origin tab -> `requestBlockImage` -> `CAPTURE_BLOCK_IMAGE` when image parsing is requested | Candidate origin; block capture refuses if it is not currently active | Side Panel button is not a Chrome toolbar invocation. Grant YES only if Chrome still has a grant for this same tab; otherwise NO. Runtime outcome without grant is expected failure, not successful image parsing |
| Side Panel Vision Retry | Side Panel button -> `runRetryVision` -> `requestBlockImage` -> content capture bridge -> background capture | Candidate origin, and must still be active | No fresh toolbar gesture. Grant YES only for a still-authorized tab; otherwise NO. Actual result without grant has not been tested in a real Chrome window |
| Side Panel Auto Solve | Side Panel button -> `START_AUTO_SOLVE_ALL` -> content auto-solve parse and possible screenshot fallback | `getBestActionTab()` may select an inactive exam tab; `captureVisibleTab` returns the window's active page | No fresh toolbar gesture. Grant is UNKNOWN for the chosen target; inactive-tab selection makes successful screenshot behavior especially unverified |
| Auto / Full Page screenshot fallback | Content detection/auto-solve paths -> `tryCaptureBlockImageForAutoSolve` or `screenshotWithRetry` | Content sender's window, whose visible page is captured | No new user gesture when fallback is automatic. A prior toolbar grant is expected only while valid for the active tab; behavior after tab switch/navigation is unverified |

Chrome documents that `activeTab` starts on explicit extension invocation, survives same-origin navigation, and is revoked on cross-origin navigation or tab close ([Chrome `activeTab` documentation](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)). This is platform documentation, not a local browser observation. This project has not experimentally established capture success after same-origin navigation, denial on a different uninvoked tab, or Side Panel-only behavior. In particular, an already-open Side Panel is not evidence that a newly selected tab received an `activeTab` grant. Do not claim screenshots always work across these entrypoints.

### Grant lifecycle checklist

| Scenario | Evidence status |
| --- | --- |
| Same tab after a physical toolbar invocation | NOT RUN |
| Same-origin navigation after the grant | Chrome documentation says grant persists; local capture experiment NOT RUN |
| Cross-origin navigation after the grant | Chrome documentation says grant is revoked; local capture experiment NOT RUN |
| Different tab never invoked from the toolbar | NOT RUN |
| Return to the originally invoked tab | NOT RUN |
| Side Panel-only capture on another tab without a new toolbar invocation | NOT RUN |

The current automated test is intentionally named `AUTOMATED_ACTIVE_TAB_UNAVAILABLE_FAILS_CLOSED`; it cannot satisfy `REAL_USER_ACTIVATION_SCREENSHOT_SUCCESS`. Keep `activeTab` retained and do not infer successful screenshot support until the real-browser gate and lifecycle scenarios are recorded.
