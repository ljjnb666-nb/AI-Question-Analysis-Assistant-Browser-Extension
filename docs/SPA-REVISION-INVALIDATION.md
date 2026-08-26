# SPA revision invalidation

Phase 6 keeps three independent runtime concepts. A **semantic revision** is the
canonical `QuestionIdentity.stableId` plus `contentFingerprint`, reconstructed
through `observeLiveQuestion()` and the existing media/identity pipeline. A
**binding revision** is an equivalent live DOM replacement and increments only
the runtime `bindingEpoch`. **Interaction state** (checked/value/ARIA selection)
is deliberately ignored by the semantic watcher; Phase 5's immutable
solve-start snapshot remains the authority for `USER_STATE_CHANGED`.

`startQuestionRevisionWatch()` is the sole SPA watcher. Its MutationObserver
only filters and coalesces dirty work (50ms); canonical candidate detection runs
outside the callback. It ignores extension UI and answer-state-only attributes,
and observes content/media-relevant mutations. `stopSpaWatch()` owns its cleanup
through the existing runtime unwatch slot: observer disconnect, route listener
removal and timer cancellation.

Every provider attempt is bound, runtime-only, to stable ID, content fingerprint,
`routeEpoch` and a local hashed `routeFingerprint`. A semantic replacement,
removal, or route change aborts the existing `AbortController` with
`STALE_QUESTION_REVISION`. Provider retry code already treats that outcome as
deterministic. A late provider completion is rejected again by the final route
and revision gate before the existing Phase 5 one-shot canonical pre-mutation
observation and transactional fill.

No route URL, DOM node, MutationRecord, AbortController, or revision data is
persisted. History remains keyed by canonical semantic identity, so an old
fingerprint is retained but cannot be reused for a changed revision.

Known limit: this phase does not expand into iframe, Shadow DOM, portal, or
virtualized-component handling; those remain Phase 7 scope. It also never
submits, hands in, or finishes an assignment.

## Regression coverage

The runtime suite covers semantic text/option/formula fingerprint changes,
media identity changes through the existing Phase 5 production races, equivalent
binding re-renders, user interaction and extension-UI noise, question removal,
replacement, `pushState` route changes, watcher cleanup, and a production
`runAutoSolveAll` deferred-provider late-result race. The browser E2E suite
continues to load the packaged popup and side panel; dynamic-content behavior is
kept deterministic in the content-runtime integration tests because browser
extension injection is intentionally on-demand rather than a static content
script.
