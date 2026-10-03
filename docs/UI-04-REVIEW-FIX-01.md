# UI-04 review fix 01: workflow feedback

Gatekeeper: ChatGPT. PR #34 remains OPEN / DRAFT / UNMERGED. DO NOT MERGE.

Reviewed head: `485f0abbc5dc689d8cad20e3ccfd3190d7357a09`.

## Root cause and repair

The real App registered the runtime bridge with `renderWorkspace: false`, which returned after protected-work owner reconciliation and skipped completion feedback. Its ordinary feedback rendering also required there to be no Activity Strip, hiding action outcomes during snapshot-owned activity.

`WorkspaceUserFeedback` now renders existing typed, localized feedback in one compact Orbit surface. The existing review-required code set suppresses a banner only when the review Activity Strip already carries that same message. Ordinary outcomes remain visible alongside running progress; raw transport details never become primary copy.

In snapshot rendering mode, `AUTO_SOLVE_DONE` only updates feedback. It requires an authenticated, ready workspace with exactly matching sender tab ID and URL; child-frame messages fail closed. The origin is checked again after asynchronous language loading and the listener must still be registered. The message cannot mutate candidates or progress. Protected-work owner reconciliation still runs globally before feedback filtering.

Snapshot protocol, runtime/route/sequence fencing, auth authority, protected-work ownership, permissions and submission behavior are unchanged. The legacy rendering mode is not enabled.

## Regression evidence

`SidePanelApp.feedback.test.tsx` uses the real App, action handlers, runtime bridge, hydration hook/controller and rendered Orbit feedback. Chrome transport, provider output and the authenticated session boundary are deterministic test fixtures. It covers RF01-FB01 through RF01-FB12, plus partial batch warnings, ordinary feedback during snapshot-owned activity, cross-tab owner cleanup and workspace invalidation during deferred language loading.

The targeted scope additionally includes the existing owner reconciliation, workspace hydration/controller and candidate workspace suites. Browser tests exercise both languages at 360px, assert the visible feedback and controls before capture, check overflow and page errors, preserve running Activity Strip progress, and reject duplicate review banners.

Visual evidence:

- `evidence/ui04/sidepanel-ui04-feedback-success.png` — Chinese ordinary success, 360px.
- `evidence/ui04/sidepanel-ui04-feedback-warning.png` — English partial-fill warning with running progress, 360px.

These are deterministic component fixtures, not evidence of a live authenticated provider run. Real production App wiring is covered by the integration suite; the full extension E2E suite covers the broader workflows.

## Local gates

- Dedicated integration/owner/hydration/workspace tests: 73/73 PASS; dedicated feedback browser test: 1/1 PASS.
- `npm run check`: 114 files, 1027/1027 PASS; zero lint errors and eight existing warnings.
- `npm run build`: PASS. `npm run verify:artifact`: PASS, including source/dist permission checks.
- Full `npm run test:e2e -- -- --workers=1 --trace=off`: 51/51 PASS. All scenarios and original assertion/time limits remain enabled.

Browser plugin not available; validation uses the existing project Playwright workflow. Initial overlapping quality/browser runs hit existing server-test and browser timeouts. A sequential quality run passed unchanged. A traced browser run subsequently timed out at `closeExtensionContext` after VIRT-A's behavioral assertions had completed; the trace shows approximately 79 seconds spent awaiting context close. Failed-run logs and that trace were retained outside the checkout. The final local run bounds browser concurrency and disables trace recording, without editing harness logic or the CI configuration. CI must independently pass with its unchanged configuration at the delivered source SHA; links and exact source assertions are recorded in the PR/final report.
