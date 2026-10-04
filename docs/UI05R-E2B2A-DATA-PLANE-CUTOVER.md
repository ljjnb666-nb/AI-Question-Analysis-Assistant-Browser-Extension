# UI05R-E2B2A data plane authority cutover

Base: `088e6bc1901d9288345cadd523dde1d3447aa57a`.
Branch: `feat/ui05r-e2b2a-data-plane-cutover`.

## Runtime authority

The background owner initializes the connection authority. Every production
`parseQuestion`/`parseQuestionPackage` resolves one non-secret
`AIConnectionRuntimeConfig` from `AIConnectionState`. It validates endpoint
security and auth placement before resolving any credential. Caller settings
cannot override provider, protocol, endpoint, model, auth, or credentials.

`ParsePreferences` contains only `preferredRoute` and `language`.
`loadParsePreferences` initializes authority before reading ordinary preferences,
then explicitly returns those two fields. A structurally supplied full
`AppSettings` object has no AI request authority.

Side Panel batch/vision/risky retries and content manual/auto/tiered parsing now
use this preference loader. Capture hints use non-secret runtime model and inline
transport assessments. The parser independently resolves and enforces authority;
capture hints never authorize dispatch. Review requests keep the committed model
instead of assigning a different legacy `apiModel`.

## Protocol, model, endpoint, and authentication

Dispatch is an exhaustive switch on `runtime.protocol`:

| Protocol | Adapter |
| --- | --- |
| `anthropic_messages` | Anthropic Messages |
| `openai_chat_completions` | OpenAI Chat Completions |
| `gemini_generate_content` | Gemini Generate Content |

Unhandled protocols fail with `AI_PROTOCOL_UNSUPPORTED`, never a default client.
Adapters receive `ProviderRequestContext`, with runtime metadata, attempt-local
credential, language, external signal, and `beforeDispatch`. They use only
`runtime.selectedModelId` and `runtime.endpoint`. URL path joining preserves
configured query parameters; Gemini also respects the committed endpoint.
`presetId` controls only preset body behavior (MiniMax) and existing custom
streaming policy, never protocol or credential placement.

`authScheme` owns placement: bearer, exact named header, named query parameter,
or none. Header names must be legal HTTP tokens. Query names must be nonempty and
values are encoded with `URLSearchParams`. The old custom Anthropic 401 bearer
fallback is deleted. No-auth sends no secret even if optional credential metadata
exists.

Endpoint security parses a real URL and rejects userinfo. HTTPS is allowed.
HTTP is allowed only for exact `localhost`, normalized IPv4 loopback `127/8`, or
IPv6 `::1`. Other hosts, private network HTTP, misleading suffixes, wildcard
addresses, and other schemes fail before decryption. Provider fetches always use
`redirect: "error"`; a real two-server 302 test proves no second-origin request.

## Capability and media enforcement

The existing routing heuristics continue to plan text/vision/hybrid. Required
canonical stem/option media forces a visual auto route regardless of OCR length.
Explicit text cannot discard canonical media. Explicit Vision on unknown or
text-only models fails closed. Normal custom text remains executable without
requiring known vision support.

Model knowledge comes from the provenance-aware E2A assessment, never a provider
boolean or model-name regex. Unknown/unsupported vision emits
`AI_MODEL_CAPABILITY_UNKNOWN`/`AI_MODEL_VISION_UNSUPPORTED`. Required transport
dimensions independently emit `AI_TRANSPORT_CAPABILITY_UNKNOWN` or
`AI_TRANSPORT_MEDIA_UNSUPPORTED`.

Source counts are calculated from actual package parts. Data URLs and serialized
inline sources count as inline; remote URLs count as remote sources. The frozen
`planWireMediaDelivery` determines actual wire requirements. Only known remote
URL acceptance retains remote wire URLs. Anthropic/Gemini remote sources are
acquired as inline data; OpenAI canonical remote sources remain remote URLs.
Capabilities are checked before acquisition, then checked again against prepared
parts (including screenshot fallback) before dispatch.

`prepareQuestionPackageForProvider` accepts a wire plan, not `ProviderConfig`.
It retains count/single/total limits, MIME validation, revision-bound screenshot
fallback, abort handling, and credential-free remote acquisition
(`credentials: "omit"`). Manual `imageDataUrl` visual requests are converted to
the same media package and use the same capability/preparation boundary.

## Attempt lifetime and fences

Each network attempt resolves `resolveRuntimeCredential(runtime)` from the exact
fenced encrypted record. Credentials are never loaded into ordinary Settings,
React state, background responses, or an application cache. The attempt context
is cleared in `finally`; retry backoff retains only non-secret original metadata
and a sanitized error. Retries never silently rebind that snapshot.

Adapters finish all asynchronous body preparation before the final fence:

1. Initialize authority and resolve metadata.
2. Validate endpoint/auth and plan route/source/wire requirements.
3. Enforce model/transport capability and prepare media.
4. Resolve the exact attempt credential.
5. Construct request body, URL, headers, redirect policy, and combined signal.
6. `await beforeDispatch()` checks runtime currentness and question revision.
7. Immediately execute `fetch`, without another unrelated await.

