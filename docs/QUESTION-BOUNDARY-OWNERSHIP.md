# Question Boundary, Ownership, and Completeness

Viewport visibility is not question ownership. Raw boundary evidence is captured before bbox clamping and survives full-page absolute-coordinate projection. Geometry is supporting evidence only; it cannot merge two candidates by itself.

The detector first classifies viewport clipping, resolves fragment ownership, safely groups only explicit same-question fragments, recomputes stable identity from the grouped semantic content, and evaluates completeness. Hard negative evidence wins: different native IDs, different ordinals, a complete option set followed by a new stem, clipped option tails followed by a stem, and different semantic owners all prevent grouping. Ambiguous ownership fails closed.

Runtime owner keys are scan-local semantic-owner evidence, never stable identity or history identity. Automatic candidates marked incomplete or unknown are withheld before history reuse, fill, and provider calls; legacy/manual captures without completeness retain their existing behavior. Grouped identity uses full identity source text rather than the display preview. Media ownership remains deferred to Phase 3.

For the original failure case, `C D` from a top-clipped previous question followed by `Which statement...` is not the same question even when the gap is 4px and horizontal overlap is 100%.
