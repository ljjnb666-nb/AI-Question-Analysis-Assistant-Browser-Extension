# Phase 14 — Reliability, Soak & Security Acceptance

Phase 14 is deliberately incremental: one reproducible failure mode, one
scoped change, exact-head CI, separate PR review, and merge-SHA freeze.

## Phase 14A — Popup dispatch readiness / stress regression

### Incident evidence

A historical Phase 13B branch push run (`37723619930`, attempt 1)
failed one of 1638 Vitest tests:
`src/popup/popup.ui02.test.tsx / UI02-C04`.
Its async assertion found no `START_AUTO_SOLVE_ALL` message after the
test located and clicked the primary button. An exact-SHA attempt 2
passed without product changes. Later PR and main runs passed as well.

**What this establishes:** at least one intermittent failure of the
Popup integration test. It does **not** by itself prove that the
production UI incorrectly authorizes a click or that the historical
root cause was the first rendered button.

### Failure hypothesis and invariant

`screen.findByRole(button)` verifies *existence only*. The Popup
mount loads authorization, provider readiness, tab URL and settings
asynchronously. The production handler uses a live coordinator
`isAuthenticatedNow()` and rechecks authority around await boundaries.
The old positive test clicked immediately after finding a button. A
transitioning or disabled button cannot establish an authorized
dispatch contract, so its click could yield no message legitimately.

**Never bypass the handler-level authority gate to fix a test.**

### Changes

- The positive `UI02-C04` test first drains the mocked settings
  messaging transitively, then waits for the action button to be
  enabled, the authenticated ready badge and the injectable page
  context. Only then does it click and assert the expected
  `START_AUTO_SOLVE_ALL` dispatch **to the exact tab ID 5**.
- Separate negative-path tests for missing providers and expired
  authorization remain intact. No sleep or arbitrary timeout is added
  to the positive test.
- New `npm run test:soak:popup` runs the **entire**
  `popup.ui02.test.tsx` test file in 20 separate Node/Vitest processes.
  This includes preceding integration tests and 50 tests per run:
  **1000 passed required, zero tolerated failures, no automatic retry**.
- CI `popup_soak` asserts the exact event/PR-head SHA and is a new
  `rc_bundle.needs` dependency. A single soak failure blocks the RC.
- Existing build, E2E, production extension behavior and
  `NO_AUTOMATIC_SUBMISSION` are unchanged.

### Acceptance and limitations

Required prior to merging Phase 14A:

1. `check` (lint, TS and full Vitest suite) PASS, including `UI02-C04`.
2. `popup_soak` PASS: all 20 **fresh-process** iterations, 50 tests each,
   not just the isolated C04 test.
3. Baseline extension, Admin, Phase 12B and Phase 13A browser E2E PASS.
4. `rc_bundle` only succeeds once `popup_soak` and its other
   dependencies PASS; RC manifest 6/6.
5. Independent PR-event CI on the exact head, review, explicit merge
   approval, exact main merge-SHA post-merge verification.

The targeted soak does **not** prove all 1638 tests are free of races
under cross-file worker contention, or long-duration browser memory
stability. If the historic assertion returns despite readiness, the
test must stay RED and the production authorization/messaging owner
chain investigated instead of allowing retries. The 20 clean-process
runs support a regression confidence statement, not mathematical proof
of no intermittent failures.

## Phase 14B onward — separate concerns

- Long-duration activeTab lifecycle, multi-tab ownership, SPA/
  iframe/re-render, cancellation and resource growth under real
  Chromium, with strict boundedness and origin isolation.
- Timeouts, network failures, retry/idempotence, stale route and
  authority revocation; preserve user-controlled submission.
- Security/privacy sweeps for credentials, tenant boundaries,
  leakage into logs/analytics/evidence, extension permissions and
  untrusted pages.
- Release soak evidence and immutable RC artifact identity.

Private learning-site claims remain `AUTH_REQUIRED_NOT_RUN`
(Phase 13B deliberately deferred); no run of Phase 14 upgrades those
claims without a legitimate separately reviewed user session.
