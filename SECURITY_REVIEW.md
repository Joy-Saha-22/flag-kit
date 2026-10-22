# Security Review

Scope: `server/`, `client/`, `sdk/`, `packages/evaluator/`, `Dockerfile`, and `.dockerignore`.

## Findings

| Area | Finding | Severity | Location | Status | Recommendation |
|---|---|---:|---|---|---|
| Client redirect | The login `next` value previously allowed `/\host` to be normalized into an external URL. The handler now rejects backslashes/network paths and permits only same-origin destinations; regression tests cover both external forms and a valid internal redirect. | medium | `client/src/routes.jsx`, `client/tests/route-guard.test.jsx` | fixed | Keep same-origin redirect regression coverage. |
| Client build secret scan | A configured `VITE_DEMO_CLIENT_SDK_KEY` in the ignored local environment file was present in the first production build. No value is included in this report. If this is an active credential, it must be rotated; client SDK keys are public by design and must not be treated as secrets. The bundle was removed and rebuilt with a nonfunctional placeholder; the requested markers were absent from the resulting `client/dist`. | medium | `client/.env.local:1` | not fixed | Rotate the key if active. Never provide a server key through a `VITE_` variable. |
| SDK telemetry integrity | A holder of a client SDK key can submit synthetic experiment exposure/conversion events for arbitrary user keys. Schema and flag/variation matching constrain event shape but cannot prove that the activity occurred; accepted events influence experiment results. | medium | `server/src/routes/sdk.js` (`POST /events`); `server/src/sdk/mongoSdkStore.js` | not fixed | Treat client telemetry as untrusted; use a trusted server-side ingestion path if results drive consequential decisions. |
| Redis key privacy | Auth email, failure-count, and backoff Redis keys previously contained raw emails/scopes. These identifiers are now SHA-256 hashed before key construction; tests assert that email values are absent. | low | `server/src/lib/redisKeys.js`, `server/tests/redisKeys.test.js` | fixed | Continue using hashed identifiers for sensitive Redis key components. |
| Redis error logging | The Redis client's own error listener previously logged the raw driver error message, which could contain a connection URL. It now logs `serializeError` output, which redacts connection strings; a regression test verifies this. | medium | `server/src/db/redis.js`, `server/tests/redis.test.js` | fixed | Preserve redaction for infrastructure error logs. |
| Stream unsubscribe logging | Stream hub unsubscribe failures previously logged the raw error message. They now use `serializeError`; a regression test checks that connection URLs are redacted. | low | `server/src/sdk/streamHub.js`, `server/tests/streamHub.test.js` | fixed | Keep all infrastructure error messages on the redacting serializer path. |
| Seed command credential output | The seed command intentionally writes generated SDK keys to stdout once so an operator can configure clients. Captured terminal/CI output could persist these keys; this is credential delivery rather than an application logger event. The seed failure path now redacts connection strings. | medium | `server/src/scripts/seed.js:238-251` | not fixed | Run seeding only where stdout is access-controlled and not retained in CI/build logs; consider a dedicated secret-delivery mechanism. |
| Login throttling | The failed-login backoff is scoped by normalized email and client IP, capped, and expires; it does not permanently lock the account. Separately, the intentional per-email auth rate limit applies across IPs to both login and registration, so an attacker can temporarily consume the victim email's email-tier allowance. | low | `server/src/middleware/rateLimit.js` | not fixed | Keep backoff scoped to email plus IP; consider whether the per-email tier's temporary cross-IP throttling is acceptable for the product. |
| Login timing | The dummy bcrypt hash is initialized once when the auth router is created, and login requests wait for initialization before proceeding. Unknown-email and wrong-password attempts both perform bcrypt verification at the configured cost and return the same 401 response shape. Regression tests cover initialization count, verification count/cost, and failure responses. | low | `server/src/routes/auth.js`, `server/tests/auth.test.js` | fixed | Keep the startup initialization gate and regression coverage. |
| CSRF method coverage | The custom-header middleware exempts `GET`, `HEAD`, and `OPTIONS`, so the literal rule “every non-GET `/api` request” is not met. `HEAD` remains read-only and `OPTIONS` is used for CORS preflight; state-changing `POST`, `PUT`, and `DELETE` requests require the header. | low | `server/src/middleware/requireCustomHeader.js` | not fixed | Keep the exemption if it is intentional, and describe the policy as applying to state-changing methods; otherwise require the header on `HEAD` too. |
| Session revocation | Logout clears the browser cookie but does not revoke a copied JWT; a stolen token remains usable until expiry (default eight hours, configurable up to 30 days). | low | `server/src/routes/auth.js`, `server/src/auth/cookies.js`, `server/src/env.js` | not fixed | Use a server-side revocation/version mechanism if immediate token invalidation is a requirement. |
| SDK-key revocation | SDK authorization now checks the source-of-truth store on every request instead of trusting positive Redis cache entries. Open streams now fail closed and end when an activity check fails. This trades Redis-backed auth caching for immediate revocation correctness. | medium | `server/src/sdk/auth.js`, `server/src/routes/sdk.js`, `server/tests/sdk.test.js` | fixed | Preserve source-of-truth checks and fail-closed stream behavior; monitor database load. |
| Dependency audit | `npm audit` reports 10 vulnerable package entries: 5 high and 5 moderate. They are all in development dependencies, not production dependencies. `npm audit fix --dry-run --json` proposed zero changes, and Tailwind CSS 3.4 has no later compatible release in the registry; no dependency updates were applied. | high | `client/package.json`, `server/package.json`, `package-lock.json` | not fixed | Plan a Tailwind CSS 4 migration and an autocannon replacement/upgrade, then rerun tests/build and audit. |
| Docker build context | `.dockerignore` excludes `server/tests` but not all test directories as requested. The Dockerfile currently copies only server/evaluator runtime source, so those other test files are not copied into the image; they can still be sent in the build context. | low | `.dockerignore`, `Dockerfile` | not fixed | Add test-directory exclusions if minimizing build-context transfer is required. |
| Request schema strictness | Body, query, and path values are now checked on every `/api` and `/sdk` route that accepts a request, using the route schema plus strict empty-object schemas for unused parts. Project IDs are schema-checked by `loadProject` and malformed/nonmember/unknown projects still map to 404. Flag/environment/SDK-key path schemas reject unknown object fields. Regression tests cover unexpected query/path fields. | low | `server/src/middleware/validate.js`, `server/src/projects/schemas.js`, `server/src/flags/schemas.js`, `server/src/middleware/project.js`, route tests | fixed | Keep validation on new routes and test unknown fields/operators. |
| Proxy trust configuration | `TRUST_PROXY` permits a configurable hop count up to 10. `req.ip` honors that setting; with an incorrect production proxy-hop configuration, forwarded client IPs may be spoofed and IP limits bypassed. Tests confirm X-Forwarded-For is ignored with trust proxy disabled and honored when one hop is trusted. | medium | `server/src/app.js`, `server/src/env.js`, `server/src/middleware/rateLimit.js`, `server/tests/rateLimit.test.js` | not fixed | Set `TRUST_PROXY` to the actual trusted proxy topology and ensure the edge proxy overwrites forwarded headers. |
| Runtime/deployment | Dockerfile properties were inspected, but an actual container build/runtime healthcheck and deployed TLS, proxy, Redis-outage, and CORS behavior were not exercised. | low | `Dockerfile`, `docker-compose.yml`, deployment configuration | not fixed | Validate the image and deployment topology in CI/staging. |

