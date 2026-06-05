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
| 7 | Low | `backend/src/server.ts` | No caching of safeguard verdicts — identical prompts re-hit the safeguard LLM each time. | ✅ (opt-in `SAFEGUARD_CACHE_TTL_MS`, off by default) |
| 8 | Low | `src/**` | ~38 `console.*` sites; a few echo Firebase/auth config on error. | ✅ (`src/lib/devLog.ts` `devLog`/`devWarn` no-op in production; the debug `console.log`/`console.warn` in `src/App.tsx` migrated; `firebase.ts` config-parse no longer echoes config. The remaining `console.error` calls are genuine error logging and are kept.) |
| 9 | Low | `backend/src/services/instruction-monitor/` | The pgvector seed snapshot is content-hashed but not signed — write access to the seed file could poison the corpus. | ✅ (opt-in `INSTRUCTION_MONITOR_SEED_HMAC_KEY` — exports are HMAC-signed, imports require a valid signature when the key is set) |
| 10 | Low | `ctf-frontend/` | The standalone CTF app can be `<iframe>`-embedded by any origin (clickjacking surface). | ✅ (dev server sets `Content-Security-Policy: frame-ancestors`, configurable via `CTF_ALLOWED_FRAME_ANCESTORS`; production behind the CFN-set CSP) |
| O1 | Opt | `src/lib/obfuscation.ts` | ~21 `OBFUSCATION_TECHNIQUES` transforms are Playground-only but ship in the main bundle. | ✅ (`React.lazy` code-split) |
| O2 | Opt | `backend/src/security/sanitizer.ts` | `analyzeSlidingWindowEntropy()` recomputes Shannon entropy per window (O(n·w)); a rolling-counts pass would be O(n). | ⏭️ (deferred — a rolling histogram only removes ~6% of the per-window work because the dominant cost is the `RiskBoost`/`Penalty` ratio heuristics, and it would introduce floating-point-ordering fragility in `maxEntropy`; wants a dedicated PR with benchmarks + an equivalence proof, as the entropy bands are firewall thresholds) |
| O3 | Opt | `backend/src/services/sam-spade/store.ts` | Synchronous SQLite (`node:sqlite` `DatabaseSync`) on the request path. | 🟡 (still synchronous, but now opened WAL + `busy_timeout=5000` so concurrent access — gateway/service/test processes — no longer hits `SQLITE_BUSY`; an async/pooled driver is still a future option) |
| O4 | Opt | `src/main.tsx`, `ctf-frontend/` | No browser-side tracing — frontend `/v1/*` calls aren't correlated with backend spans. | ✅ (opt-in `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` — `@opentelemetry/sdk-trace-web` + fetch instrumentation with W3C propagation; loaded via dynamic `import()` and isolated into an `otel-vendor` chunk so it's absent from a build/runtime that doesn't enable it) |
| O5 | Opt | `backend/src/server.ts` | The gateway's CTF review-artifact feed was an in-memory ring buffer (lost on restart). | ✅ (SQLite-backed `backend/src/ctf/reviewArtifactStore.ts` — WAL, count-capped at `CTF_REVIEW_ARTIFACTS_MAX`; survives restarts/redeploys) |
| O6 | Cleanup | `src/App.tsx` | The in-app CTF UI fallback (and its state/handlers/effects) was dead once `VITE_CTF_FRONTEND_URL` is the deployed path. | ✅ (removed — the Sam Spade tab now embeds the standalone CTF app via `<iframe>`, with a placeholder when `VITE_CTF_FRONTEND_URL` is unset; `appendSamSpadeReviewSurfaces`/`ensureSamSpadeSession`/`handleSamSpadeSubmit`/`handleSamSpadeSolve` + the in-app session state/effects + the now-unused `backendApi` CTF imports deleted; the gateway-poll → audit/metrics mirror — `ingestExternalCtfReviewArtifact` — stays) |

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

## Follow-ups — implemented

