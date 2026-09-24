# Accessible roots (Phase 7)

Phase 7 extends the Universal Question Engine to pages whose questions live
outside the top document: same-origin iframes (including nested frames), open
shadow roots, and recycled/virtualized components. The principle is unchanged:
AI understands the page, DOM performs precise operations, and
**ABSTAIN > WRONG FILL**.

## The AccessibleRoot model

A runtime *accessible root* is one traversable DOM subtree:

- `top-document` — the tab's own document;
- `same-origin-frame` — an iframe document reachable through
  `iframe.contentDocument` (same-origin policy permitting), including frames
  nested inside other accessible frames or shadow roots;
- `open-shadow-root` — an `element.shadowRoot` that is not null (open mode).

`RootContext` carries only runtime data: `rootKey` (a process-local counter,
never a URL), `kind`, the traversable `root`, `ownerDocument`, `ownerWindow`,
the parent link, the frame/host anchor, `rootGeneration`, and `connected`.
Nothing in a root context is persisted; strong references exist only for
currently connected roots and every root is dropped as soon as its anchor
detaches.

## Root registry and lifecycle

`AccessibleRootRegistry` discovers, registers, reconciles, prunes and cleans
up roots during bounded reconciliation (never as an unbounded page-wide scan):

- same-origin frames are discovered from the top document and recursively from
  every registered frame document, bounded by `MAX_ROOT_DEPTH` (6) and
  `MAX_ACCESSIBLE_ROOTS` (32). Budget exhaustion is reported and fails closed;
- open shadow hosts are discovered on first sight of a root and on roots
  marked dirty by mutations, bounded by `MAX_SHADOW_HOST_PROBES` (512);
- an iframe document replacement keeps the root key but bumps
  `rootGeneration` — the previous document's bindings and attempts are stale;
- roots whose anchor detached are pruned, together with their descendants, and
  the watcher disconnects their observers and invalidates attempts bound to
  them;
- iframes that are not accessible yet (still loading) get a one-shot `load`
  listener; cross-origin frames never fire an accessible root and are simply
  out of scope (`FRAME-8`): no throw, no DOM access, no fabricated candidate,
  no fill.

The single Phase 6 watcher lifecycle owns one `MutationObserver` per
registered root plus per-frame load listeners. Observer callbacks only mark
roots dirty and schedule the shared 50 ms coalesced flush; canonical detection
and revision comparison run outside the callbacks. Start once, stop once,
cleanup everything.

## Root-scoped runtime identity

`QuestionIdentity.stableId` / `contentFingerprint` remain the authoritative
semantic identity and are never contaminated with DOM or root information.
Runtime question *instances* are root-scoped:
`QuestionInstanceKey = rootKey + stableId`. Two semantically identical
questions in different roots share nothing: not the active attempt, binding
epoch, owner, ActionPlan, ControlMapping, revision state or candidate runtime
id. Runtime attachment travels on the block as a non-enumerable Symbol key, so
it survives object spread inside the orchestration but is dropped by
`JSON.stringify` and never persisted.

Recycled virtualized components are classified by the revision registry: the
same owner element now representing a different `stableId` is `REPLACED` even
if the new stableId was never seen before; the old attempt is aborted and a
late result cannot fill the recycled owner (`VIRT-1`). A semantic-equivalent
rerender is `REBOUND`; a fingerprint change is `REVISION_CHANGED`; a root
document replacement is `ROOT_REPLACED`; user interaction state is still never
a semantic revision.

## Coordinates

The canonical runtime coordinate space is the **top-tab viewport**. Detector
results for frame roots are projected through every parent frame
(`frameRectToTopViewport`), accounting for the frame's content origin
(border/padding) and a provable uniform CSS scale. Non-uniform or ambiguous
transforms fail closed: coordinate-based fallbacks are denied, and the
debugger `REAL_CLICK` path refuses to click untransformed frame coordinates.
Shadow roots add no viewport of their own — their geometry is the owner
document's viewport and is never double-transformed.

## Detection, mapping, fill

`detectCandidatesInRoot(root, context)` reuses the stable structured-container
pipeline, the media/identity/completeness pipelines, and the boundary
classification for any accessible root; the legacy frame heuristic was
removed. Composed-tree support is provable-only: light DOM assigned to a slot
of the component's own shadow root is owned by that component
(`SHADOW-SLOT-1`); ownership that cannot be proven abstains.

Control mapping ids are root-scoped, so identical labels in different roots
never alias into one registry entry. Solve-start snapshot keys are
root-scoped, so two identical questions in different roots never share a
baseline. Fill, capture and **verification** resolve their scope inside the
question's own root (frame document with local coordinates, shadow root with
identity-first scope matching); a root that disappeared or was replaced since
detection fails closed with `STALE_ROOT_CONTEXT` / `ROOT_REMOVED` /
`ROOT_REPLACED` semantics — zero mutation.

All Phase 5 invariants are preserved: one question auto attempt = one
immutable solve-start baseline, transactional mutation with rollback and DOM
readback, `USER_STATE_CHANGED`, `STALE_ACTION_PLAN`,
`USER_STATE_SNAPSHOT_UNAVAILABLE`. A normal REBOUND never recaptures the
baseline; a whole iframe document replacement terminates the old attempt
instead of establishing a hidden new baseline inside it. Phase 6 history
policy is unchanged: identity-bearing questions reuse history only on exact
stableId + fingerprint match.

## Known limitations

- Cross-origin frames and closed shadow roots are out of scope by design.
- The ordered auto-solve plan is top-document first; cross-root questions
  enter through the bounded empty-plan fallback (`detectRootCandidates`) and
  skip the manual refinement pipeline (they are already canonical).
- Full-page detection counts top-document questions only.
- The extension's own UI shadow roots (floating window, highlight layer) are
  registered as roots but produce no candidates: `isExtensionUiElement`
  filters every element inside a `qs-` host.

## Security boundaries

No cross-origin bypass, no CDP DOM piercing, no closed-shadow piercing, no
main-world prototype patching, no anti-bot/anti-cheat/CSP bypass, no
credential/cookie access, no token logging, no new permissions, and no
automatic submit.
