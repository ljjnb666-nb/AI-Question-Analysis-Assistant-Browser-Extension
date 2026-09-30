# Release Readiness

This is the authoritative status summary for the Release Hardening effort. Umbrella tracking issue: **Issue #18** ("Release hardening: security, privacy, CI and permission gate"). Phase-specific records live in their merged PRs and the issue history; this document is the single entry point for release status and must stay consistent with the frozen behavior of the `main` branch.

Status entries here describe merged, frozen behavior. This document deliberately does not pin a "current main SHA" as a long-term truth; consult the repository history and the post-merge CI runs for exact SHAs.

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| REL-SEC-01 | Secret-handling hardening (no secrets in logs, history, analytics, exports) | COMPLETE |
| REL-ADM-01 | Analytics admin security (fail-closed admin auth in production) | COMPLETE |
| REL-PRIV-01 | Privacy contract alignment (consent-gated analytics, data-flow documentation) | COMPLETE |
| REL-CI-01 | Release CI (exact-commit checkout, build/artifact/E2E gates) | COMPLETE |
| REL-PERM-01 | Permission contract verification (`verify:permissions`, `verify:artifact`) | COMPLETE |
| REL-AUTH-01 | Auth hardening (server-authoritative sessions, expiry, revocation, startup validation UI) | COMPLETE |
| REL-RATE-01 | Rate limiter resource bounding (per-process, bounded per namespace) | COMPLETE |
| REL-KEY-01 | Local credential storage versioning (`qse:v1` envelope, legacy semantics) | COMPLETE |
| REL-DOC-01 | Documentation finalization (this phase) | IN REVIEW — pending merge and post-merge verification |

Issue #18 remains OPEN until REL-DOC-01 merges, post-merge CI on the exact merge SHA passes, and the final completion record is added to the issue.

## Frozen release invariants

These invariants are frozen release behavior. Release hardening work must not weaken them.

- **NO_SECRET_IN_LOGS_HISTORY_ANALYTICS_OR_EXPORTS** — API keys, auth tokens, passwords, and verification codes are never written to logs, parse history, analytics payloads, or error-log exports.
- **ANALYTICS_BEHAVIOR_MATCHES_USER_VISIBLE_SETTING** — analytics is off by default and is sent only when the user-visible setting is on; turning it off stops uploads and clears local analytics logs.
- **ADMIN_SECURITY_FAILS_CLOSED_IN_PRODUCTION** — the analytics admin surface fails closed when the admin token is not configured.
- **RELEASE_CI_BUILDS_THE_EXACT_COMMIT** — every CI job checks out and asserts the exact event/PR-head SHA before building or testing.
- **RELEASE_CI_RUNS_REAL_EXTENSION_SMOKE_TESTS** — CI runs real extension Playwright E2E against the built artifact, not mocks alone.
- **PERMISSIONS_HAVE_DOCUMENTED_RUNTIME_JUSTIFICATION** — every retained permission and host authority is documented with its runtime justification in [PERMISSIONS.md](./PERMISSIONS.md) and is verified against source and built manifests.
- **RELEASE_HARDENING_MUST_NOT_WEAKEN_PHASE_8_AUTHORITY** — the Phase 8 fill authority (fresh semantic mapping, validated answer plans, authoritative readback) is the floor; hardening may only tighten it.
- **NO_AUTOMATIC_SUBMISSION** — the extension parses and fills answers but never submits them; submission stays user-controlled.
- **AUTH_SESSION_IS_SERVER_AUTHORITATIVE** — sessions expire and are validated/revoked by the server (`/auth/session`, `/auth/logout`); the locally stored identity is a cache, not authority.
- **RATE_LIMITER_MEMORY_IS_BOUNDED_PER_PROCESS** — the server's limiter is a per-process fixed-window limiter with bounded per-namespace buckets; active buckets are not evicted to reset authority.
- **LOCAL_API_KEY_ENCRYPTION_IS_NOT_A_SECRET_VAULT** — the local `qse:v1` credential envelope is encrypted-at-rest obfuscation against accidental plaintext disclosure, not OS-level secret protection (see [API-KEY-SECURITY.md](./API-KEY-SECURITY.md)).

## Known safe limitations

These limitations are known, tested, and fail safe. They are recorded rather than hidden, and none of them is claimed as supported.

1. **Portal/teleport controls without proven ownership** — controls rendered outside the question owner have no proven ownership, so they fail closed: no option keys are inferred and no fill is issued (COMPAT-14).
2. **Pointerdown-driven custom widgets** — a widget that commits a choice on `pointerdown` can produce a partial mutation whose effect cannot be proven; automation stops safely instead of claiming success (COMPAT-15).
3. **Cross-origin iframes** — the current content runtime injects into the top frame only; there is no coordinated per-frame runtime yet, so questions living in a separate cross-origin frame are not handled (KNOWN_ARCHITECTURE_LIMITATION).
4. **Closed shadow roots** — page-owned closed shadow roots are not exposed to extension DOM traversal and are unsupported by browser security design (UNSUPPORTED_BY_BROWSER_SECURITY).
5. **`activeTab` real toolbar screenshot success/lifecycle** — automated CI proves only fail-closed behavior (`AUTOMATED_ACTIVE_TAB_UNAVAILABLE_FAILS_CLOSED`). Real user-activation success acceptance (`REAL_USER_ACTIVATION_SCREENSHOT_SUCCESS`) and the grant-lifecycle scenarios remain NOT RUN (see [PERMISSIONS.md](./PERMISSIONS.md)).

## Release gates

**Pre-merge (exact-head CI).** Every PR runs CI at the exact PR head SHA; each job asserts the checked-out source SHA before doing work.

Required CI jobs:

- `check` — lint + typecheck + unit tests (`npm run check`)
- `build_artifact` — production build, artifact verifier and permission verifier tests, `npm run verify:artifact`, upload of the verified artifact
- `e2e` — downloads the same verified artifact produced by `build_artifact`, re-verifies it, and runs real extension Playwright E2E (`test:e2e:dist`) against it

**Post-merge.** CI on the exact merge SHA must pass before a release stage freeze. The merge-SHA run is the authoritative green signal for the frozen state.

## Deferred work

The following are explicitly **not** release-hardening blockers and are **not** completed. They are future work and must not be presented as shipped capability:

- Frontend UX optimization
- Expanded site compatibility
- Cross-origin frame architecture (per-frame runtime, frame identity, message authority)
- Pointerdown-driven widget compatibility redesign
- Manual `activeTab` lifecycle evidence (real-toolbar success and grant-lifecycle scenarios)
- Other future performance/refactor work