- **#7 — Safeguard verdict cache (done).** `backend/src/server.ts` now has an opt-in cache keyed on `sha256(modelId + system prompt + constructed judge input)` — so a tuning/prompt change is a cache miss and a per-request safeguard API key override is never cached. `SAFEGUARD_CACHE_TTL_MS` (default `0` = off) and `SAFEGUARD_CACHE_MAX_ENTRIES` (default `256`, FIFO eviction). Emits `safeguard.cache` `{hit}` metrics when enabled. Covered by `backend/test/safeguardCache.test.ts`.
- **#9 — Sign the instruction-monitor seed (done).** `backend/src/services/instruction-monitor/service.ts` now signs exported seed snapshots with `HMAC-SHA256(INSTRUCTION_MONITOR_SEED_HMAC_KEY, seedSnapshotHash)` (`seedSnapshotSignature` field), and `importSeedSnapshot` requires a valid signature whenever that key is configured (timing-safe compare; an unsigned snapshot is rejected). With the key unset, behavior is unchanged (signature ignored — backward compatible).
- **#10 — CTF iframe clickjacking guard (done).** `ctf-frontend/vite.config.ts` adds a dev-server middleware that sets `Content-Security-Policy: frame-ancestors <list>` (+ `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`); `CTF_ALLOWED_FRAME_ANCESTORS` is configurable (default `'self' http://localhost:3000 http://127.0.0.1:3000`). For a static (CFN/CloudFront) deployment the CSP comes from the edge headers, as it already does for the main frontend.
- **#8 — Frontend logging (done).** `src/lib/devLog.ts` exports `devLog` / `devWarn` that are no-ops in a production build (`import.meta.env.PROD`); the five debug `console.log`/`console.warn` calls in `src/App.tsx` now use them. `src/lib/firebase.ts` reads Firebase Auth config from `VITE_FIREBASE_*` env vars and throws a generic error naming only the bad keys (never echoing config values). Genuine `console.error` calls are left as-is — errors should surface in any environment.
- **O3 — SQLite concurrency (partial).** The Sam Spade store is still synchronous, but the DB is now opened with `PRAGMA journal_mode = WAL` + `PRAGMA busy_timeout = 5000`, so concurrent access (e.g. multiple test processes, or a gateway and the standalone service) no longer hits `SQLITE_BUSY`. The new CTF review-artifact store (`backend/src/ctf/reviewArtifactStore.ts`) does the same. An async/pooled driver remains a future option if CTF traffic grows.
- **O4 — Browser-side OpenTelemetry (done).** `src/lib/webTelemetry.ts` and `ctf-frontend/src/lib/webTelemetry.ts` register `@opentelemetry/sdk-trace-web` + `FetchInstrumentation` (W3C `traceparent` propagation to `/v1/*`) when `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` is set; the OTel web SDK is loaded via dynamic `import()` and an `otel-vendor` chunk group (both `vite.config.ts` files), so it's entirely absent from a build/runtime that doesn't enable it. The demo collector's OTLP/HTTP receiver has a CORS allow-list for the two frontend origins.
- **O5 — Durable CTF review-artifact store (done).** `backend/src/ctf/reviewArtifactStore.ts` — SQLite-backed (WAL, `busy_timeout`), count-capped at `CTF_REVIEW_ARTIFACTS_MAX` (default `5000`, oldest pruned), path via `CTF_REVIEW_ARTIFACTS_STORE_PATH` (the demo gateway gets a `counter_spy_gateway_data` volume). `POST/GET /v1/ctf/review-artifacts` use it instead of the in-memory ring, so a gateway restart no longer drops the queue.
- **O6 — Removed the in-app CTF UI fallback (done).** The Sam Spade tab now always embeds the standalone CTF app via `<iframe>` (placeholder when `VITE_CTF_FRONTEND_URL` is unset). Deleted from `src/App.tsx`: the ~350-line inline noir UI + the `samSpadeUnapprovedNotice` dialog; the in-app session state (`samSpadeInput`/`samSpadeTheory`/`samSpadeSession`/`samSpadeStatus`/`samSpadeInputAlert`/`samSpadeUnapprovedNotice`/`samSpadeSessionPromiseRef`/`samSpadeTranscriptEndRef`/`samSpadeCaseSolved`/`visibleSamSpadeMessages`); the handlers `handleSamSpadeSubmit`/`handleSamSpadeSolve`/`ensureSamSpadeSession`/`appendSamSpadeReviewSurfaces`; the in-app CTF auto-init and transcript auto-scroll effects; the `ctf_chat` branches in `markLogAsReviewed`/`clearLocalSessionArtifacts`/`deleteAllAuditLogs`; and the now-unused `backendApi` imports (`createSamSpadeSession`/`sendSamSpadeMessage`/`solveSamSpadeCase`/`SamSpadeSession`) + the unused `Unlock` icon. Kept: the gateway-poll → Analyst-Chat/`audit_logs` mirror (`ingestExternalCtfReviewArtifact` + `mapSamSpadeDetectionLevel`/`isSamSpadeReviewBlocked` + the poll effect).

