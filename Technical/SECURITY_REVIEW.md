# Counter-Spy.ai — Security & Optimization Review

_Reviewed branch: `feat/security-review-otel-ctf-split` (forked from `main` @ `55dfee3`). Date: 2026-05-12._

This review covers the Shield/Sword/Radar/Vault layers (`src/lib/sanitizer.ts`, `backend/src/security/sanitizer.ts`, `backend/src/server.ts`, `src/lib/anomalyDetector.ts`, `firestore.rules`), the Sam Spade CTF service, and the build/observability surface. It records concrete findings with file:line references and the remediation status in this branch.

Status legend: ✅ fixed in this branch · 🟡 partially mitigated · ⏭️ deferred (tracked in *Follow-ups*).

---

## Summary table

| # | Severity | Area | Finding | Status |
|---|----------|------|---------|--------|
| 1 | High | `backend/src/server.ts` | Responder LLM output is returned to the caller without re-running the Shield (no output-side redaction / blocked-keyword check). | ✅ |
| 2 | High | `backend/src/server.ts` | No rate limiting on any route — `/v1/intercept`, `/v1/translate`, `/v1/ctf/sam-spade/*` can be flooded (DoS, and free abuse of the safeguard/responder LLMs if the bearer token leaks). | ✅ |
| 3 | High | `backend/src/server.ts` | SSRF: `SAFEGUARDS_API_BASE_URL` / `RESPONDER_API_BASE_URL` (and the per-request `metadata.safeguardApiKey` override) are used in `fetch()` with no allow-list — the embeddings URL is the only one that gets `isLocalOpenAiCompatibleBaseUrl()`. | ✅ |
| 4 | Medium | `firestore.rules` | Admin role hardcodes a personal email address in deployed rules. | ✅ |
| 5 | Medium | `src/lib/syntacticAnalyzer.ts`, `src/lib/sanitizer.ts`, `backend/src/security/sanitizer.ts` | Per-request `new RegExp(...)` compilation in the hot path (keyword loops). | ✅ (syntactic analyzer) / 🟡 (sanitizer keyword loops left as-is — `String.includes`, no regex) |
| 6 | Medium | `backend/src/services/sam-spade/store.ts` | `JSON.parse(row.payload)` with no try/catch and no schema validation — a corrupt/tampered SQLite row crashes the request. | ✅ |
| 7 | Low | `backend/src/server.ts` | No caching of safeguard verdicts — identical prompts re-hit the safeguard LLM each time. | ⏭️ |
| 8 | Low | `src/**` | ~38 `console.*` sites; a few echo Firebase/auth config on error. | ⏭️ (backend logging is replaced by OpenTelemetry in Phase 1) |
| 9 | Low | `backend/src/services/instruction-monitor/` | The pgvector seed snapshot is content-hashed but not signed — write access to the seed file could poison the corpus. | ⏭️ |
| O1 | Opt | `src/lib/obfuscation.ts` | ~21 `OBFUSCATION_TECHNIQUES` transforms are Playground-only but ship in the main bundle. | ✅ (lazy `import()`) |
| O2 | Opt | `backend/src/security/sanitizer.ts` | `analyzeSlidingWindowEntropy()` recomputes Shannon entropy per window (O(n·w)); a rolling-counts pass would be O(n). | ⏭️ (no behavior change desired without profiling) |
| O3 | Opt | `backend/src/services/sam-spade/store.ts` | Synchronous SQLite (`node:sqlite` `DatabaseSync`) on the request path. | ⏭️ (acceptable at current scale; blast radius shrinks once the CTF service is its own process — Phase 2) |

The cardinal rule ("nothing reaches the responder without first passing the sanitizer") **is** enforced on the inbound path — `backend/src/server.ts` always calls `sanitizePrompt()` before `generateSafeguardVerdict()` / `generateResponderOutput()` (`/v1/intercept` ~line 1681, `/v1/ctf/sam-spade/message` ~line 1969), and `src/lib/gemini.ts` is a static stub so the browser never calls a model directly. Finding #1 is the *outbound* counterpart of that rule.

---

## High severity

### 1. Responder output bypasses the Shield ✅

`backend/src/server.ts`:
- `/v1/intercept`: `generateResponderOutput(sanitization.sanitized)` → `responder.response = responderResult.response` returned to the caller verbatim (~lines 1861-1878).
- `/v1/ctf/sam-spade/message`: `generateResponderOutput(...)` → `submitSamSpadeMessage({ npcResponse: responderResult.response })` stored into the session transcript verbatim (~lines 2036-2052).

The Shield only inspects *inbound* prompts. If the responder LLM is jailbroken, leaks PII/secrets, or echoes the canary, that text reaches the user un-redacted and un-flagged.

