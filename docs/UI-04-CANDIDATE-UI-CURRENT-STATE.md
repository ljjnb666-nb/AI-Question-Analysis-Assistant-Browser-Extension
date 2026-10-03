# CANDIDATE_UI_CURRENT_STATE

Audit date: 2026-10-03 (Asia/Shanghai).
Repository: ljjnb666-nb/AI-Question-Analysis-Assistant-Browser-Extension.
Audited base: `4fd479fbfa5a6e4cb171b74b30afa05ba06dfd7b` (UI-03 merge).
UI-03 approved head: `77e2df5b1d0ddf3306e7d14af234e2e97dba5880`.
Gatekeeper: ChatGPT. DO NOT MERGE.

## Decision

`UI03_RUNTIME_REHYDRATION = REQUIRED_BLOCKER` for the requested UI-04 acceptance scope.
The underlying UI-03 debt remains PARTIAL; no protocol or product implementation was changed.

Section 12 of the supplied UI-04 brief requires: "If yes: STOP and document the minimal protocol required before implementing it."
An authoritative opening snapshot is required to show truthful candidates, active question, progress and controls when the panel opens mid-operation. Implementation is stopped at this gate. This document proposes a bounded protocol for independent approval, not a broad runtime rewrite.

The existing checkout was reused. Before any changes, origin was fetched, main checked out and fast-forwarded, and HEAD verified against the expected merge. The pre-existing untracked `.mimosa/` directory is preserved. No worktree was created and no existing worktree was removed. The task branch is `feat/ui-04-candidate-workspace`.

## A. Candidate data model and authority

| Concern | Current authority and boundary |
| --- | --- |
| Detected items | Content runtime `activeCandidates: QuestionBlock[]`, populated by existing detection/session orchestration. `detectOrchestration.notifySidePanel` emits sanitized blocks in `AUTO_DETECT_RESULT_READY`. Full-page completion also emits blocks. |
| Side Panel candidate view | `SidePanelApp` reducer owns `DetectedCandidate[]`; the message bridge projects runtime snapshots and local batch operations commit results into it. This is an existing split, not a unified durable workspace. |
| Identity | `QuestionBlock.id` is an observation ID. Stable semantic identity is `identity.stableId + contentFingerprint`; the result fence additionally requires origin tabId/URL, `auto_dom` source and matching `runtimeQuestionHandle`. `candidateAuthority.ts` owns this comparison and per-panel attempt leases. |
| Question text | `QuestionBlock.previewText` and optional structured `displaySegments`. `identitySourceText` is explicitly not display text. Existing display helpers normalize text and render math. |
| Options | UI helpers derive choice/judge/blank presentation from preview text. No independent canonical option array exists on `QuestionBlock`. Preserve full source text when the helper cannot safely split it; do not change detection. |
| Images | Optional `displaySegments` image URLs, `questionImageUrl`, media asset references and primary asset ID. `imageDataUrl` exists locally but is stripped at serialization boundaries. Details below. |
| Answer | `DetectedCandidate.result: ParseResult` after a fenced provider/history commit. `answer`, optionSelections, recognizedText and explanations are result fields; explanation text is not the answer. |
| Fill authority | UI-00A provider provenance and structured-answer validation, plus current origin/runtime authority at operation time. `isCandidateFillReady` also requires selected + success. A displayed result never grants authority by itself. |

Primary sources: `src/shared/types/{question,questionV2,ui,parse}.ts`, `src/content/{contentRuntimeState,detectOrchestration,contentDetectionSession}.ts`, `src/sidepanel/{candidateAuthority,sidepanelStateSync,batchOperations,sidepanelCandidateMetrics}.ts`.

## B. Lifecycle/status model

The actual `ParseStatus` union is only `idle | loading | success | error`.
Selection is a separate boolean. Review is a derived predicate, not a lifecycle enum.

| Existing evidence | Truthful presentation available after approval |
| --- | --- |
| idle | Detected / 已识别 |
| loading | Solving / 解析中 |
| success with result | Solved / 已完成; review may take visual precedence |
| error | Failed / 失败; this item is also in the existing risky set |
| error field exactly `STALE_QUESTION_REVISION`, including idle after invalidation | Page changed / 页面已变化; preserve source status and existing safety gates |
| existing risky predicate | Review / 待复核, with evidence-specific explanation |

There is **no per-candidate filled status/receipt**. Fill success returns workflow feedback/counts without adding a filled lifecycle state to the candidate. A Filled badge would fabricate state and must be omitted unless separately approved. Local result fences can clear a stale result to idle + the stable stale error code. No continuous per-card live stale boolean exists.