## Dependency audit details

`npm audit --json` reported 10 vulnerable package entries, all development-only:

| Package | Severity | Dependency path/type | Production dependency? | Safe automatic fix |
|---|---|---|---|---|
| `tailwindcss` | high | Direct client dev dependency | no | Major upgrade to 4.3.3 |
| `braces` | high | Transitive via Tailwind CSS/chokidar/micromatch | no | Requires Tailwind CSS major upgrade |
| `chokidar` | high | Transitive via Tailwind CSS | no | Requires Tailwind CSS major upgrade |
| `micromatch` | high | Transitive via Tailwind CSS/fast-glob | no | Requires Tailwind CSS major upgrade |
| `fast-glob` | high | Transitive via micromatch | no | `npm audit fix --dry-run` proposed no changes |
| `postcss-selector-parser` | moderate | Transitive via Tailwind CSS/postcss-nested | no | Audit's available resolution requires Tailwind CSS major upgrade |
| `postcss-nested` | moderate | Transitive via Tailwind CSS | no | Audit's available resolution requires Tailwind CSS major upgrade |
| `autocannon` | moderate | Direct server dev dependency | no | Audit suggests autocannon 2.0.1, a major-version change |
| `hyperid` | moderate | Transitive via autocannon | no | Requires autocannon change |
| `uuid` | moderate | Transitive via hyperid | no | Requires autocannon change |

