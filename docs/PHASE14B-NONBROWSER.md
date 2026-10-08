# Phase 14B — Non-browser lifecycle concurrency hardening

Phase 13B real authenticated-site testing and **new** real-browser endurance
tests are deferred at the user's request. Existing CI release gates are
retained, not removed or weakened. This document distinguishes contract
verification from live Chromium acceptance.

## 14B-01: Same-tab owner-generation ABA race (scoped change)

### Reproduced failure

At source `bdbc2439658ba025053eda1969445a91aa093e4f`, each
`ProtectedWorkKind + tabId` lived at one fixed
`protectedWorkOwner:<kind>:<tabId>` key in `chrome.storage.session`.
`terminateRecordedProtectedWork()` captured a snapshot, awaited STOP
delivery, then cleared by kind + tabId. If another context marked a
new authorized run of the same kind in the SAME tab during the awaited
STOP, that stale cleanup erased the newer owner.

Fail-first branch CI [37730629615](https://github.com/ljjnb666-nb/AI-Question-Analysis-Assistant-Browser-Extension/actions/runs/37730629615)
proved both negative examples: `PHASE14B_01` and `PHASE14B_02`
failed with an empty owner registry instead of a surviving owner;
the pre-existing 1638 tests passed.

The old `AUTH_UI_58` regression only covered a new owner in a
DIFFERENT tab, which the previous key scheme already preserved.

### Resolution and invariants

- **New writes use an immutable generation key:**
  `protectedWorkOwner:<kind>:<tabId>:<uuid>`.
  Distinct starts, even from different extension contexts on the same
  tab and kind, cannot overwrite each other.
- **Legacy keys remain readable:** before-upgrade session records in
  the original `protectedWorkOwner:<kind>:<tabId>` format are recognized.
- **Semantic reads are deduplicated by kind/tab**; one tab with two
  captured generations receives only one STOP for its kind.
- **Auth-loss termination is snapshot-fenced:** it deletes only the
  exact generation keys read *before* sending STOP. New generations
  committed later are never among that deletion list.
- **Normal explicit completion** `clearProtectedWorkOwner(kind, tabId)`
  deletes only generations present in its own storage snapshot, not
  a mark made after that snapshot.
- The observed layout remains entirely within transient
  `chrome.storage.session`; no persistent user-identity or AI
  provider material is introduced.
- **No new browser tests**, no changes to fill, solving, automatic
  submission, or externally visible UI.

### Unit/regression coverage

- `PHASE14B_01` old autoSolve STOP vs new same-tab autoSolve.
- `PHASE14B_02` old full-page cancellation vs new same-tab scan.
- `PHASE14B_03` multiple generations deduplicated into one STOP per tab.
- `PHASE14B_04` legacy stored keys remain visible and clearable.
- `PHASE14B_05` a mark during an in-flight explicit clear survives.
- Existing cross-context different-tab, cross-kind, reconciliation,
  stale-DONE, Popup, and Side Panel tests remain intact. A bridge test
  formerly probing a hard-coded old key now asserts the public owner
  registry instead of an implementation detail.

### Boundary / further work

The extension storage API has **no compare-and-swap**, so this change
does NOT make all possible start/stop transitions atomic. In particular,
a `clearProtectedWorkOwner(kind, tabId)` that begins *after* a newer
generation was written can still clear both: its public call signature
does not yet carry a run-specific generation token. Closing this
remaining normal-completion ambiguity requires propagating generation
identity through START, progress, DONE and clear callers (separate
scoped Phase 14B-02 work).

Also audit growth in orphaned generations following abnormal shutdowns
under boundedness testing; avoid hiding stale records with a blind
global clear. An in-flight STOP can affect actual runtime work on
the same tab; this patch preserves tracking of newer generations but
does not promise that a STOP message is run-token-scoped.

**Freeze rule:** do not mark 14B-01 complete until exact-head PR CI
and exact main merge-SHA CI pass. Do not claim comprehensive Phase 14
completion from this change.

## 14B-02A: Side Panel auth-loss snapshot-fenced termination

The Side Panel previously duplicated Popup's auth-loss path: read the
cross-surface registry, union local pending Tab IDs, send STOP/CANCEL, and
then call `clearProtectedWorkOwner(kind, tabId)` after the awaited
transport. This last call takes a **new storage snapshot**, which can
include a later same-tab generation not present when STOP began. Thus
14B-01's immutable-generation fix was bypassed by the Side Panel.

### Scoped repair

- Reuse `terminateRecordedProtectedWork()` as the **single** auth-loss
  STOP/CANCEL and immutable-key snapshot-cleanup authority across the two
  surfaces.
- Extend that helper with optional local pending intent tab IDs, to preserve
  the Side Panel's immediate pre-storage-commit STOP behavior. Pending tabs
  join STOP fanout, but do **not** broaden the snapshot's deletion keys.
- Keep one STOP per unique tab and kind, preserving multi-tab and
  cross-surface owners. No request for AI solve/fill/submit is introduced.
- Limit callback types to the two supported termination message variants
  rather than a generic `{ type: string }` bag.
- Add deterministic unit checks for the pending-only tab case, same-tab
  post-snapshot generation survival, and deduplicated STOP fanout.
- Add a real `SidePanelApp` hook/render-level regression in which auth loss
  parks STOP delivery, another surface records a newer generation on the same
  tab, and completion leaves the new owner visible.

### Boundaries

This protects **auth-loss snapshot cleanup**, not run-scoped content-script
cancellation. The STOP/CANCEL messages are still tab-scoped, so a STOP
received after a newer run starts may interrupt that runtime work. Ordinary
DONE and manual stop call sites still need run-generation authority. This
must stay open as **Phase 14B-02B**; no success claim about those paths
may be derived from this PR.

Real authenticated-site tests and new long-run Chromium endurance remain
deferred; the existing CI release gates are retained unchanged.

## Remaining non-browser work order

| Scope | Next contract | New real-browser endurance tests |
| --- | --- | --- |
| 14B-02B | Run-scoped DONE/manual cancel authority, message-generation protocol and caller propagation | Deferred |
| 14C | Fault injection for retries, timeouts, out-of-order responses, reentrant cancellation | Deferred |
| 14D | Privacy/security review of logs, tenant/session separation, bounded stores | Deferred |
| 14E | CI + immutable release artifact verification and non-browser release checklist | Deferred |
| 14F | Long-run Chromium, SPA/iframe, resource and website-specific user acceptance | **Deferred / NOT RUN** |

Real-world account-dependent compatibility still remains
`AUTH_REQUIRED_NOT_RUN` under Phase 13B.