Current status presentation is in `candidateViewParts.tsx` with hardcoded colors and two label tables. UI-04 should centralize display derivation and semantic Orbit tones without modifying `ParseStatus`.

## C. Available actions

Existing actions: Current View, Full Page / Stop Scan, Solve & Fill / Stop, select all, clear selection, select risky, review risky, solve selected, fill eligible selected, locate on page, fill one result, retry with vision, and expand explanation/details.

`useSidePanelActions.ts` owns dispatch and auth rechecks. `batchOperations.ts` owns fenced parse/retry/fill behavior. Stop/Cancel intentionally remain available after auth loss and target all recorded owner tabs. Their scope must stay unchanged.

There is no automatic website submission control to introduce. UI-04 must leave website submission manual. No new real-click/debugger behavior is proposed.

## D. Runtime progress model

Auto solve sends `AUTO_SOLVE_PROGRESS` with running, solved, filled, total, current, stable statusCode/statusDetail and optional currentQuestionId/currentBlock/currentPreview. The content loop retains counters in the `runAutoSolveAll` closure and sends updates at stage boundaries; these are not periodically replayed snapshots.

`mapAutoSolveProgressMessage` preserves counters, code/detail and current block but currently drops currentQuestionId. A minimal UI projection may retain that existing field; do not use current ordinal alone to identify a card. Progress blocks use persistent serialization, which removes the runtime handle. Matching an active card must account for origin and semantic identity; missing or ambiguous identity must yield no highlight.

Full-page progress has progress, found, currentStep and totalScrollSteps. The panel projects these into scanProgress. Batch parse/fill/review activity is local booleans; candidate loading statuses identify local parse activity. No authoritative per-batch numeric progress exists: do not invent a fraction.

`deriveSidePanelWorkspaceStatus` and `deriveWorkspaceActivity` already derive header and Activity Strip from the reducer. Owner storage is distinct: `protectedWorkOwner:<kind>:<tabId>` holds only active/tabId. Reading it is insufficient to reconstruct progress or candidates and must not be treated as server auth authority.

## E. Stale/revision behavior

Existing origin, runtime binding and semantic revision validation is authoritative. `isCandidateCurrent` rechecks server-authenticated session before and after awaiting runtime authority. Batch operations recheck attempt lease + origin context before storing/displaying provider results and before/after fill. Content message handling verifies expected URL and delegates current binding validation; stale work is withheld.

Detection/page/layout updates produce replacement candidate snapshots. `mergeCandidateSnapshots` retains result/error/debugInfo only if `sameCandidateResultContext` matches. It otherwise resets result state while taking snapshot selection. Route-owned state clearing notifies an empty list. Staleness can also clear results to idle with `STALE_QUESTION_REVISION` in the error field.

UI-04 can display that known code but cannot promise real-time page-change detection for every historical card. Preserve the existing revision watcher/cancellation/binding mechanisms; do not replace them with React flags.

Relevant existing tests: `sidepanelStateSync.test.ts`, `batchOperations.test.ts`, `useSidePanelActions.test.tsx`, content `questionIdentity.test.ts`, answer lifecycle suites and `e2e/spaRevision.spec.ts`.

## F. Selected-state authority and ambiguity

Content `candidateStatusMap` and HighlightLayer own on-page selection and broadcast it. Panel selection is optimistically updated through `sidepanelSelectionSync` and synchronized through `UPDATE_CANDIDATE_SELECTION`; the next snapshot supplies selected. Full-page completion initializes panel candidates unselected.

Ambiguities before implementation:

- Selection sync resolves the best current action tab, rather than each candidate's captured origin; transport failure can leave optimistic panel state divergent until a subsequent broadcast.
- Bulk select currently selects all items without a formal eligibility predicate, including items the later solve/fill authority check may reject.
- Content status/selection snapshots do not contain panel parse results or errors. Panel results are local and context-fenced, not content-owned durable state.

Filtering is presentation-only and must never write selection. A safe initial UI-04 can expose All/Selected/Unsolved/Solved/Review from existing fields, with Unsolved defined as status != success. Clear selection can reuse its handler. **Omit a new "Select all eligible" action** until eligibility and origin semantics are explicitly settled; do not claim the existing all-selection helper proves eligibility. Single selection needs a native labeled checkbox and the existing update action, not duplicated component state.

## G. Risk/review authority

`batchParseHeuristics.isRiskyCandidate` is the current count/filter truth: every error, or success + result with confidence below 0.72, or `shouldRetryWithVision` (confidence below 0.5 or existing incomplete/missing-options hints in warning/briefExplanation). It does not currently include every idle stale candidate or every unproven result.

