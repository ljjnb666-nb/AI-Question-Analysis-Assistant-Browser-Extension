# Question Model V2

Question identity has three deliberately separate values.

- `QuestionBlock.id` is the runtime observation ID. DOM scans may recreate it on every render.
- `QuestionIdentity.stableId` identifies the same question instance across equivalent renders.
- `QuestionIdentity.contentFingerprint` captures canonical question content for diagnostics and compatible history reuse.

For example, a React rerender may change `runtimeId` from `auto-172-a8f9` to `auto-172-bd11`, while its stable ID remains `q_v1_74af1c2e`.

Identity V1 uses a deterministic browser-safe FNV-1a hash. It never uses time, random values, viewport coordinates, or scroll position. Native question identifiers win when they pass conservative stability checks; otherwise the model uses canonical content plus an ordinal, a structural hint, or content alone.

`QuestionBlock.identity` is optional so existing history stored before V2 remains readable. Question Model V2 contracts (`CanonicalQuestion`, `QuestionObservation`, provenance, and evidence references) are additive contracts for later phases; they do not change solver, autofill, ownership, or media behavior in Phase 1.