## Follow-ups — still deferred

- **O2 — Rolling entropy.** `analyzeSlidingWindowEntropy(prompt, 35, 5, ...)` recomputes a 35-char histogram every 5 chars. A rolling histogram only removes ~6% of the per-window work — the dominant cost is the `calculateEntropyRiskBoost` / `calculateEntropyLanguagePenalty` ratio heuristics (~13 char-passes per window), which are far harder to make incremental — and it would introduce floating-point-ordering sensitivity in `maxEntropy`. Since the entropy bands (`SUSPICIOUS_ENTROPY_THRESHOLD = 3.8`, configured adversarial threshold) are firewall thresholds, this wants its own PR with benchmarks and an equivalence proof, not an opportunistic change here.

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

- `npm run lint` (frontend + backend tsc), `npm test` (`backend/test/*.test.ts` + `src/lib/*.test.ts`, 153 cases — `phase0Hardening.test.ts`, `safeguardCache.test.ts`, `samSpadeServiceSplit.test.ts` added), `npm run build`, and the `ctf-frontend` build all pass on this branch (test suite is stable across repeated runs); both compose files validate.
- Manual: `POST /v1/intercept` with a benign prompt → `200 CLEAN`; with a redaction/jailbreak prompt → `403 INTERCEPTED`; flooding past `RATE_LIMIT_MAX` (default 120/min) → `429 Retry-After`; setting `RESPONDER_API_BASE_URL=http://169.254.169.254/...` (or any RFC1918 host) with `APP_ENV=prod` → backend refuses at startup; with `SAFEGUARD_CACHE_TTL_MS>0`, the second identical `/v1/intercept` doesn't hit the safeguard LLM; with `INSTRUCTION_MONITOR_SEED_HMAC_KEY` set, importing a hand-edited seed file fails the signature check; the CTF review-artifact feed survives a gateway restart (SQLite-backed).

## Operational notes for deployers

- `firestore.rules`: grant admin via a `admin: true` custom claim (backend / Cognito group sync), a `/config/admins/{uid}` doc, or a `users/{uid}.role == 'admin'` profile. The custom claim is the bootstrap path (no rule change needed for `/config/admins` — it's covered by the existing `config/{document=**}` rule).
- New backend env vars: `RATE_LIMIT_WINDOW_MS` (default `60000`), `RATE_LIMIT_MAX` (default `120`, `0` = disabled), `EGRESS_ALLOWLIST` (comma-separated `host`/`host:port` to permit private targets outside dev), `RESPONDER_OUTPUT_SHIELD_ENABLED` (default `true`), `SAFEGUARD_CACHE_TTL_MS` / `SAFEGUARD_CACHE_MAX_ENTRIES` (cache off by default), `INSTRUCTION_MONITOR_SEED_HMAC_KEY` (seed signing; unset = unsigned/backward-compatible), `CTF_REVIEW_ARTIFACTS_STORE_PATH` / `CTF_REVIEW_ARTIFACTS_MAX` (gateway CTF review-artifact store; give the gateway a writable volume for the DB). Frontend: `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` (browser tracing; unset = off), `VITE_CTF_FRONTEND_URL` (the Sam Spade tab embeds this; unset shows a placeholder), `CTF_ALLOWED_FRAME_ANCESTORS` (CTF iframe embedders). `infra/cloudformation/dev/04-backend.yml` exposes `OtelExporterOtlpEndpoint`, `RateLimitMax`, and `EgressAllowlist` parameters on the ECS task. See `.env.example`.
