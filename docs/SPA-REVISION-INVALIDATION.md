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
persisted. History reuse requires both the stable ID and the content
fingerprint to match, so an old revision's history entry is retained but can
never be reused for a changed revision.

## Production runtime boot

The content runtime stays on-demand: `chrome.scripting` injects the small
`content-main.js` bootstrap stub, which dynamically imports the heavy runtime
module inside the isolated world. Three build/manifest facts make that path
actually work in a browser, and all are covered by the browser E2E suite:

- `web_accessible_resources` exposes `content/*.js` to http(s) pages, because
  MV3 blocks content-script access to extension modules that are not listed.
- `vite.contentRuntime.config.ts` emits the runtime module as a real ES module
  (`export { bootstrapContentRuntime }`); the content-script build format is
  IIFE and cannot expose exports to a dynamic `import()`.
- `observeLiveQuestion()` reconstructs identity from the same structured
  stem/options text the detector used, instead of `innerText`. Real browsers
  insert layout line breaks into `innerText` for block-level option markup,
  which would change the canonical text and fail every transactional fill
  closed with `STALE_ACTION_PLAN`. This kept unit tests green while breaking
  real-browser fills, and the browser E2E suite now pins the behavior.

Known limit: this phase does not expand into iframe, Shadow DOM, portal, or
virtualized-component handling; those remain Phase 7 scope. It also never
submits, hands in, or finishes an assignment.

## Regression coverage

The runtime suite covers semantic text/option/formula fingerprint changes, stem
image and CSS background-image media swaps, equivalent formula re-renders,
class/ARIA-reflected answer state, extension-UI and unrelated-sibling noise
with bounded reconciliation, question removal, replacement, `pushState` route
changes including the never-reconciled final-gate case, watcher cleanup,
DOM-free runtime revision state, and a production `runAutoSolveAll`
deferred-provider late-result race.

The browser E2E suite (`e2e/spaRevision.spec.ts`) loads the packaged extension,
injects the production content runtime through the real on-demand bootstrap
path, starts auto-detect and auto-solve over `chrome.runtime` messages, and
holds the provider endpoint on a local origin. Scenario A replaces the
question's semantic content while the provider is pending and proves the late
stale result mutates nothing. Scenario B rerenders the same semantic question
and proves the result fills only the new live controls, never the detached
ones, with the extension remaining operational.

## Phase 8A result commit authority

Provider completion does not imply commit authority. Auto-solve results are
bound to the solve attempt that produced them, revalidated after provider work,
and checked again at the conditional history write, progress, and fill-input
boundaries. A stale result is discarded as `STALE_QUESTION_REVISION`; it is not
reported as provider failure or persisted to history.

Side Panel candidates retain their originating tab and URL. Parse, vision
retry, risky retry, and Fill use that origin and revalidate the live question's
stable identity, semantic fingerprint, and runtime owner. A per-candidate
attempt lease prevents older asynchronous retries from replacing newer state.
Screenshot capture is skipped when the origin is not the active tab because
the browser screenshot API captures the active tab in a window.
