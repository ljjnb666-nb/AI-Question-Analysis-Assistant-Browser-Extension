# Phase 12 — Release Candidate Truth / Real Browser Acceptance

Phase 12 proves that a specific repository commit is a coherent release candidate, not merely a collection of independently green jobs.

## Phase split

### Phase 12A — RC Identity / Bundle Truth

A candidate is authoritative only when one exact source SHA binds all of the following:

- the verified Chrome MV3 extension artifact;
- the verified independent Admin Console artifact;
- the production analytics/auth/Admin server container image;
- the product version used by `package.json`, source manifest, and built extension manifest;
- the exact pinned production container base image;
- successful extension and Admin real-browser gates that precede RC assembly.

The CI `rc_bundle` job is the Phase 12A authority. It runs only after both real-browser jobs pass, re-downloads and re-verifies both artifacts, builds the production analytics image, starts that image in production mode, checks `/healthz` and the protected Admin login surface, and emits one `rc-manifest.json`.

### Phase 12B — Real Browser Acceptance

Phase 12B consumes an accepted Phase 12A candidate and closes browser-only release boundaries that cannot be honestly inferred from unit/jsdom coverage. In particular, manual or otherwise authoritative evidence is still required for real toolbar `activeTab` grant success/lifecycle before it can be claimed as verified.

Phase 12B must not turn known limitations into claimed support. Cross-origin iframe runtime coordination, closed shadow roots, unowned portal controls, and pointerdown partial-mutation behavior keep their existing documented status unless a separate scoped implementation changes them.

## Phase 12A invariants

- **RC_SOURCE_SHA_IS_SINGLE_AUTHORITY** — every RC component is bound to one exact 40-character Git SHA.
- **RC_ARTIFACTS_ARE_REVERIFIED_BEFORE_ASSEMBLY** — RC assembly never trusts artifact names alone; extension and Admin artifacts are re-verified after download.
- **RC_EXTENSION_VERSION_IS_SINGLE_SOURCE_ALIGNED** — `package.json`, `src/manifest.json`, and the built extension manifest must carry the same numeric version.
- **RC_SERVER_IMAGE_IS_BUILT_FROM_THE_SAME_SHA** — the production analytics/auth/Admin container is built only after exact-SHA checkout and its content-addressed Docker image ID is recorded in the RC manifest.
- **RC_BASE_IMAGE_IS_IMMUTABLE** — the production Node base image is pinned by exact version and `sha256` digest.
- **RC_PRODUCTION_CONTAINER_MUST_BOOT** — the built server image must start in `NODE_ENV=production`, answer `/healthz`, and serve the hardened Admin login surface.
- **RC_TREE_DIGESTS_ARE_CONTENT_DERIVED** — extension and Admin identity use deterministic SHA-256 tree digests over sorted relative paths, sizes, and bytes; timestamps are not identity.
- **NO_AUTOMATIC_SUBMISSION** — Phase 12 does not change the product rule that answer submission remains user-controlled.

## `rc-manifest.json` schema

The generated manifest contains:

- `schemaVersion`
- `sourceSha`
- `version`
- extension manifest version, version, file count, and tree SHA-256
- Admin file count and tree SHA-256
- analytics server Docker image ID
- immutable base-image reference
- production Compose default image identity

The generated file is CI evidence and is not source-controlled. CI uploads it as `quiz-solver-rc-manifest-<sourceSha>`.

## Non-goals of 12A

12A does not publish a Chrome Web Store release, push a container to a registry, change question detection/fill behavior, expand site compatibility, or declare the remaining `activeTab` manual boundary complete. Those require later explicit gates.
