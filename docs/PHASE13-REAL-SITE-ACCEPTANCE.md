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

## Phase 13B local authorized-session harness (separate from CI)

A **local, opt-in and interactive** checker is available for legitimate account holders; this does not grant CI an authenticated identity. The helper is designed for Windows 11 / Chrome with the repository checked out cleanly.

From PowerShell, in the repository directory:

```powershell
npm ci
npm run accept:phase13b:local -- --site zhihuishu --url "https://online.zhihuishu.com/" --consent-readonly
```

For Pintia use `--site pintia` and a user-authorized `https://pintia.cn/` URL. Polymas uses `--site polymas`; its actual platform host is **user-attested, not independently certified** and must be checked before supplying the URL.

The helper enforces a clean Git HEAD, builds and verifies the extension locally, launches a **new temporary Chrome user-data directory**, and opens the supplied site. The account holder signs in **manually** in that same tab (including normal challenges, if required) and navigates to the appropriate question page. Only when they type `AUTHORIZED` in the terminal does the helper begin read-only detection.

Important boundaries:

- Use **your own legitimately authorized account** and a page on which you have permission to run a browser extension. Respect site rules and institutional requirements.
- Do not send your passwords, tokens, cookies, screenshots of personal records, or the authenticated browser profile to the project or to GitHub.
- The utility never captures login text, exports cookies, records a browser trace, screenshots, or video, or persists the temporary Chrome profile after a normal exit.
- Its only production message is `START_AUTO_DETECT`, followed by read-only `GET_CANDIDATE_WORKSPACE_SNAPSHOT`; it does not ask AI for answers or call any fill/submit route.
- After the user's confirmation it blocks observed page POST/PUT/PATCH/DELETE requests, monitors click/input/change/submit events, and checks that route/origin, page controls and forms remain unchanged. It fails closed when the detection does not complete or the expected tab is not authoritative. Other browser contexts and service-worker-initiated network writes are not a blanket guarantee.
- Page-owned input values are HMAC-digested inside Chrome with a fresh ephemeral key; the key and raw values are not saved.
- Only structural counts, classification, source SHA, extension tree digest, and explicit test limitations appear in the local JSON. The full URL, questions, credentials, candidate IDs, student identifiers, and HMAC key are excluded.
- The JSON is stored under the gitignored `test-results/phase13b-local/`, mode `0600` where the filesystem supports it. Do not upload it unreviewed.
- On failure the terminal prints a fixed diagnostic code only. An unexpected shutdown can leave temporary Chrome data behind; clean up orphaned `quiz-solver-13b-*` temp directories only after confirming they are not in use.

Result interpretation:

| Evidence | Authority |
| --- | --- |
| Contract tests green in CI | `AUTH_HARNESS_CONTRACT_PASS` — the harness's negative and privacy contracts passed; **not** live auth acceptance |
| Local checker returns `LOCAL_READONLY_PASS` with deliberate user authorization | `LOCAL_USER_ATTESTED_AUTH_READONLY` — one local, user-attested site/surface; **not** independently verified login status |
| No local human session/evidence | `AUTH_REQUIRED_NOT_RUN` — no real authenticated compatibility claim |
| Local checker fails | `LOCAL_READONLY_FAIL` — do not promote that platform or surface |

**Completion boundary:** Phase 13B cannot be promoted to universal or independently authenticated compatibility by CI alone. A legitimate site/session acceptance record must be examined separately, without publishing user records or raw content. Answer filling remains NOT TESTED even when this read-only harness passes.

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