Reasons may explain observed low confidence, recognized incomplete evidence, or stable failure/stale codes. Unknown errors must use `mapUserFacingError`/`mapKnownCodeFeedback` neutral localized copy, not raw exception text or model-authored fabricated explanations. A stale badge must not silently redefine Risky count. Review-before-fill uses existing result/details and action authority; it does not imply a new persistent reviewed boolean or weaken the fill gate.

Sources: `batchParseHeuristics.ts`, `sidepanelCandidateMetrics.ts`, `candidateViewParts.tsx`, `src/shared/{ai/parseResultAuthority,ui/userFeedback}.ts`.

## H. Existing duplicated UI surfaces

Header workspace badge, Quick Actions Running badge, CandidateAutoSolveCard, CandidateScanProgressCard and the bottom Activity Strip overlap. AutoSolveCard additionally has a separate current-question preview. Candidate feedback also overlaps Activity Strip safety feedback in some states.

`UI04_DUPLICATE_RUNTIME_SURFACE_DEBT = OPEN`. Proposed responsibility split after the blocker is resolved: header global state; action area controls only; Activity Strip operation/progress/global failure; cards candidate state/answer/error only. Removing duplicate progress panels must preserve stable safety detail and the active question's actual content. Do not drop useful Stop/Cancel controls.

## I. Candidate-related technical debt

1. `UI03_RUNTIME_REHYDRATION`: PARTIAL at baseline, required blocker for UI-04 (next section).
2. Result/error persistence is panel-local; there is no candidate filled receipt, reviewed flag or unified snapshot. History is not automatically live candidate authority.
3. Selection mirrors and best-tab sync have the limitations in F. No safe eligible-bulk contract.
4. Filtering currently supports all/risky/done only, labels lack selected-state semantics, and filtered indexes renumber questions.
5. CandidateCard uses a clickable div and decorative checkbox with child controls; keyboard selection and non-bubbling focus must be repaired after approval.
6. Many candidate components still use legacy gradients, shadows and arbitrary colors instead of Orbit tokens; summary cards consume two tall rows.
7. No separate never-detected versus completed-empty flag is retained at initialization; truthful opening snapshot needs detection phase/epoch, not inference from an empty array.
8. Image support is PARTIAL. Structured image segments render multiple real images. The fallback helper only accepts matching HTTP(S) raster extensions on its existing host patterns. Serialization removes screenshot bytes/data/blob URLs and can emit `media://<id>` references, but DisplaySegmentsView passes those directly to img without resolving media payloads. A media reference is not itself renderable image data. Expiring credential URLs may lose authorization after privacy sanitization. No media read protocol or payload resolution change is included in UI-04; missing images must be honestly identified without fake placeholder previews.
9. `UI04_SETTINGS_SCROLLBAR_THEME_DEBT = OPEN`; CSS-only theme polish remains secondary and has not been implemented.

## J. UI-04-compatible components

Reuse Orbit tokens, `OrbitButton`, `OrbitBadge`, `OrbitSurface`, focus primitives and existing `UiButton` integration as appropriate. Keep `WorkspaceTabPanel` and UI-03 direct-focus behavior, header, Activity Strip and document.lang behavior. Extend `SIDEPANEL_COPY` for ZH/EN workspace copy. Reuse math display helpers and stable error mapping.

After approval, prefer small workspace summary/action/filter/list/card/status/answer/reason primitives with derived state outside visual leaves. Local React state is allowed for filter/disclosure only, not candidate status, result, selected or workflow authority.

## Required minimal protocol proposal (not implemented)

### Failure trace and source evidence

This is a source-derived trace, not a claim of a completed manual browser reproduction:

1. Popup starts an auto-solve on tab T and records the protected-work owner. Content reports a running stage then awaits provider processing; the Side Panel is closed.
2. Open the Side Panel during that await. `initialSidePanelAppState` initializes candidates=[]; auto-solve/full-page flags=false; progress=null.
3. `registerSidePanelRuntimeListeners` loads language and registers future-message listeners only. The SidePanelApp mount effect loads settings and registers those listeners; no runtime snapshot query or replay occurs.
4. Auth validation succeeds. `deriveSidePanelWorkspaceStatus` returns Ready from the empty/false state and `deriveWorkspaceActivity` returns null. Quick Actions offers the start label and no current candidate is present.
5. Only a later progress broadcast corrects the running flag. It does not populate the detected candidate list or recover panel-local results; a completed detection broadcast sent before opening is also missed.