**Fix (this branch):** `backend/src/security/sanitizer.ts` exports a new `sanitizeOutput(text)` that reuses `SENSITIVE_PATTERNS` redaction + the credit-card pass + the blocked-keyword check (no entropy/syntactic scoring — output is model text, not an attack surface for those). `backend/src/server.ts` runs every responder string through it via `applyResponderOutputShield()`:
- `/v1/intercept` — a *high-risk* leak (canary / private / AWS / LLM key) is withheld entirely (responder `status: 'WITHHELD'`, body replaced with a "withheld pending review" notice); a lesser redaction (e.g. an email/card the model echoed) is returned with the span replaced (`status: 'REDACTED'`); in both cases the `OUTPUT_*` flags are folded into `detectionFlags` and a `responder.output_redacted` metric + `responder_output_shield_tripped` log are emitted.
- `/v1/ctf/sam-spade/message` — any output trip flips the turn to `externalVerdict: 'ADVERSARIAL'`, so the existing intercept path takes over (`Bad content.`, `reviewDisposition: 'queued'`, `escalationRecommended: true`).

Toggle with `RESPONDER_OUTPUT_SHIELD_ENABLED` (default on). Covered by `backend/test/phase0Hardening.test.ts` (`sanitizeOutput` cases) and the existing route tests in `backend/test/securityRoutes.test.ts` still pass.

### 2. No rate limiting ✅

`backend/src/server.ts` mounts `express.json()`, CORS, and request-id logging but no throttle (`grep -n "rateLimit\|helmet"` → none). Any holder of `INTERCEPT_BEARER_TOKEN` (or, in dev, anyone) can spam `/v1/intercept` and run up the safeguard/responder bill or wedge the event loop (synchronous sanitizer + SQLite).

**Fix (this branch):** a dependency-free fixed-window limiter (`backend/src/middleware/rateLimit.ts`) keyed by `Authorization` header (falls back to `x-forwarded-for` / socket IP), applied right after `express.json()`. Configurable via `RATE_LIMIT_WINDOW_MS` (default `60000`) and `RATE_LIMIT_MAX` (default `120`); set `RATE_LIMIT_MAX=0` to disable. On limit it returns `429` with `Retry-After` and increments `counterspy.ratelimit.dropped`. Exempts `/healthz`.

### 3. SSRF via unvalidated provider base URLs ✅

`backend/src/server.ts`:
- `generateSafeguardVerdict()` uses `env.SAFEGUARDS_API_BASE_URL` directly in `fetch()` (~line 359) — no `isLocalOpenAiCompatibleBaseUrl()` gate (only `getInstructionEmbeddingsRuntimeConfig()` at ~line 211 has one).
- `generateResponderOutput()` uses `env.RESPONDER_API_BASE_URL || env.LLM_API_BASE_URL` directly (~lines 921-924).
- `/v1/intercept` accepts `metadata.safeguardApiKey` from the request body and passes it as the safeguard bearer token (~lines 1124, 1764) — a request-controlled credential override.

A misconfigured/compromised env (or, for the key, a crafted request) can point the backend at `http://169.254.169.254/...` or other internal hosts.

**Fix (this branch):** new `backend/src/security/urlGuard.ts` with `assertEgressAllowed(url, { allowPrivate })` — rejects link-local (`169.254.0.0/16`, `fd00::/8`, `fe80::/10`), loopback, and (when `allowPrivate` is false, i.e. `APP_ENV !== 'dev'`) RFC1918 ranges; an optional `EGRESS_ALLOWLIST` (comma-separated host[:port]) overrides. The safeguard/responder/embeddings/Lara base URLs are validated **at startup** (fail fast). The per-request `metadata.safeguardApiKey` override is now ignored unless `APP_ENV === 'dev'` (logged when dropped).

---

## Medium severity

### 4. Hardcoded admin email in `firestore.rules` ✅

`isAdmin()` matched `request.auth.token.email == "<personal-address>"`. Anyone reading the deployed rules learns the admin's email (a targeting aid) and the check is brittle (email change ⇒ lockout).

**Fix (this branch):** `isAdmin()` now checks `request.auth.token.admin == true` (a custom claim set by the backend / Cognito group sync) **or** membership in `/config/admins/{uid}`. No other rule's read/write scope changed. Operators must mint the `admin` custom claim for existing admin accounts — documented in `Regulatory/ANALYST_GUIDE.md`.

### 5. Per-request regex compilation in the hot path ✅ / 🟡

`src/lib/syntacticAnalyzer.ts` (~lines 104-118) builds a fresh `new RegExp("\\b" + escaped + "\\b", "g")` for every entry in `highSignalKeywords` (33) + `mediumSignalKeywords` (14) on **every** `analyzeSyntacticComplexity()` call, and that function is called multiple times per prompt (`backend/src/security/sanitizer.ts` line 1256: `Math.max(...detectorCandidates.map(analyzeSyntacticComplexity))`).

**Fix (this branch):** the keyword lists and their compiled `{ regex, weight }` tuples are hoisted to module-level `const`s in `src/lib/syntacticAnalyzer.ts`; matching behavior is byte-identical (the `g` flag + `String.match` path does not use `lastIndex`). The `WRAPPER_SHELL_REGEX` etc. were already module-level. The frontend/backend `sanitizer.ts` keyword loops use `String.includes` (no regex) so there is nothing to precompile there; the only per-request `new RegExp` in `sanitizePrompt()` is the user-supplied `regexRules` loop (~line 1400), which is intentionally per-request and wrapped in `try/catch`.