No production dependency vulnerabilities were reported. The audit totals were 5 high, 5 moderate, 0 low, and 0 critical.

## Rate limiting

- **Tier wiring:** The public IP tier applies to `/healthz` and, after the rate-limit wiring update, every `/api` request. Auth IP and per-email tiers apply to both login and registration (email limiting follows body validation). Dashboard per-user limits cover project list/create and project-scoped routes. The SDK IP limiter runs at the top of the `/sdk/v1` router before key authentication; the per-key tier runs after successful SDK-key authentication on flags, streams, and events.
- **IP derivation and proxy trust:** The limiter uses Express `req.ip` with socket remote address as fallback; it does not parse `X-Forwarded-For` itself. With `TRUST_PROXY=0` (default), Express ignores forwarded headers. `TRUST_PROXY` is configurable from 0 through 10; when positive, Express honors proxy headers according to that hop count, so a directly reachable app or misconfigured proxy can allow forged client addresses. Production must restrict direct access and configure the actual trusted proxy topology. IPv4-mapped IPv6 is normalized to IPv4; IPv6 rate limits group addresses by `/64`.
- **Atomicity and expiry:** Fixed-window limit increments and TTL setup use one Redis Lua script. The failed-login failure counter now uses a separate Lua script that atomically increments and refreshes its quiet-period expiry; the backoff marker is written with a PX TTL. These rate keys expire.
- **Redis key privacy:** Email identifiers/scopes are SHA-256 hashed before use in auth email/failure/backoff key names. SDK rate-limit keys use the SDK key's SHA-256 hash (`req.sdk.keyHash`), not the raw credential. IP and user identifiers remain in their respective key names.
- **Redis outage behavior:** Fixed-window and backoff operations fail open and emit a `rate_limit_failed` warning. The warning serializes the error through URI redaction; the Redis client's direct error listener also uses redacted serialization. A regression test verifies an unavailable-Redis request proceeds and the warning contains no URI.
- **Victim lockout distinction:** Failed-login exponential backoff is keyed by normalized email plus client IP, is capped, and expires, so this backoff cannot be triggered across IPs to lock the victim out. Separately, the per-email login/register rate tier is shared across IPs and can temporarily throttle that email; this is listed as a distinct low-severity availability risk above.
- **Verification:** `server/tests/rateLimit.test.js` covers public `/api` tier wiring, auth IP/email thresholds, dashboard-user, SDK-IP and SDK-key thresholds, SDK-key hash-only key naming, fail-open/redacted warnings, IPv6 `/64` grouping, and forwarded-IP behavior for trusted/untrusted proxy settings. Failed-login counter expiry is tested using the in-memory Redis adapter.

## Input validation and resource caps

- Every route under `/api` and `/sdk` validates its body, query, and params: route-specific Zod schemas validate used inputs, while `validate()` now applies strict empty-object schemas to request parts a route does not use. The project-scope middleware strictly validates `pid` before membership lookup and preserves the generic 404 for malformed IDs/nonmembers/unknown projects.
- Request object schemas are strict, so unknown body/query/path object fields are rejected rather than silently passed to handlers. Authentication, project, flag, environment config, SDK key, audit, results-query, and SDK-event schemas reject operator-shaped objects or constrain values to strings, finite numbers, booleans, enums, and explicitly validated nested shapes. `{"$ne":null}` cannot enter Mongo filters through these validated inputs. Flag search escapes regex metacharacters before constructing a regex.
- JSON bodies have a default 100kb parser limit (`JSON_BODY_LIMIT` is configurable). SDK events also have a serialized body-byte cap, and batch size is bounded. Flag count, variations, rule count, conditions per rule, values per condition, names/strings, search lengths, userContext bytes/key lengths/nesting, project and SDK key counts, and SSE connections have configured bounds.
- Tests verify request schema rejection of unknown fields/operator-shaped inputs, and route behavior for unknown query/path fields. Relevant size-cap and injection tests are in `server/tests/auth.test.js`, `projects.test.js`, `flags.test.js`, `sdk.test.js`, and `rateLimit.test.js`.

