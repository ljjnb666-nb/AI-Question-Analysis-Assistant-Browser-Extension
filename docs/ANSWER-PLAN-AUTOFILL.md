# AnswerPlan and verified autofill

`ParseResult` is semantic solver output, not a DOM instruction. Phase 5 converts it to a validated `AnswerPlan`, discovers controls only inside the selected question owner, maps semantic option keys to runtime-only `ControlRef`s, then creates a deterministic `ActionPlan`.

`ControlRegistry` holds the `HTMLElement`s only in memory. Neither DOM nodes nor ControlRefs are written to history or storage. Mapping uses labels and local semantic text before any DOM-order compatibility behavior; duplicate active mappings fail closed.

Immediately before mutation, the executor checks question id, content fingerprint, owner connectivity, and every registry node. It snapshots only relevant controls, applies native click/event-compatible text updates, reads actual DOM state back, and rolls back on a mismatch. A no-change state is still read back and reported separately. The executor has no submit, next, finish, or hand-in action.

User-owned changes are represented by an optional solve-start snapshot: if the pre-execution snapshot differs, execution returns `USER_STATE_CHANGED` without mutation. Callers that can retain solve-start state must pass it to `executeTransaction`; Phase 6 will extend this across richer SPA invalidation.

The release-critical metric is Wrong Question Fill Rate: ambiguity must abstain rather than risk a wrong fill. Discovery is O(N) within one question owner and never intentionally scans the whole page for controls. Answer text is not telemetry.
