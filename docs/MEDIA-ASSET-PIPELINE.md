# MediaAsset Pipeline (Phase 3)

Media is first-class question evidence. The legacy `[图片]` text remains only as a backward-compatible readable-text placeholder; it is never the canonical representation of an image.

`QuestionBlock.mediaAssets` holds compact, JSON-safe `MediaAssetRef` metadata: media content fingerprint, ownership, availability, dimensions, and labels. The content runtime's `MediaPayloadStore` holds data URLs, serialized SVG, and canvas snapshots ephemerally. A separate bounded `MediaSourceLocatorStore` maps asset IDs to current-session remote/blob URLs. Neither store is written to history or progress messages.

Discovery is centralized for `img/currentSrc`, `picture`, lazy attributes, allowed image data URLs, blob URLs, CSS background URLs, inline SVG, and permitted canvas snapshots. Normal remote images are URL-only; blob media is explicitly unresolved until safely hydrated. Canvas security errors remain `tainted` rather than being bypassed.

Questions can retain multiple media assets. Ownership prefers option ancestry (including A/B/C/D), then stem ancestry and semantic ownership; cross-question and ambiguous ownership fail closed. Decorative assets and formula representations are excluded. The legacy `hasImage` and `questionImageUrl` are deterministic compatibility projections, not the source of truth.

Media content fingerprints canonicalize URL fragments, known cache/auth volatility, and query ordering while retaining semantic query parameters. Signed raw URLs stay only in the runtime locator; serialization removes volatile credentials while retaining semantic query parameters. Question identity includes sorted semantic media hints, so an option-image change changes question content identity without depending on layout geometry.

Visual completeness requires usable stem media when the text depends on a figure. Blocked, tainted, or unresolved stem media makes this evidence unknown rather than pretending it is complete.

Phase 4 may acquire media payloads on demand for a solver package. Phase 3 makes no AI calls, changes no solver prompt, and adds no submission capability; users continue to review and submit manually.
