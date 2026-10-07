# Phase 12 — Release Candidate Truth / Real Browser Acceptance

Phase 12 proves that a specific repository commit is a coherent release candidate, not merely a collection of independently green jobs.

## Phase split

### Phase 12A — RC Identity / Bundle Truth

A candidate is authoritative only when one exact source SHA binds all of the following:

- the verified Chrome MV3 extension artifact;
- the verified independent Admin Console artifact;
- the production analytics/auth/Admin server container image and retrievable compressed image archive;
- the pinned Node/npm toolchain used by CI and the server image;
- the product version used by `package.json`, source manifest, and built extension manifest;
- the exact pinned production container base image;
- successful extension and Admin real-browser gates that precede RC assembly.

The CI `rc_bundle` job is the Phase 12A authority. It runs only after both real-browser jobs pass, re-downloads and re-verifies both artifacts, builds the production analytics image, starts that image in production mode, checks `/healthz` and the protected Admin login surface, and emits one `rc-manifest.json`.

### Phase 12B — Real Browser Acceptance

Phase 12B consumes an accepted Phase 12A candidate and closes browser-only release boundaries that cannot be honestly inferred from unit/jsdom coverage. The dedicated `browser_acceptance` job runs against the verified extension artifact and uses OS/X11 keyboard input to invoke the production `_execute_action` command in real Chrome. This is a real user-invocation path for `activeTab`, not `chrome.action.openPopup()` called from extension JavaScript.

The gate proves positive full-screen and block screenshot authority on the invoked tab, same-origin persistence, denial on a different never-invoked tab, restoration when returning to the still-authorized original tab, and revocation after cross-origin navigation. `rc_bundle` now depends on this gate. See [PHASE12B-REAL-BROWSER-ACCEPTANCE.md](./PHASE12B-REAL-BROWSER-ACCEPTANCE.md).

Phase 12B must not turn known limitations into claimed support. Cross-origin iframe runtime coordination, closed shadow roots, unowned portal controls, and pointerdown partial-mutation behavior keep their existing documented status unless a separate scoped implementation changes them.

## Phase 12A invariants

- **RC_SOURCE_SHA_IS_SINGLE_AUTHORITY** — every RC component is bound to one exact 40-character Git SHA.
- **RC_ARTIFACTS_ARE_REVERIFIED_BEFORE_ASSEMBLY** — RC assembly never trusts artifact names alone; extension and Admin artifacts are re-verified after download.
- **RC_EXTENSION_VERSION_IS_SINGLE_SOURCE_ALIGNED** — `package.json`, `src/manifest.json`, and the built extension manifest must carry the same numeric version.
- **RC_SERVER_IMAGE_IS_BUILT_FROM_THE_SAME_SHA** — the production analytics/auth/Admin container is built only after exact-SHA checkout and its content-addressed Docker image ID is recorded in the RC manifest.
- **RC_BASE_IMAGE_IS_IMMUTABLE** — the production Node base image is pinned by exact version and `sha256` digest.
- **RC_PRODUCTION_CONTAINER_MUST_BOOT** — the built server image must start in `NODE_ENV=production`, answer `/healthz`, and serve the hardened Admin login surface.
- **RC_SERVER_ARCHIVE_RESTORES_EXACT_IMAGE** — after export, CI removes the tagged image, reloads the compressed archive, and requires the restored Docker image ID to equal the manifest-bound image ID.
- **RC_PROMOTION_USES_RETAINED_ARTIFACTS_NOT_REBUILDS** — a later release/promotion step must consume the retained RC artifacts identified by the manifest. A rebuild of the same source SHA is a new candidate assembly unless its artifact identities are independently proven equal.
- **RC_TREE_DIGESTS_ARE_CONTENT_DERIVED** — extension and Admin identity use deterministic SHA-256 tree digests over sorted relative paths, sizes, and bytes; timestamps are not identity.
- **NO_AUTOMATIC_SUBMISSION** — Phase 12 does not change the product rule that answer submission remains user-controlled.

## `rc-manifest.json` schema

The generated manifest contains:

- `schemaVersion`
- `sourceSha`
- `version`
- extension manifest version, version, file count, and tree SHA-256
- Admin file count and tree SHA-256
- pinned Node version and npm package-manager version
- analytics server Docker image ID
- compressed server-image archive filename, size, and SHA-256
- immutable base-image reference
- production Compose default image identity

The generated file is CI evidence and is not source-controlled. CI always uploads it as `quiz-solver-rc-manifest-<sourceSha>`. On pull-request and `main` runs, CI also retains the exact compressed server image as `quiz-solver-analytics-image-<sourceSha>` so the server candidate referenced by the manifest is retrievable rather than runner-local only. CI proves the archive is usable by deleting the local tag, loading the archive back into Docker, and requiring the restored image ID to match. Promotion must reuse this retained candidate rather than silently rebuilding the same source SHA.

## Non-goals of 12A

12A does not publish a Chrome Web Store release, push a container to a registry, change question detection/fill behavior, expand site compatibility, or declare the remaining `activeTab` manual boundary complete. Those require later explicit gates.


## Phase 12B invariants

- **REAL_BROWSER_ACTION_INVOCATION_IS_REQUIRED_FOR_POSITIVE_ACTIVE_TAB_EVIDENCE** — only a real extension action invocation can satisfy the positive screenshot authority gate.
- **ACTIVE_TAB_AUTHORITY_IS_TAB_SCOPED** — an uninvoked tab does not inherit another tab's screenshot authority.
- **ACTIVE_TAB_AUTHORITY_IS_ORIGIN_LIFECYCLE_SCOPED** — same-origin navigation preserves the observed grant while cross-origin navigation revokes it.
- **UNAUTHORIZED_SCREENSHOT_PATHS_FAIL_CLOSED** — missing authority produces an error and no fabricated image.
- **RC_BUNDLE_REQUIRES_REAL_BROWSER_ACCEPTANCE** — release-candidate assembly waits for `browser_acceptance`.
