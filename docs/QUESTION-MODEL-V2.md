# Question Model V2

Question identity has three deliberately separate values.

- `QuestionBlock.id` is the runtime observation ID. DOM scans may recreate it on every render.
- `QuestionIdentity.stableId` identifies the same question instance across equivalent renders.
- `QuestionIdentity.contentFingerprint` captures canonical question content for diagnostics and future reconciliation.

For example, a React rerender may change `runtimeId` from `auto-172-a8f9` to `auto-172-bd11`, while its stable ID remains `q_v1_74af1c2e`.

Identity V1 uses a deterministic browser-safe FNV-1a hash. It never uses time, random values, viewport coordinates, scroll position, or URL paths. Native question identifiers are strong signals but are not assumed to be hostname-global unique: a native stable input is bound to canonical question content (`native:<id>|content:<fingerprint>`). Therefore, the same native ID with changed semantic content is a different stable identity. Without a native ID, the model uses canonical content plus an ordinal, a structural hint, or content alone.

`QuestionBlock.identity` is optional so existing history stored before V2 remains readable. When both a current block and a history block have trusted V2 identities, a stable-ID mismatch is fail-closed: they are different question instances and history reuse must not fall back to content fingerprints or text similarity. Identity reconciliation belongs to a later dedicated layer, not the history cache.

Identity V1 currently uses 32-bit FNV-1a. Identity versioning allows migration to a wider fingerprint if collision risk becomes material.

A future PageScope or AssignmentScope may become an additional identity dimension, but Phase 1 intentionally does not introduce a page, assignment, or question-revision model.

Question Model V2 contracts (`CanonicalQuestion`, `QuestionObservation`, provenance, and evidence references) are additive contracts for later phases; they do not change solver, autofill, ownership, or media behavior in Phase 1.