## Errors and logging

- The central error handler returns stable public messages and request IDs. Unexpected exceptions are generic 500s; validation/cast errors, duplicate-key errors, malformed JSON (400), and oversized JSON bodies (413) are mapped to controlled responses. Existing tests exercise forced store exceptions, malformed JSON, oversized requests, invalid project IDs, and unknown routes; response assertions exclude stack/path/database details.
- Server-side error diagnostics include serialized stack/message, but `serializeError` redacts MongoDB/Redis connection URLs and now also masks SDK-key-shaped values, JWTs, Authorization/Cookie headers, session-cookie values, and explicit password assignments. Redis client and stream-unsubscribe logs use this serializer. Tests cover connection-string redaction and fake credential-shaped log text.
- No HTTP middleware logs request bodies, headers, cookies, passwords, JWTs, or SDK Authorization values. Request error logging records only the path (not query string), method, status, request ID, and serialized exception. Raw credentials are not echoed in API error responses.
- **Exception:** `server/src/scripts/seed.js` deliberately prints newly generated SDK keys to stdout once for operator setup. This is not emitted through the app logger, but stdout may be retained by terminals or CI. Use the seed command only with protected output; this report does not include any key value.
- Forced exceptions may still yield diagnostic server-side stack traces and source paths after redaction; these are not sent to clients. Verify production log access and retention controls operationally.

## SDK API, client, Docker, and denial-of-service checks

### SDK API

- SDK keys are generated from 32 cryptographically random bytes, stored as SHA-256 hashes, and have a 16-character display prefix. The raw key is returned once at creation with `Cache-Control: no-store`; the store record and audit log include only the hash/prefix/type.
- SDK key authentication reads only the `Authorization` header (optionally with `Bearer`); URL query parameters are not read. Current auth checks the source-of-truth store on each request, so a revoked key is rejected by the next request. An open SSE stream checks activity on heartbeat and ends when the key is revoked or the check fails.
- SSE limits are per key per server process, not globally coordinated across instances. Slow-client write backlog is capped at 1,000,000 bytes. An SDK client may open up to the configured per-key limit on each application instance.
- SDK event bodies are schema-validated, require a batch of 1 through `MAX_EVENTS_PER_BATCH`, and have a separate serialized-body cap `SDK_EVENTS_MAX_BYTES`; the global JSON parser limit also applies. Matching to current experiment flags, variations, and metrics filters events but cannot prove client telemetry authenticity (see finding).
- `/sdk` CORS is `*` with no `credentials: true`; allowed headers include Authorization. `/api` CORS reflects only configured origins, permits credentials, and exposes only the declared headers. These are code-level settings; deployed proxy/header behavior was not exercised.

### Client

- Searches of `client/src` and client JS source found no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `localStorage`, or `sessionStorage` use. No `target="_blank"` external-link use was found; there are no identified external-link cases requiring `rel="noopener noreferrer"`.
- The login redirect accepts only a string with one leading slash, rejects `//` and backslashes, resolves it against the request origin, and only redirects when the resolved origin matches. It retains same-origin pathname, query, and fragment.
- Audit before/after JSON, flag names, and error messages are rendered as React text/`<pre>` content, not HTML sinks. The production client build was scanned for `fk_server_`, `fk_client_`, `mongodb`, `redis://`, and `JWT_SECRET`; the final placeholder build had zero matches for all five.

### Docker and build context

- Dockerfile sets `NODE_ENV=production`, uses the non-root `node` account, copies only package manifests and runtime `server/src`/`packages/evaluator/src`, and does not copy an `.env` file or runtime secrets. `.dockerignore` excludes `.env` and `.env.*` (with a root `.env.example` exception), dependencies, build outputs, and `server/tests`; it does **not** exclude client, SDK, or evaluator test directories from the build context, though Dockerfile does not copy them into the image.
- The healthcheck runs Node's built-in `fetch` against localhost `/healthz`; Node 22 provides `fetch`, and the server defines `/healthz`. The Docker CLI is unavailable in this environment, so an actual image build or running healthcheck could not be verified.

