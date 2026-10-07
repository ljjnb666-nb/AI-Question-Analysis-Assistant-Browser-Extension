# Phase 13 — Real-Site Compatibility Acceptance

Phase 13 separates **live-site evidence** from the deterministic offline compatibility corpus. A sanitized or platform-derived fixture is valuable regression evidence, but it is not authority to claim that the current production extension works on a live platform page.

## Authority levels

| Authority | Meaning |
| --- | --- |
| `LIVE_PUBLIC_READONLY_PASS` | A real public page was opened in real Chrome with the exact built extension artifact. Production detection ran and the recorded page-owned state remained unchanged. |
| `OFFLINE_REAL_PLATFORM_DERIVED_ONLY` | Deterministic sanitized fixture coverage exists, but no current live-page result is claimed. |
| `AUTH_REQUIRED_NOT_RUN` | The relevant product surface requires a legitimate authenticated/course session that CI does not possess. No login bypass, borrowed credential, or synthetic session may be used to upgrade this status. |
| `NO_STABLE_PUBLIC_TARGET` | No stable public page has been frozen as a live acceptance target. Offline coverage does not upgrade this status. |

Live acceptance is **read-only by default**. It proves detection/identity on the real page; it does not silently upgrade answer-fill support.

## Phase 13A — public live-site gate

The CI job `real_site_acceptance` loads the verified production extension artifact in Chrome for Testing and visits this public Pintia problem page:

`https://pintia.cn/problem-sets/434/exam/problems/type/6?page=0&problemSetProblemId=6182`

The page title observed by the gate is `习题5.10 线性探测法的查找函数 - 浙大版《数据结构（第2版）》题目集`.

The gate injects the production content runtime and sends the production `START_AUTO_DETECT` message. It then reads the production candidate-workspace snapshot. It does **not** configure an AI provider, request a solve, send `FILL_PARSED_ANSWER`, click an answer, advance the page, or submit anything.

Required result:

- live main document is reachable and remains on `pintia.cn`;
- viewport detection reaches `completed`;
- at least one production candidate exists and the target problem is recognized;
- the live candidate has runtime identity evidence;
- no page `click`, `input`, `change`, or `submit` event is observed;
- page-owned input/textarea/select state is unchanged;
- the URL remains unchanged;
- `automaticSubmissionObserved=false`;
- `answerFillAttempted=false`.

The evidence artifact is `phase13-live-site-evidence-<sourceSha>`. It stores candidate preview **lengths and SHA-256 hashes**, not the full problem statement.

## Current compatibility authority

| Platform/surface | Authority | What is proven |
| --- | --- | --- |
| Pintia public programming problem | `LIVE_PUBLIC_READONLY_PASS` | Production runtime detects the live public problem in real Chrome without mutating page-owned controls or submitting. |
| Pintia judge / single-choice question list | `OFFLINE_REAL_PLATFORM_DERIVED_ONLY` | COMPAT-08 proves sanitized detector/control/fill behavior; no stable public live question-list target is frozen here. |
| Zhihuishu / Polymas coursework and exam surfaces | `AUTH_REQUIRED_NOT_RUN` / `NO_STABLE_PUBLIC_TARGET` | Existing sanitized site-specialized fixtures remain regression evidence only. CI does not bypass authentication or fabricate a live-session claim. |
| Generic SPA / iframe / open-shadow / virtualization cases | deterministic E2E / offline corpus | Strong controlled-browser coverage exists, but this is not a named external-platform live claim. |
| Cross-origin iframe DOM | `KNOWN_ARCHITECTURE_LIMITATION` | No coordinated per-frame runtime yet. |
| Closed shadow roots | `UNSUPPORTED_BY_BROWSER_SECURITY` | Not traversable by the page-facing DOM runtime. |

## Phase 13B — authenticated-site acceptance

A login-gated platform may be promoted only from a **legitimate user-authorized session**. Phase 13B must not:

- bypass authentication, CAPTCHA, access control, or anti-bot controls;
- use fabricated/borrowed credentials;
- persist cookies, tokens, student identifiers, or private question text into repository evidence;
- auto-submit work.

A valid authenticated acceptance record should identify only the platform/surface, extension/source identity, sanitized structural outcomes, state hashes/counts, and the explicit no-submit result. Until such a session is supplied and exercised, those rows remain `AUTH_REQUIRED_NOT_RUN`.

## Frozen Phase 13 invariants

- **LIVE_SITE_CLAIMS_REQUIRE_LIVE_BROWSER_EVIDENCE** — offline fixtures cannot be promoted into live-platform claims.
- **LIVE_SITE_ACCEPTANCE_IS_READ_ONLY_BY_DEFAULT** — public live-site CI detects and inspects but does not solve/fill/submit.
- **LIVE_DETECTION_MUST_NOT_MUTATE_PAGE_CONTROLS** — page-owned control state must remain unchanged during the live detection gate.
- **LIVE_SITE_EVIDENCE_STORES_HASHES_NOT_FULL_PROBLEM_CONTENT** — evidence minimizes copied third-party content.
- **AUTH_GATED_SITES_ARE_NOT_CI_BYPASSED** — lack of an authorized authenticated session remains an explicit NOT RUN.
- **RC_BUNDLE_REQUIRES_REAL_SITE_ACCEPTANCE** — candidate assembly waits for `real_site_acceptance`.
- **NO_AUTOMATIC_SUBMISSION** — submission remains user-controlled on every site.

## Completion rule

Phase 13A is complete only after the exact merge-SHA main CI passes with `real_site_acceptance` and `rc_bundle` green and the main live-site evidence artifact is re-inspected.

Phase 13 as a whole must not be described as universal site compatibility. Auth-gated surfaces remain separately scoped Phase 13B evidence work unless explicitly accepted as documented NOT RUN limitations for the release.
