# UI-04 candidate workspace review

Gatekeeper: ChatGPT. DO NOT MERGE. PR #34 remains draft and open.

## Authority and scope

The current checkout continues `feat/ui-04-candidate-workspace` from UI-03 merge `4fd479fbfa5a6e4cb171b74b30afa05ba06dfd7b`. UI-04A was approved and separately verified at `8530d633dbde8f665bcb3c0e1391efc6846b8fb3`; this presentation change consumes that contract without changing its runtime, auth, owner, origin, sequence, or route fences.

`CandidatesTab` receives the hydrated candidate list and detection phase. Counts and filters use `computeCandidateMetrics`; selection still dispatches the existing content selection handlers. Filter state, explanation expansion and focus are presentation state. Original candidate numbering follows the complete supplied list, independently of the filter.

`deriveCandidatePresentation` maps idle/loading/success/error into detected/solving/solved/review/failed. Only the stable `STALE_QUESTION_REVISION`, `STALE_ROOT_CONTEXT`, and `STALE_ACTION_PLAN` codes produce page-changed copy. `findActiveCandidateId` requires exact workspace origin, current observation ID and unique stable identity/fingerprint. An ordinal is never sufficient.

The risk predicate remains `isRiskyCandidate`: errors, successful results below 0.72 confidence, or existing incomplete-result hints. Review explains low confidence/incomplete hints using localized copy; errors use the existing safe error mapper. Risky success results still belong to the existing Solved filter as well as Review. No reviewed flag or Filled receipt is invented.

Individual and batch filling retain provider provenance and structured-answer checks. Mock/unproven results stay visible with unavailable filling. No automatic submission, debugger behavior, permissions, extraction, auth or protected-owner changes are introduced. The user submits on the website.

The existing bulk-selection contract cannot distinguish eligible candidates. “Select all eligible” is omitted; Clear selection and the existing Select review items operation remain. Filtering never changes selection.

## Presentation

The four zones are compact definition-list counts, an action-only button group, five pressed-state filters, and reusable candidate cards. Native labeled checkboxes replace whole-card click selection. Card actions cannot select the card. Keyboard focus belongs to the checkbox/button, preserving the UI-03 tabpanel focus behavior.

Question content retains the existing option, blank, judge, structured-section and math parsers. Long plain stems have an accessible full-question disclosure; the complete source is available on expansion, while options/images stay visible. Answers remain complete and wrap; explanations have controlled expansion. Existing segment rendering uses Orbit surfaces/tokens. Debug routing metadata is removed from the live candidate cards.

The legacy quick-actions Running badge, auto-solve preview/progress card, scan progress card and duplicate feedback card are removed from the mounted workspace. Activity Strip owns long-running workflow progress, the header retains global workspace status, and cards show local lifecycle. Non-activity workflow feedback remains in a global OrbitStatus region. Legacy exported sections remain only for existing contract tests/compatibility and do not mount in the live workspace.

CSS styles the native panel scrollbar with Orbit tokens and graceful browser fallback. Settings contents and behavior are unchanged.

## Image support: PARTIAL

Actual `displaySegments` image URLs and the existing whitelisted `questionImageUrl` path render images, including judge/blank URL fallback. Segment lists can contain multiple images. If `hasImage` is true without an available URL, copy tells the user to inspect the original page instead of pretending a placeholder is an image. Serialized `imageDataUrl` bytes/media asset references do not provide a Side Panel retrieval contract; no new media protocol is added.

## Visual fidelity ledger

The ImageGen concept was inspected before implementation and used for hierarchy only. The existing Orbit/UI-03 contract remains authoritative.