### 6. Unvalidated Sam Spade session deserialization ✅

`backend/src/services/sam-spade/store.ts` line 37: `return JSON.parse(row.payload) as SamSpadeSessionRecord;` — no `try/catch`, no schema check. A corrupt row (disk error, manual edit, partial write) throws an unhandled exception inside the route handler.

**Fix (this branch):** `getStoredSession()` wraps the parse in `try/catch`, validates the result against a Zod `SamSpadeSessionRecordSchema` (new, in `backend/src/services/sam-spade/types.ts`), logs `sam_spade_session_payload_invalid`, and returns `null` (treated as "session not found") on failure.

---

## Low severity / follow-ups

- **#7 — Safeguard verdict cache.** `recentPromptHashes` already tracks `{promptHash → firstSeenMs}` for retry detection (`backend/src/server.ts` ~line 832). An opt-in LRU of `{promptHash → {verdict, reasoning}}` with a short TTL (e.g. `SAFEGUARD_CACHE_TTL_MS`, default `0` = off) would cut redundant LLM calls without ever masking a tuning change (key the cache on `hash(sanitized + JSON(tuning) + effectiveSystemPrompt)`). Deferred — wants its own design + tests.
- **#8 — Frontend `console.*`.** Mostly debug noise; a few (`src/lib/firebase.ts` config-load errors) print config. Low risk in a SOC-operator tool. Backend `console.log(JSON.stringify(...))` is superseded by the OpenTelemetry logs pipeline in Phase 1.
- **#9 — Sign the instruction-monitor seed.** `seedRecordHash` / `seedSnapshotHash` are SHA-256 content hashes, not signatures. HMAC the snapshot with a server secret (`INSTRUCTION_MONITOR_SEED_HMAC_KEY`) and verify on load to make seed-file tampering detectable.
- **O2 — Rolling entropy.** `analyzeSlidingWindowEntropy(prompt, 35, 5, ...)` recomputes a 35-char histogram every 5 chars. A single left-to-right pass maintaining add/remove counts is O(n). Not changed here — any rewrite must reproduce the exact `maxEntropy` / `globalEntropy` / `suspiciousChunks` outputs, which the test suite pins, so it deserves its own PR with before/after numbers.
- **O3 — Async SQLite.** `node:sqlite` `DatabaseSync` blocks the event loop per query. Fine at demo scale; once the CTF service is its own container (Phase 2) the impact is isolated to that process. Revisit (`better-sqlite3` worker / connection pool / Postgres) if CTF traffic grows.

---

## What looks good

- Inbound cardinal rule is genuinely enforced (see Summary).
- All request bodies are Zod-validated with `.strict()` where appropriate; `express.json({ limit: '256kb' })` bounds payloads; the intercept prompt is capped at 50 KB.
- Secrets are loaded from env, never logged; upstream error bodies are logged without the bearer token; `app.disable('x-powered-by')`.
- `firestore.rules` blocks client-set server-owned audit fields and forces `userId == request.auth.uid` on creates.
- Sam Spade SQLite access is fully parameterized (`db.prepare(...).get(?)` / `.run(?,?,?)`) — no SQL injection.
- `react-markdown` runs with `rehype-raw` disabled; no `dangerouslySetInnerHTML` in the tree.
- Sanitizer has a self-protecting ReDoS latency tripwire (`SANITIZATION_REDOS_LATENCY_THRESHOLD_MS`) that fails the verdict closed.

---

## Verification

- `npm run lint` (frontend + backend tsc) and `npm test` (`backend/test/*.test.ts` + `src/lib/*.test.ts`) pass on this branch; `backend/test/phase0Hardening.test.ts` adds 13 cases covering findings #1, #2, #3, #6.
- Manual: `POST /v1/intercept` with a benign prompt → `200 CLEAN`; with a redaction/jailbreak prompt → `403 INTERCEPTED`; flooding past `RATE_LIMIT_MAX` (default 120/min) → `429 Retry-After`; setting `RESPONDER_API_BASE_URL=http://169.254.169.254/...` (or any RFC1918 host) with `APP_ENV=prod` → backend refuses at startup.

## Operational notes for deployers

- `firestore.rules`: grant admin via a `admin: true` custom claim (backend / Cognito group sync), a `/config/admins/{uid}` doc, or a `users/{uid}.role == 'admin'` profile. The custom claim is the bootstrap path (no rule change needed for `/config/admins` — it's covered by the existing `config/{document=**}` rule).
- New backend env vars: `RATE_LIMIT_WINDOW_MS` (default `60000`), `RATE_LIMIT_MAX` (default `120`, `0` = disabled), `EGRESS_ALLOWLIST` (comma-separated `host`/`host:port` to permit private targets outside dev), `RESPONDER_OUTPUT_SHIELD_ENABLED` (default `true`). See `.env.example`.
