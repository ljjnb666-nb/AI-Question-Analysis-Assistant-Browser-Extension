# Phase 12B — Real Browser activeTab Acceptance

Phase 12B closes the browser-only screenshot authority boundary that Phase 12A intentionally left unproven. The gate runs against the exact verified extension artifact in real Chrome for Testing under Xvfb. It does not use a mocked Chrome API and it does not treat programmatic `chrome.action.openPopup()` as a user invocation.

## Completion rule

Phase 12B is complete only when:

1. `check`, extension/Admin artifact jobs, legacy extension E2E, Admin E2E, and `browser_acceptance` all pass at one exact PR/main SHA;
2. `rc_bundle` depends on and passes after `browser_acceptance`;
3. the Phase 12B evidence artifact contains the lifecycle JSON plus non-trivial full-page and block PNGs;
4. the exact merge-SHA post-merge run passes before the phase is frozen.

Before the merge-SHA run exists, the phase is **IN REVIEW**.

## Why the user activation is authoritative

The source manifest binds `_execute_action` to `Ctrl+Shift+Y` (`Command+Shift+Y` on macOS). Chrome documents `_execute_action` as the action command and documents a keyboard shortcut as a user interaction that enables `activeTab`.

CI does not invoke `chrome.action.openPopup()` from an extension page. It focuses the real Chromium top-level X11 window and sends the shortcut through `xdotool`/XTEST. That OS-level input opens the production action popup and grants the focused tab's temporary `activeTab` authority.

The existing `AUTOMATED_ACTIVE_TAB_UNAVAILABLE_FAILS_CLOSED` test remains important as the negative control: a programmatic popup invocation from an extension page does not receive user-activation authority and screenshot capture fails closed.

Official references:

- Chrome activeTab tutorial: https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-activetab
- Chrome Commands API: https://developer.chrome.com/docs/extensions/reference/api/commands
- Chrome Tabs `captureVisibleTab`: https://developer.chrome.com/docs/extensions/reference/api/tabs

## Acceptance matrix

The `@phase12b REAL_USER_ACTIVATION_ACTIVE_TAB_LIFECYCLE` real-browser test proves all of the following on controlled HTTP origins:

| Boundary | Required result |
| --- | --- |
| Before any user action invocation | `CAPTURE_TAB_SCREENSHOT` fails closed with no PNG |
| Same tab immediately after OS-level `_execute_action` | Full visible-tab PNG succeeds |
| Production `CAPTURE_BLOCK_IMAGE` after the grant | Cropped non-trivial PNG succeeds |
| Same tab after same-origin navigation | Screenshot continues to succeed |
| Different tab that was never invoked | Screenshot fails closed |
| Production block-capture route on that uninvoked tab | Fails closed; no image is fabricated |
| Return to the originally invoked tab | Screenshot succeeds again while its same-origin grant remains valid |
| Original tab after cross-origin navigation | Screenshot fails closed because the temporary grant is no longer valid |
| Probe form submission sentinel | No submit event occurs during the acceptance flow |

Evidence is written to `test-results/phase12b-evidence/` and uploaded as `phase12b-browser-evidence-<sourceSha>`.

The evidence JSON records browser user agent, registered shortcut, X11 browser window identity, tab IDs, PNG dimensions/byte sizes, and the observed authority errors. The two PNG files are retained as direct visual proof that the full screenshot and cropped block are real page captures rather than empty or synthetic placeholders.

## Frozen Phase 12B invariants

- **REAL_BROWSER_ACTION_INVOCATION_IS_REQUIRED_FOR_POSITIVE_ACTIVE_TAB_EVIDENCE** — a programmatic extension-page popup call cannot satisfy the positive gate.
- **ACTIVE_TAB_SCREENSHOT_AUTHORITY_IS_USER_INVOCATION_SCOPED** — screenshot success is tied to a real extension action invocation.
- **ACTIVE_TAB_AUTHORITY_IS_TAB_SCOPED** — another never-invoked tab does not inherit screenshot authority.
- **ACTIVE_TAB_AUTHORITY_IS_ORIGIN_LIFECYCLE_SCOPED** — same-origin navigation preserves the observed authority; cross-origin navigation revokes it.
- **UNAUTHORIZED_SCREENSHOT_PATHS_FAIL_CLOSED** — neither full screenshot nor block capture may fabricate image success without authority.
- **RC_BUNDLE_REQUIRES_REAL_BROWSER_ACCEPTANCE** — `rc_bundle` cannot assemble an RC until `browser_acceptance` succeeds.
- **NO_AUTOMATIC_SUBMISSION** — Phase 12B does not add or exercise an automatic-submit path; submission remains user-controlled.

## Non-goals

Phase 12B does not expand real-site compatibility and does not claim support for cross-origin iframe coordination, closed shadow roots, unowned portal controls, or pointerdown-driven widgets. Those remain separate compatibility or architecture concerns for later phases.