Every retry repeats credential resolution and this final fence. Credential,
active-connection, and connection-revision changes fail closed; no-auth is also
fenced. Malformed/semantic/config/capability/endpoint errors do not trigger
request retries or tier fallback. Question abort/currentness and late-result
discard remain in place. Only successful real provider execution gets
`resultSource: "provider"`. Demo output still needs explicit `allowDemo` and
never dispatches a provider request and never rescues malformed authority. Missing credentials may select explicit demo before endpoint validation; this does not establish endpoint security.

An already dispatched question request cancelled as stale retains the existing
`provider_result_discarded_stale` diagnostic, marked as cancelled, without any
success/history/fill authority. This also covers transport cancellation before
the adapter can construct a ParseResult.

## Secret handling and connection test

Fetch diagnostics contain only sanitized origin/path labels, with no query or
userinfo. Credential echoes (literal, URI, or form encoding) are redacted from
fetch errors, bounded provider error bodies, returned text, streaming callbacks,
and normalized attempt errors. Malformed JSON/SSE diagnostics omit raw response
material. Error bodies are bounded at 8192 bytes. Request timeout remains 30
seconds; external abort is combined with the timeout signal.

Connection Test first saves the current draft through `saveSettings` and the
existing background commit. Blank visible keys keep the current provider's
stored credential. After non-secret readiness it performs a real authoritative
text request. A provider switch commits B before testing B; missing credentials
produce safe feedback without fetch. React never receives stored plaintext.
Connection testing does not create answer/history/candidate/fill authority and
does not orchestrate persisted `ValidationRecord` transitions.

The temporary `legacyRuntimeSettingsCompat.ts` is deleted. A static contract test
enforces zero production references and no AI field reads in parser/clients/route
planning. Old scenario tests explicitly seed encrypted connection authority;
separate forged-settings tests call the real parser without any fixture adapter.

Real extension vision fixtures now seed canonical OpenAI configuration instead
of assuming a Custom model-name string proves vision capability. A browser route
registered before per-test held-response handlers forwards canonical requests
to the same local fixture servers and returns SSE when requested. Existing
question-revision, history, fill, workspace, and UI04 assertions are unchanged;
route handlers are removed safely before request-context teardown.

## Deferred and frozen scope

Physical inert legacy AppSettings/type cleanup and mutation sender hardening
remain E2B2B. Existing background payload validation and writer RPC are unchanged.
Frontend changes are data plumbing only. Settings styling/layout, UI04 candidate
ownership, fill/result provenance, permissions, and autosubmit policy are frozen.

Validation includes actual storage/revision races, protocol/auth/endpoint cases,
wire media assertions, real Settings Save-and-Test, static closure checks, full
check/build/artifact gates, real extension E2E, and exact-head push/PR CI. Exact
counts and SHA evidence belong in `UI05R_E2B2A_REPORT` after the final gates.


## RF01 retry ownership

**ONE LOGICAL SOLVE RETRY CHAIN = ONE NON-SECRET AI RUNTIME AUTHORITY LEASE**

The first parse binds a validated runtime snapshot before media preparation or credential resolution. Subsequent parses fence that original snapshot before reading current metadata and again after reading it. Route and timing strategy may change; provider, model, endpoint, protocol, auth and credential authority cannot silently rebind. The opaque lease holds no plaintext; the parser retains its non-secret snapshot in a WeakMap. Each dispatch resolves the exact credential anew and retains the final pre-fetch currentness fence.

| Path | Classification | Lease boundary |
| --- | --- | --- |
| Streaming to ordinary fallback | SAME_LOGICAL_SOLVE | Both attempts share the lease |
| Text/vision/auto route tiers | SAME_LOGICAL_SOLVE | All tiers and fallbacks share the lease |
| Batch error/incomplete/automatic vision retry | SAME_LOGICAL_SOLVE | One lease per candidate in a batch invocation |
| Explicit vision retry / risky retry | NEW_LOGICAL_SOLVE | One fresh lease per candidate; its incomplete-result review shares it |
| Manual capture automatic vision retry and second review | SAME_LOGICAL_SOLVE | One lease for the entire capture pipeline, including error recovery |
| Auto Solve automatic vision retry | SAME_LOGICAL_SOLVE | Shares initial parse lease |
| Auto Solve review | NEW_LOGICAL_SOLVE | New review invocation; its own vision retry shares that lease |
| Auto Solve quick review | NEW_LOGICAL_SOLVE | New quick review invocation |

Each timeout-managed parse owns a child AbortController composed with the parent signal. The timeout wrapper revokes the child in its finally block before returning rejection to a fallback caller. Streaming callbacks check attempt ownership. Parser result and success telemetry checks reject aborted attempts. Auto Solve outer timeouts also cancel their nested tier chain. Manual pipeline timeout cancels the shared pipeline controller before any recovery; runtime-current checks and the parser question fence retain route-disposal authority. Timed-out results cannot reach history or fill through the owning rejected promise.