### Resource limits and denial of service

- The default JSON body cap is 100kb (configurable). SDK events have both an additional byte cap and a batch-count cap. Flag/project/key counts, variations, rules, conditions, condition values, string lengths, userContext bytes/key lengths/nesting, audit/result pagination, and SSE connections/backlog are bounded.
- Relevant user-controlled regex construction is limited to flag search, which escapes regex metacharacters and caps search length at 100 characters. Schema regexes are anchored, bounded character classes/enums. I found no catastrophic-backtracking expression or obvious user-controlled unbounded loop in the reviewed request paths.
- The client-supplied SDK telemetry path still permits fabricated valid-shaped events; this is an integrity concern rather than an unbounded-work issue.

## `/api` and `/sdk` route authorization inventory

All mutating `/api` requests require `X-Requested-By: flagkit-dashboard`. The header is a CSRF/custom-request barrier, not an authentication credential. Dashboard CORS is restricted to configured origins and allows credentials. `GET`, `HEAD`, and `OPTIONS` are exempt from the custom-header requirement.

| Route | Required access / enforcement |
|---|---|
| `GET /healthz` | Public; public IP rate limit. |
| `POST /api/auth/register` | Public; custom header, auth IP and per-email limits, strict registration body validation. |
| `POST /api/auth/login` | Public; custom header, auth IP and per-email limits, email+IP failed-login backoff, strict login body validation. |
| `POST /api/auth/logout` | Public; custom header; clears session cookie. |
| `GET /api/auth/me` | Valid session; per-user dashboard limit. |
| `GET /api/projects` | Valid session; per-user limit; only projects belonging to the user are listed. |
| `POST /api/projects` | Valid session; per-user limit; validated body; creator is project admin. |
| `GET /api/projects/:pid/environments` | Valid session, project membership, viewer or higher. |
| `GET /api/projects/:pid/environments/:envKey/sdk-keys` | Valid session, project membership, editor or higher. |
| `POST /api/projects/:pid/environments/:envKey/sdk-keys` | Valid session, project membership, admin. |
| `DELETE /api/projects/:pid/environments/:envKey/sdk-keys/:keyId` | Valid session, project membership, admin. |
| `GET /api/projects/:pid/flags` | Valid session, project membership, viewer or higher. |
| `POST /api/projects/:pid/flags` | Valid session, project membership, editor or higher. |
| `GET /api/projects/:pid/flags/:key` | Valid session, project membership, viewer or higher. |
| `GET /api/projects/:pid/flags/:key/results` | Valid session, project membership, viewer or higher. |
| `PUT /api/projects/:pid/flags/:key` | Valid session, project membership, editor or higher. |
| `DELETE /api/projects/:pid/flags/:key` | Valid session, project membership, admin. |
| `PUT /api/projects/:pid/flags/:key/environments/:envKey` | Valid session, project membership, editor or higher. |
| `POST /api/projects/:pid/flags/:key/environments/:envKey/evaluate-test` | Valid session, project membership, viewer or higher. |
| `GET /api/projects/:pid/audit` | Valid session, project membership, editor or higher. |
| `GET /sdk/v1/flags` | Valid SDK key in `Authorization`; SDK IP and per-key rate limits. |
| `GET /sdk/v1/stream` | Valid SDK key in `Authorization`; SDK IP and per-key limits; per-key stream cap. |
| `POST /sdk/v1/events` | Valid SDK key in `Authorization`; SDK IP and per-key limits; body-byte and strict batch validation. |

Project-scoped routes pass through session auth, per-user limiting, then `loadProject`, which only loads a project for a member and sets the member role. No cross-project IDOR was identified in the reviewed route/store paths; for authenticated users, a non-member project lookup uses the same generic 404 path as an unknown project (requests without a valid session are rejected earlier with 401). SDK keys resolve to their environment/project scope, and authorization checks the source-of-truth store on each request.

## What was verified as correct

