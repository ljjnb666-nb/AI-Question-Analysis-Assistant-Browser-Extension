# Release Readiness

This is the authoritative release-readiness entry point. The historical release-hardening umbrella was **Issue #18** ("Release hardening: security, privacy, CI and permission gate"), which GitHub records as closed/completed on 2026-09-30. Phase-specific records live in their merged PRs, CI runs, and retained evidence artifacts; this document must stay consistent with the frozen behavior of the `main` branch.

Status entries describe merged, frozen behavior. This document deliberately does not pin a "current main SHA" as a long-term truth, and it does not hold a live auto-updating status feed; consult the repository history, the CI runs, and the Issue #18 completion record for exact SHAs and final evidence.

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
| REL-DOC-01 | Release-hardening documentation finalization | COMPLETE — Issue #18 is closed/completed; later RC phases have their own exact-SHA evidence gates |
| RC-BROWSER-01 | Phase 12B real-browser `activeTab` action/grant lifecycle acceptance | COMPLETE — merged and exact merge-SHA `browser_acceptance` / RC CI passed |
| RC-SITE-01 | Phase 13A public real-site read-only acceptance | IN REVIEW — branch evidence is green; complete only after exact merge-SHA main `real_site_acceptance` + `rc_bundle` pass |

REL-DOC-01 is the completed historical release-hardening documentation gate. Phase 12 and later release-candidate gates do not reopen Issue #18; each phase freezes only after its own exact merge-SHA post-merge CI and retained evidence pass.

## Frozen release invariants

These invariants are frozen release behavior. Release hardening work must not weaken them.

- **NO_SECRET_IN_LOGS_HISTORY_ANALYTICS_OR_EXPORTS** — API keys, auth tokens, passwords, and verification codes are never written to logs, parse history, analytics payloads, or error-log exports.
- **ANALYTICS_BEHAVIOR_MATCHES_USER_VISIBLE_SETTING** — analytics is off by default and is sent only when the user-visible setting is on; turning it off stops uploads and clears local analytics logs.
- **ADMIN_SECURITY_FAILS_CLOSED_IN_PRODUCTION** — the analytics admin surface fails closed when the admin token is not configured.
- **RELEASE_CI_BUILDS_THE_EXACT_COMMIT** — every CI job checks out and asserts the exact event/PR-head SHA before building or testing.
- **RELEASE_CI_RUNS_REAL_EXTENSION_SMOKE_TESTS** — CI runs real extension Playwright E2E against the built artifact, not mocks alone.
- **REAL_BROWSER_ACTIVE_TAB_AUTHORITY_IS_GATED** — CI uses a real OS-level extension action invocation to prove positive screenshot authority, tab/origin lifecycle scoping, and fail-closed denial without a valid grant.
- **LIVE_SITE_CLAIMS_REQUIRE_LIVE_BROWSER_EVIDENCE** — sanitized/platform-derived fixtures remain regression evidence and cannot be upgraded into live-platform claims without the Phase 13 live-site gate.
- **LIVE_SITE_ACCEPTANCE_IS_READ_ONLY_BY_DEFAULT** — the public live-site gate detects/inspects only and must not solve, fill, advance, or submit.
- **PERMISSIONS_HAVE_DOCUMENTED_RUNTIME_JUSTIFICATION** — every retained permission and host authority is documented with its runtime justification in [PERMISSIONS.md](./PERMISSIONS.md) and is verified against source and built manifests.
- **RELEASE_HARDENING_MUST_NOT_WEAKEN_PHASE_8_AUTHORITY** — the Phase 8 fill authority (fresh semantic mapping, validated answer plans, authoritative readback) is the floor; hardening may only tighten it.
- **NO_AUTOMATIC_SUBMISSION** — the extension parses and fills answers but never submits them; submission stays user-controlled.
- **AUTH_SESSION_IS_SERVER_AUTHORITATIVE** — sessions expire and are validated/revoked by the server (`/auth/session`, `/auth/logout`); the locally stored identity is a cache, not authority.
- **RATE_LIMITER_MEMORY_IS_BOUNDED_PER_PROCESS** — the server's limiter is a per-process fixed-window limiter with bounded per-namespace buckets; active buckets are not evicted to reset authority.
- **LOCAL_API_KEY_ENCRYPTION_IS_NOT_A_SECRET_VAULT** — the local `qse:v1` credential envelope is encrypted-at-rest obfuscation against accidental plaintext disclosure, not OS-level secret protection (see [API-KEY-SECURITY.md](./API-KEY-SECURITY.md)).

## Known safe limitations

These known safe limitations and unverified browser boundaries are explicitly recorded rather than hidden, and none of them is claimed as supported. Where automated evidence exists, it is cited below; unverified cases remain marked NOT RUN rather than being presented as proven.

1. **Portal/teleport controls without proven ownership** — controls rendered outside the question owner have no proven ownership, so they fail closed: no option keys are inferred and no fill is issued (COMPAT-14).
2. **Pointerdown-driven custom widgets** — a widget that commits a choice on `pointerdown` can produce a partial mutation whose effect cannot be proven; automation stops safely instead of claiming success (COMPAT-15).
3. **Cross-origin iframes** — the current content runtime injects into the top frame only; there is no coordinated per-frame runtime yet, so questions living in a separate cross-origin frame are not handled (KNOWN_ARCHITECTURE_LIMITATION).
4. **Closed shadow roots** — page-owned closed shadow roots are not exposed to extension DOM traversal and are unsupported by browser security design (UNSUPPORTED_BY_BROWSER_SECURITY).

## Release gates

**Pre-merge (exact-head CI).** Every PR runs CI at the exact PR head SHA; each job asserts the checked-out source SHA before doing work.

Required CI jobs:

- `check` — lint + typecheck + unit tests (`npm run check`)
- `build_artifact` — production build, artifact verifier and permission verifier tests, `npm run verify:artifact`, upload of the verified artifact
- `e2e` — downloads the same verified artifact produced by `build_artifact`, re-verifies it, and runs the baseline real extension Playwright E2E (`test:e2e:dist`) against it
- `browser_acceptance` — downloads that same verified extension artifact and runs the Phase 12B OS-level action/`activeTab` lifecycle gate (`test:e2e:phase12b:dist`)
- `real_site_acceptance` — downloads the same verified extension artifact and runs the Phase 13 public live-site read-only gate (`test:e2e:phase13:dist`); no AI solve/fill/submit action is sent
- `admin_e2e` — downloads the verified Admin artifact and runs the Admin real-browser gate
- `rc_bundle` — waits for baseline E2E, Admin E2E, Phase 12B browser acceptance, and Phase 13 live-site acceptance before candidate assembly

**Post-merge.** CI on the exact merge SHA must pass before a release stage freeze. The merge-SHA run is the authoritative green signal for the frozen state.

## Deferred work

The following are explicitly **not** release-hardening blockers and are **not** completed. They are future work and must not be presented as shipped capability:

- Frontend UX optimization
- Additional authenticated-site compatibility beyond the Phase 13A public read-only gate
- Cross-origin frame architecture (per-frame runtime, frame identity, message authority)
- Pointerdown-driven widget compatibility redesign
- Other future performance/refactor work