1. Compact four-count row: implemented with authoritative metrics; the reference's invented counts are not used.
2. Actions before filters: implemented with existing handlers and narrow-panel wrapping. Unsupported Fill on an unsolved reference card is omitted.
3. Five compact filters and clear selection: implemented with semantic buttons and pressed state; no unsafe eligible-select-all operation is added.
4. Selected card, stem/options, answer and status hierarchy: implemented with native checkbox, Orbit tokens and full source content.
5. Review and running distinctions: grounded review reasons and stable-identity local highlight; global progress stays in Activity Strip. Existing product header is preserved.

The latest asserted browser screenshots were visually inspected for card readability, running highlight and 320px wrapping. Mixed-candidate screenshots use 360px width and a taller viewport to show all three cards. Running screenshots scroll the native body to the active third question while retaining the fixed header and Activity Strip.

## Deterministic visual evidence

`e2e/candidateWorkspace.ui04.spec.ts` serves a test-only Vite fixture that imports the production candidate, shell, Activity Strip and Settings components. It contains synthetic question data and empty Settings storage, with no real credentials or personal information. This component fixture proves rendering/keyboard/layout; it does not claim production auth or content-runtime authority. Those are covered by the real-extension regression suites, including UI04A reopening and multi-tab isolation. The fixture is not bundled in the extension.

Every capture has state assertions and both document/panel horizontal-overflow checks before capture. Running evidence asserts the actual running flag's enabled Stop action, Activity Strip question progress, and the uniquely matched active card. Font/paint completion is awaited before capture. Native scrolling is retained.

- [ZH empty](evidence/ui04/sidepanel-ui04-zh-empty.png)
- [ZH mixed candidates](evidence/ui04/sidepanel-ui04-zh-candidates.png)
- [ZH selected](evidence/ui04/sidepanel-ui04-zh-selected.png)
- [ZH review](evidence/ui04/sidepanel-ui04-zh-review-required.png)
- [ZH running](evidence/ui04/sidepanel-ui04-zh-running.png)
- [EN mixed candidates](evidence/ui04/sidepanel-ui04-en-candidates.png)
- [EN running](evidence/ui04/sidepanel-ui04-en-running.png)
- [ZH long content](evidence/ui04/sidepanel-ui04-zh-long-content.png)
- [320px](evidence/ui04/sidepanel-ui04-320px.png)
- [Settings native scrollbar](evidence/ui04/sidepanel-ui04-settings-scrollbar.png)

## Acceptance mapping

`candidateWorkspace.ui04.test.tsx` has named behavioral checks UI04-01–24 and UI04-27–30, plus unproven-result, judge-image and localized blank-label regressions. The browser suite covers UI04-25/26 at 320/360/400/480px, real Space activation/focus for UI04-18/19, actual pixels loaded for two image segments, and all ten asserted visual states. UI04-20 is also exercised by the browser running fixture through the actual workspace identity matcher.

The stale-origin E2E retains the no-answer, no-history and no-mutation checks. Its old `Done 0` button locator is replaced with the new semantic Solved count. Other test locator changes follow native checkbox selection, Solve selected, Answer region and Cancel scan; authority assertions and timeouts are retained.

Final local gates and exact-head CI must be recorded in the PR/final report after all pass. A partial/focused green result is not a delivery claim.

The full local E2E command is `npm run test:e2e -- -- --workers=2` (all 50 tests). A default six-worker run exposed local simultaneous headed-browser startup saturation in the unchanged 30-second permissions test. The concurrency bound changes neither assertions, timeouts, scenarios nor production code. The earlier stale-origin locator failure was repaired and the full suite passed after that repair. CI retains its existing workflow/configuration and must independently pass on the delivered source SHA.

Final local presentation verification: dedicated unit behavior 31/31; dedicated browser behavior/evidence 4/4; `npm run check` 113 files, 1011/1011 PASS (eight existing lint warnings, zero errors); build PASS; artifact and source/dist permission verification PASS; full real-extension/browser E2E 50/50 PASS. UI00A/UI00B/UI01/UI02/UI03 regression suites remain included in the full quality gate. Exact-head CI evidence belongs to the final PR body/report; no pending CI is represented as success here.
