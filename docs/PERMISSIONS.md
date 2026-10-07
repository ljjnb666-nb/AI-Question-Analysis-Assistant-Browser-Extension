# Extension permission contract

This document records the release-hardened production permission contract (the REL-PERM-01 work is frozen and merged). Source and built manifests are checked against the same explicit set by `npm run verify:permissions` and `npm run verify:artifact`.

| Permission / host authority | Status | Required by | Why weaker authority is insufficient | User-facing capability | Security consequence |
| --- | --- | --- | --- | --- | --- |
| `storage` | RETAINED | Settings, authentication state, parse history, analytics consent and local state, and UI synchronization | Those state lifecycles persist across popup, Side Panel, and content contexts | Settings and workspace state remain available | Stores only the extension's existing local state |
| `scripting` | RETAINED | Dynamic `content/content-main.js` bootstrap when a tab has no receiving content script | The current runtime lifecycle injects on demand; permanent content scripts are a separate architecture change | Detection, screenshot requests, and answer workflows start on supported pages | Permits injection only where current host authority allows it |
| `sidePanel` | RETAINED | Popup directly opens the primary Side Panel workspace | The product's main workspace calls `chrome.sidePanel.open()` | Opens the Side Panel workspace | Keeps Side Panel access available |
| `activeTab` | RETAINED | Real `chrome.tabs.captureVisibleTab()` screenshots and block-image capture | Chrome rejects capture without `<all_urls>` or an active `activeTab` grant; the retained split HTTP(S) host permissions do not satisfy the observed capture authority requirement | Screenshots only while Chrome has granted access to the invoked active tab/origin | Phase 12B proves real action-invocation success, tab scoping, same-origin persistence, and cross-origin revocation; see the evidence matrix below |
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

Real browser release acceptance is now covered by Phase 12B. The `browser_acceptance` job focuses the real Chromium X11 window and sends the registered `_execute_action` shortcut through OS-level XTEST input. Chrome documents keyboard-shortcut action invocation as a user interaction that enables `activeTab`. On the controlled HTTP probe, the production `CAPTURE_TAB_SCREENSHOT` route returned a non-trivial 1100×760 PNG and `CAPTURE_BLOCK_IMAGE` returned a 280×180 cropped PNG. The job records Chrome user-agent/version data, grant/revocation outcomes, and the PNGs in `phase12b-browser-evidence-<sourceSha>`.

### Production screenshot call graph and expected authority

All production screenshot calls converge on `src/background/background.ts:captureTab` -> `chrome.tabs.captureVisibleTab()`. Content workflows send `CAPTURE_TAB_SCREENSHOT` through `src/content/imageCapture.ts:screenshotWithRetry`; block capture then crops that result. Side Panel-originated block capture instead sends `CAPTURE_BLOCK_IMAGE` to the fixed candidate's content script, which uses the same capture bridge.

| Entrypoint | Call path | Target tab | User gesture and grant expectation |
| --- | --- | --- | --- |
| Popup Manual Capture | Real action invocation -> popup button -> `START_MANUAL_CAPTURE` -> content manual pipeline -> `CAPTURE_TAB_SCREENSHOT` | Active tab at action invocation, expected to remain the visible target | Phase 12B proves the action invocation grants screenshot authority on the invoked tab; the manual-capture button path still uses that same production capture bridge |
| Popup Auto Detect / Full Page Detect | Action invocation -> popup button -> Side Panel open + detection message; scan itself is DOM-based | Active tab at action invocation | Phase 12B proves the initial action grant. Scanning alone is DOM-based; later image capture succeeds only while the same tab/origin grant remains valid |
| Popup Auto Solve | Action invocation -> popup button -> Side Panel open + `START_AUTO_SOLVE_ALL` -> content `parseBlockForAutoSolve` image capture / vision retry | The tab receiving the start message; visible capture is the active tab in its window | Phase 12B proves grant persistence across same-origin navigation and tab switching back to the original tab; cross-origin navigation revokes the authority |
| Side Panel Detect / Full Page Detect / Batch Parse | Side Panel action -> selected candidate/origin tab -> `requestBlockImage` -> `CAPTURE_BLOCK_IMAGE` when image parsing is requested | Candidate origin; block capture refuses if it is not currently active | A Side Panel click is not a fresh extension action grant. Phase 12B proves the underlying production block-capture route fails closed on a different uninvoked tab |
| Side Panel Vision Retry | Side Panel button -> `runRetryVision` -> `requestBlockImage` -> content capture bridge -> background capture | Candidate origin, and must still be active | No fresh action grant. The production block-capture route is proven to fail closed without authority and to succeed on the still-authorized invoked tab |
| Side Panel Auto Solve | Side Panel button -> `START_AUTO_SOLVE_ALL` -> content auto-solve parse and possible screenshot fallback | `getBestActionTab()` may select an inactive exam tab; `captureVisibleTab` returns the window's active page | No fresh action grant. Phase 12B proves that a different uninvoked tab does not inherit screenshot authority; inactive-target behavior must therefore continue to fail closed rather than assume a grant |
| Auto / Full Page screenshot fallback | Content detection/auto-solve paths -> `tryCaptureBlockImageForAutoSolve` or `screenshotWithRetry` | Content sender's window, whose visible page is captured | No new user gesture when fallback is automatic. Phase 12B proves the prior action grant survives same-origin navigation/return to the original tab and is revoked by cross-origin navigation |

Chrome documents that `activeTab` starts on explicit extension invocation and is temporary ([Chrome `activeTab` documentation](https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-activetab)). Phase 12B now adds local real-browser evidence: capture succeeds after an OS-level `_execute_action` user invocation, survives same-origin navigation and returning to the original tab, does not transfer to a different uninvoked tab, and fails after cross-origin navigation. An already-open Side Panel is still not evidence that a newly selected tab received a fresh `activeTab` grant.

### Grant lifecycle checklist

| Scenario | Evidence status |
| --- | --- |
| Same tab after real action invocation | PASS — full visible-tab PNG and production block PNG captured |
| Same-origin navigation after the grant | PASS — visible-tab PNG continues to succeed |
| Cross-origin navigation after the grant | PASS — capture returns authority error and no PNG |
| Different tab never invoked by the extension action | PASS — capture returns authority error and no PNG |
| Return to the originally invoked tab | PASS — capture succeeds again while its same-origin grant remains valid |
| Production block capture on another tab without a fresh action invocation | PASS — fails closed with no PNG |

The negative `AUTOMATED_ACTIVE_TAB_UNAVAILABLE_FAILS_CLOSED` test remains as a control, while `@phase12b REAL_USER_ACTIVATION_ACTIVE_TAB_LIFECYCLE` is the positive real-browser authority. Together they prove both sides of the contract: no user grant means no image, and a real action invocation grants only the expected temporary tab/origin scope.