- `.env` and `.env.*` are ignored except `.env.example`; `git ls-files` showed only the two example environment files tracked and no other unignored environment files. The examples use placeholders, not live credentials. The local client environment file is ignored/untracked.
- The client production build was scanned for `fk_server_`, `fk_client_`, `mongodb`, `redis://`, and `JWT_SECRET`; all five markers had zero matches in the final build made with a nonfunctional example placeholder.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. JWT signing and verification pin HS256 and issuer. Registration requires a 12-character password minimum; login and registration reject passwords over bcrypt's 72-byte limit. Bcrypt cost is configurable (4–15, default 12).
- Login returns the same 401 status, code, and message for unknown emails and wrong passwords. The dummy hash starts initializing once when the auth router is created; login requests wait for the shared initialization promise. Both paths verify a password with bcrypt at the configured cost. Both failures enter the email+IP backoff path; the same per-email rate-limit tier also applies before credential verification.
- Cookie flags are set in `server/src/auth/cookies.js`; JWT algorithm restrictions are explicit in `server/src/auth/tokens.js`; the custom-header middleware is wired before API routers in `server/src/app.js`. `X-Requested-By` is required for state-changing methods, with `GET`, `HEAD`, and CORS `OPTIONS` exempt. Password schemas are strict, enforce a 12-character registration minimum, and cap both login and registration at 72 UTF-8 bytes; `BCRYPT_COST` is configurable between 4 and 15, default 12.
- Fixed-window rate-limit increments and expiry are performed atomically in Redis Lua; failed-login counter expiry is a separate operation and is noted above. Redis outages fail open with a warning; warning serialization redacts connection URLs. Client IP is derived from Express `req.ip`/socket address, not by directly trusting an arbitrary header; IPv6 addresses are grouped by `/64`.
- SDK keys are generated with cryptographic randomness, persisted as SHA-256 hashes, shown once on creation, and accepted only from the Authorization header. SSE connections are capped per key and slow-client buffering is bounded. SDK CORS allows any origin without credentials; API CORS only permits configured origins with credentials. SDK key authorization rechecks the source-of-truth store; open streams close when the check reports a revoked key or fails.
- Body limits, SDK event bytes/batch counts, rule/condition/value counts, user-context byte/depth limits, and per-key stream limits are configured. Flag list searches regex-escape user input. No catastrophic-backtracking regex or obvious unbounded user-controlled loop was identified.
- Error handling returns generic internal errors and request IDs; parser, oversized-body, validation, cast, and duplicate-key errors are mapped to controlled responses. Connection strings and common credential formats are redacted from serialized errors. Client audit before/after data, flag names, and error messages are rendered as text; no `dangerouslySetInnerHTML`, `innerHTML`, or `eval` was found. No browser storage use for tokens/SDK keys or external-link `target` usage was found.
- The Dockerfile sets `NODE_ENV=production`, uses the non-root `node` user, uses `npm ci`, copies only runtime source, and defines a Node-based `/healthz` healthcheck. It does not copy `.env` files.
- `packages/evaluator/` uses deterministic evaluation helpers and has no server-side authorization or secret-handling surface in scope.

## Not verified / limits

- A credential's live validity and intended audience cannot be determined from this review. Only its file and line are identified above; no value is recorded.
- The first build used the local configured demo key. Its generated JavaScript was removed after confirmation; the final successful build and marker scan used a nonfunctional placeholder.
- No Docker image build or live healthcheck was run. Production TLS termination, actual proxy-hop settings, deployed CORS origins, Redis outage behavior under real infrastructure, and image provenance were not independently tested.
- Full equivalence of login timing cannot be guaranteed from static review; the unknown-user path performs dummy bcrypt work, but datastore/network timing can still differ.
- SDK event authenticity cannot be established from client-submitted telemetry; this is reported above.
- Dependency audit is limited to the current lockfile and npm advisory database at the time of execution.

## Validation performed

- `npm audit --json` — completed; reported 10 development-only vulnerable package entries (5 high, 5 moderate).
- `npm audit fix --dry-run --json` — proposed zero dependency changes; no dependency updates were applied.
- `npm test -w @flagkit/server` — passed: 13 files / 107 tests.
- `npm test --workspaces --if-present` — passed: server 13 files / 107 tests, client 13 files / 29 tests, SDK 1 file / 13 tests, evaluator 2 files / 32 tests.
- `npm run build -w @flagkit/client` — passed. Final bundle marker scan: zero occurrences for all five requested markers.
- Focused Redis regression tests — passed after the Redis key hashing and error-log redaction fixes.
