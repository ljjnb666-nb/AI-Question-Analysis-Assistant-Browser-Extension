# UI-04A runtime opening snapshot

Gate: `UI04_RUNTIME_SNAPSHOT_PROTOCOL_APPROVED`, approved on PR #34 at audit head `1077f505f1b58490f7e790bd7bb0f8887c9d4765`. This checkpoint closes the bounded opening handshake before UI-04 Candidate Card work. PR #34 remains Draft and must not be merged or marked ready.

## Origin resolution

`workspaceTarget.ts` resolves one eligible HTTP(S) tab from the current window. It preserves the existing preference for exam URLs (`answer-homework`, `exam-hub`, `atHomeworkExam`, `homeworkQ`). Within those preferred tabs, or all HTTP(S) tabs when there are no preferred tabs, choose the sole active tab, otherwise the sole tab, otherwise the unique most recently accessed tab with a positive `lastAccessed`. Missing targets and recency ties fail closed. Array order and protected-owner records never select an origin.

Capture `{tabId, url}` and verify that tab's URL before and after the read. Live updates must originate from that exact tab, URL and top frame. Navigation resynchronizes the same tab; it never silently switches tabs. Reopening resolves afresh. Protected START/selection/highlight dispatches recheck hydration and origin after asynchronous lookups/owner writes and bootstrap retries. Stop/Cancel retain existing all-recorded-owner behavior.

## Protocol and ordering

Request: `GET_CANDIDATE_WORKSPACE_SNAPSHOT {expectedUrl}`. Response: `{ok, snapshot?}`. Existing lazy content bootstrap is allowed only for the resolved eligible tab. The read neither changes state/sequence/selection nor starts detection, solving, filling, submission or owner writes. A mismatched current URL or disposed runtime returns `ok:false` without resetting state.

The content runtime owns `protocolVersion:1`, opaque `runtimeInstanceId`, document-local `runtimeGeneration`, `routeEpoch`, `seq` and `originUrl`. Sequence increments at each snapshot-visible lifecycle/projection change. `CANDIDATE_WORKSPACE_UPDATED` carries the complete state with this metadata; compatibility detection/progress messages include the same family. Ordering uses identity, epoch and sequence, never timestamps or panel counters.

Register the listener before origin resolution/request. During the read, retain only the newest full-state event per tab/runtime, bounded to 32 entries. Reconcile through one fence, retaining the observed high-water mark across retries. Same-runtime lower epochs and lower/equal sequences are ignored. A newer epoch beats a larger sequence on an older epoch. Replacement/disposal invalidates readiness and requires a fresh read; retired instances cannot revive themselves. Timeout, invalid response or unresolved/stale origin renders localized runtime-unavailable feedback, separately from auth server availability.

## Content state and lifecycle

Snapshot retains detection phase (`never_started`, `detecting`, `completed`) and mode, sanitized candidates with boolean selection and normalized status, actual auto-solve running/latest progress and full-page running/latest progress. Completed detection with zero candidates stays `completed`.

One typed serializer explicitly maps internal `pending`/unknown status to `idle`. Selection notifications project current live candidate IDs against the existing content status map, avoiding older orchestration blocks overwriting newer detected candidates. Extraction algorithms are unchanged.

Progress stays ephemeral. New run, route reset, disposal/replacement and terminal completion clear it. Existing `FILL_STOPPED_SAFETY` evidence survives only under the existing safety contract, until the next run/reset. Old full-page callbacks are fenced by route epoch and an internal detection generation, including cancel followed by another scan. Old-route auto-solve updates cannot change the current snapshot. Compatibility terminal/safety notifications still reach existing owner/safety consumers; the old workflow releases its actual running flag when it stops, and replacement solving cannot start while it unwinds. Owner storage/readers/writers are unchanged.

## Authority and limitations

Only a server-authenticated session can request/apply workspace information or unlock protected actions. Listener registration grants no authority. Auth loss invalidates the hydration ticket, clears its projection and ignores late responses. The existing watchdog terminates recorded owners independently of rendering origin.

No durable storage/database is added. Abandoned Side Panel `ParseResult`, errors, review flags and Filled receipts are not recovered. Content success without trustworthy panel-local result evidence becomes `idle`, never Solved/Fill-ready. Existing same-candidate context, question-handle and fill/result validation remain in force. Progress preserves `currentQuestionId`; the active identity utility requires unambiguous semantic identity and exact origin/ID match. Missing/conflicting/ambiguous evidence returns no highlight. Card styling belongs to UI-04.

No media retrieval protocol, permissions, automatic submission, debugger/real-click behavior, auth/owner/extraction redesign or history/popup redesign is introduced.

## Required tests

| Cases | Evidence |
| --- | --- |
| UI04A-01 | Runtime/controller and real hook restore an await without future events; browser opens/closes/reopens during a held provider request. |
| UI04A-02 | Runtime and hook preserve completed-empty. |
| UI04A-03 | Hook records listener registration before origin lookup/request. |
| UI04A-04/05 | Pending response reconciles newer progress; lower buffered messages lose. |
| UI04A-06 | Buffered completion wins over late running response. |
| UI04A-07/19 | New route epoch/origin wins over old seq 999/1000. |
| UI04A-08 | Runtime replacement forces a fresh read and rejects retired instance. |
| UI04A-09 | Other-tab events cannot update bound workspace; browser binds empty B while A awaits provider. |
| UI04A-10 | Missing/failed/wrong-version/invalid-sequence responses never fabricate Ready. |
| UI04A-11 | Auth loss invalidates pending read and ignores late events/responses. |
| UI04A-12 | Existing owner suites and real registry termination after hook auth loss target every recorded owner. |
| UI04A-13/14 | Missing/ambiguous/conflicting identity/origin yields no active card. |
| UI04A-15 | Pending/unknown status normalizes; content success cannot invent result. |
| UI04A-16/17/18 | Real message listener proves reads do not change selection/seq or start work; hook/browser prove owners unchanged. |
| UI04A-20 | Lower/equal tuples and older retry snapshots cannot overwrite observed high-water mark. |

Additional tests cover lifecycle sequence changes, scan cancellation/completion/replacement, latest candidate selection, safety reset and START origin changes during owner commit. Existing auth, owner, UI00A/UI00B/UI01/UI02/UI03, result/fill, root/revision and permission regressions remain required gates.

Focused command:

```text
npm run test:run -- src/content/candidateWorkspaceRuntime.ui04a.test.ts src/sidepanel/workspaceHydration.ui04a.test.ts src/sidepanel/workspaceHydrationHook.ui04a.test.tsx src/sidepanel/useSidePanelActions.owner.test.tsx
```

Existing SPA panel regressions explicitly activate their intended origin before opening. They still switch away during parsing and retain all origin Fill/stale-history assertions. Exact Workspace header locators avoid matching syncing copy. Auth-loss fixtures wait for hydration and emulate content-authoritative START events instead of optimistic fabricated state.
