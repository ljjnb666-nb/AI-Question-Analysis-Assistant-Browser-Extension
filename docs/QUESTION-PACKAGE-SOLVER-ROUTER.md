# Question Package → Solver Router

`QuestionBlock` remains a serializable observation: it contains text, identity and metadata-only `MediaAssetRef`s. `SolverQuestionPackage` is a separate, runtime-only object that contains the current question's usable sources. It is never stored in history, progress, analytics, or logs.

The package builder reads a bounded `MediaPayloadStore` first (data URLs, canvas snapshots and serialized SVG), then a runtime-only `MediaSourceLocatorStore` for remote URLs. Blob URLs are fetched only with normal browser semantics, no credentials, an abort signal and bounded MIME/size rules. A missing, blocked, tainted, evicted, or unacquirable required asset fails closed with `MEDIA_SOURCE_UNAVAILABLE` or `MEDIA_BLOCKED`; it must not silently become a text-only request. A revision-validated question screenshot may be supplied only as the final fallback and is marked `mediaFallbackUsed`.

Only deterministic ownership roles `stem` and `option` are permitted. Stem media are ordered by semantic order; option media are ordered A–F then semantic order. Request dedupe keys include fingerprint, role and option key, so an A/B visual duplicate remains distinct. Unknown, decorative, shared-context-candidate and cross-question assets are never sent.

The provider-neutral content sequence includes extension-generated labels such as `Question stem image 1:` and `Option B image:` before every image. OpenAI-compatible adapters send data or remote `image_url` parts; Anthropic and Gemini produce multiple inline image blocks (remote source acquisition is bounded and credential-free). MIME is preserved for PNG, JPEG, WEBP and GIF; serialized SVG keeps its SVG MIME.

Provider request logs must contain only safe metadata (asset id, role, fingerprint prefix, byte count), never raw data URLs, base64, blob URLs, signed URLs or API keys. The router only hydrates media for the current eligible question, so acquisition is O(N) in that question's media count.

This phase does not introduce auto-submit or alter answer/control mapping. Phase 5 owns AnswerPlan and control mapping changes.