The complete ExtMessage union and `handleContentMessage` router contain no GET workspace/runtime snapshot message. The background cannot replay a snapshot through this nonexistent contract. The owner store has no counters, current identity, question text, selected items or completion-empty state. Owner records are read by cancellation/auth-loss paths; they do not hydrate the render reducer.

### Bounded opening handshake

Proposed names/fields below need gatekeeper approval; they are not current contracts:

1. A read-only `GET_CANDIDATE_WORKSPACE_SNAPSHOT` request to a precisely resolved tab/runtime, with response carrying version, origin URL, runtime generation, route/detection epoch and monotonic sequence. It must not start detection, solve/fill, change selection, claim/clear owners or grant auth.
2. Project **existing content-owned state**: active blocks with current selected/status values; detection phase (never started/detecting/completed, including empty completion); actual running flag; latest existing auto-solve or scan progress payload and stable safety/terminal code. Preserve current question identity including currentQuestionId when present; do not reconstruct counters from visible cards.
3. Retain latest existing progress at its emission boundary in runtime-local storage with shutdown/route reset fences, rather than inventing a new execution controller or durable history model. This retention plus generation/sequence metadata is new protocol plumbing and requires approval.
4. Register live listeners before requesting the snapshot. Apply snapshot and live events through one sequence/generation/origin fence so a late snapshot cannot overwrite a newer completion, route change or runtime replacement. Multiple owner tabs must remain separate; one tab's progress must not mark another tab's cards active. Exact workspace tab resolution must be documented, not an arbitrary choice of owner.
5. Preserve existing ownership/auth semantics: server session remains sole unlock authority; existing Stop/Cancel targets all recorded owners; read-only snapshot failures never become "Ready" or authorize protected actions. Render a localized checking/unavailable state on missing, invalid, stale or unavailable snapshot; do not fake a successful empty detection.
6. This minimal handshake recovers only content-owned candidates/progress. It **does not** recover abandoned Side Panel batch work or its local result/error state. It must return only evidence the content runtime owns; an old content success status without a result must not become a fillable solved candidate. Durable panel result rehydration would require a separately approved authority contract and is excluded from this proposal. Likewise no per-candidate Filled receipt is added.
7. No new permissions, media payload transport, settings/auth/history/popup redesign, extraction change, submission control or new database/service is required or approved by this proposal.

### Acceptance required before resuming UI-04

Gatekeeper must approve the handshake scope and the explicit limitations: omit unsupported Filled badges/eligible bulk action; panel-local result recovery stays out of scope unless independently approved.

Protocol tests must cover open during provider await without waiting for a future event; reopen after completed empty detection; snapshot/live-event race; late completion versus snapshot; route change; runtime replacement; multiple owner tabs; snapshot unavailable; server auth loss; and preservation of owner Stop/Cancel targets. Active-card matching must reject ambiguous/missing identity. Then UI-04 implementation and its 30-case suite, ten screenshot assertions, four widths and full gates can proceed.

## Verification at the audit gate

Existing audit-relevant baseline suites: **8 files, 90 / 90 tests PASS**. Executed command:

```text
npm run test:run -- src/sidepanel/sidepanelStateSync.test.ts src/sidepanel/sidepanelSelectionSync.test.ts src/sidepanel/candidateMetrics.ui00b.test.ts src/sidepanel/batchOperations.test.ts src/sidepanel/sidepanelMessageBridge.owner.test.tsx src/sidepanel/sidePanelShell.ui03.test.tsx src/sidepanel/useSidePanelActions.owner.test.tsx src/sidepanel/candidateViewParts.ui00b.rf.test.tsx
```

These passing tests verify existing contracts, not opening rehydration or UI-04 acceptance. No production code, tests or visual harness were changed. UI04-01 through UI04-30, full check/build/artifact/E2E, screenshots and exact-head CI have not established implementation readiness. The requested UI is BLOCKED, not READY_FOR_CHATGPT_REVIEW.


## UI-04A checkpoint after protocol approval

The audit above describes head `1077f505f1b58490f7e790bd7bb0f8887c9d4765`. Gatekeeper subsequently approved `UI04_RUNTIME_SNAPSHOT_PROTOCOL_APPROVED` on PR #34. The minimal implementation and its test mapping are documented in [UI-04A-RUNTIME-SNAPSHOT-CONTRACT.md](UI-04A-RUNTIME-SNAPSHOT-CONTRACT.md). Opening runtime rehydration is implemented within that approved scope; the earlier no-protocol finding is historical. Abandoned panel result recovery, Filled receipts and media transport remain unsupported. Candidate Card redesign and the broader UI-04 acceptance remain outstanding until the UI-04A checkpoint report is returned. PR #34 stays Draft/unmerged.
