# Session Handoff

This page captures the current implementation state so a future Codex session can continue without relying on a long chat transcript.

---

## Server-hosted rewrite (branch `feat/server-hosted-app`) — IN PROGRESS

> The "Current Runtime Shape" / "Important File Map" sections further down predate this rewrite (they reference `src/lib/sanitizer.ts`, a `:3000` Vite frontend container, browser→Firestore audit writes, etc.). This section is the current state on `feat/server-hosted-app`.

**Goal:** turn the browser SPA into a server-hosted app — SSR'd React served by the backend gateway, all sanitization/analysis on the backend, data off Firestore onto Postgres.

**Done & committed** (branched off `da766f6`):
- `6b79fed` Phase 1 — SSR. `src/entry-server.tsx` (`renderToString`) + `src/entry-client.tsx` (hydrate-or-`createRoot`); `index.html` is an SSR template (`<!--ssr-outlet-->`); `vite.config.ts` dual build (`vite build` → `dist/client/`, `vite build --ssr src/entry-server.tsx` → `dist/server/`) keyed on `isSsrBuild`; `package.json` scripts `build:client`/`build:ssr`/`build`/`build:all`/`start`; `src/lib/firebase.ts` lazy/browser-only (inert under SSR); `backend/src/web/ssr.ts` (`mountWebApp` — static + SSR catch-all) wired into `server.ts` before the JSON 404 (gateway role only); rate limiter exempts non-`/v1` GETs. `src/main.tsx` deleted. SSR currently emits the loading splash (no server-side auth yet).
- `d3a6f32` Phase 2(1/5) — `POST /v1/analyze`, `POST /v1/analyze/output` (reuse `backend/src/security/sanitizer.ts`; no LLM/egress); `analyzePrompt`/`analyzeOutput` + `BackendSanitizationResult`/`BackendOutputSanitizationResult`/`FirewallVerdict` in `src/lib/backendApi.ts`.
- `de61b0c` Phase 2(2/5) — `App.tsx` no longer runs a local sanitizer. `runPromptShield`/`runOutputShield` call the backend + `adaptBackendSanitization` (verdict→`DetectionLevel`); live preview is a debounced (~300ms) cancellable effect; the "force-PII-redact for the audit log" branches collapsed (backend always redacts).
- `6e18976` Phase 2(3/5) — Playground migrated; analysis cluster **moved** `src/lib/{syntacticAnalyzer,sanitizerNormalization,languageLikelihood,promptFeatureVector,obfuscation,spellNormalize}.ts → backend/src/analysis/`; `src/lib/{sanitizer,sanitizerObfuscation,sanitizerLanguage,sanitizer.test}.ts` **deleted** (redundant with `backend/src/security/sanitizer.ts`); shared shapes → `src/lib/analysisTypes.ts` (`DetectionLevel`, `SUSPICIOUS_ENTROPY_THRESHOLD`, `SanitizationResult`, `OutputSanitizationResult`); new `POST /v1/analyze/full` (sanitization+syntactic+featureVector), `GET|POST /v1/analyze/obfuscate` (catalog | variants), `POST /v1/analyze/normalize` (heuristic only); `backendApi.ts` gained `analyzeFull`/`getObfuscationCatalog`/`obfuscatePrompt`/`normalizeText`/`adaptBackendSanitization`; `PromptFeatureVectorSchema` exported from `playgroundMetrics.ts`, `formatFeaturePercent` added there; `SyntacticAnalyzer.tsx` render-time analysis `useMemo` → debounced effect calling `/v1/analyze/full`, obfuscation catalog fetched on mount; `App.tsx` `buildAuditFeatureFields` is async (`/v1/analyze/full`); `CLAUDE.md` updated; `package.json` `backend:test` glob dropped `src/lib/*.test.ts`. Backend tests 89 (was 153 — the ~64-test frontend `sanitizer.test.ts` was deleted; consider porting coverage for `backend/src/analysis/{syntacticAnalyzer,obfuscation}.ts`).
- `cb59ecf` Phase 4(partial) — `backend/Dockerfile` build stage also runs `npm run build` (Vite client+SSR) with `VITE_*` build ARGs; runtime stage copies `dist/`. `docker-compose.demo.yml` dropped the `counter-spy-frontend` service (console at `http://localhost:18080/`); `counter-spy-ctf-frontend` still a Vite-dev container. `Dockerfile.frontend-demo` marked deprecated.
- `2b30215` Phase 3(1) — `backend/src/audit/auditStore.ts` (Postgres-backed `audit_logs` table: indexed `id`/`user_id`/`session_id`/`source`/`model_id`/`detection_level`/`created_at` + `record` jsonb; `appendAuditLog`/`listAuditLogs`/`patchAuditLog`/`clearAuditLogs`/`initAuditStore`/`isAuditStoreConfigured`; conn string `AUDIT_DATABASE_URL → DATABASE_URL → INSTRUCTION_MONITOR_DATABASE_URL`); `GET|POST|PATCH|DELETE /v1/audit-logs` (POST keyed by the authenticated caller, 503 if no DB, `initAuditStore` best-effort at boot); `appendAuditLog`/`listAuditLogs`/`patchAuditLog`/`clearAuditLogs` + `AuditLogRow` in `backendApi.ts`. **Additive — the console still reads/writes Firestore.** Not exercised against a real Postgres in the dev sandbox (queries are standard `pg`).
- Phase 3(2) (commit right after `8707c09`) — `App.tsx`'s audit path is off Firestore and on `/v1/audit-logs`:
  - **Reads:** the `audit_logs` `onSnapshot` listener → a polling `useEffect` (every `AUDIT_LOG_POLL_INTERVAL_MS = 5000`ms, `AUDIT_LOG_POLL_LIMIT = 50`) that calls `listAuditLogs({ limit }, profile.uid)` and `setAuditLogs(rows.map(r => parseAuditLog(r.record)).filter(...))`. On error it just `devWarn`s and keeps the current list. Guard is still `if (!profile) return; if (localReviewMode) return;`.
  - **Writes:** all 4 `addDoc(collection(db,'audit_logs'), {...})` sites (`ingestExternalCtfReviewArtifact`, `handleSendMessage`'s context-window-block + ReDoS-block + main-create branches) → `await appendAuditLog(payload, profile.uid)`. Dropped `userId` + `timestamp: serverTimestamp()` from the payloads (the store stamps `id`/`user_id`/`created_at`; `userId` rides the `x-counter-spy-user-id` header). The main-create branch uses `(await appendAuditLog(...)).id` as `auditLogId` in place of `docRef.id` (still reconstructs `auditLogBase` by hand — `timestamp` left as `new Date()`, the next poll overwrites with the server ISO string).
  - **Mutations:** every `updateDoc(doc(db,'audit_logs',id), patch)` → `patchAuditLog(id, patch, profile.uid)` — in `observeReviewedAdversarialLog`, `handleReviewLog`, `handlePromoteToKB` (just the `{ promoted: true }` write; the `knowledge_base/golden-set` writes are untouched), and `handleSendMessage`'s `applyBackendMonitorPatch` / global-pause / HITL / responder-telemetry / safeguard-timeout / escalation / final-response patches.
  - **Clear:** `deleteAllAuditLogs` non-local branch (`getDocs`+`writeBatch`) → `clearAuditLogs({}, profile?.uid)` + `setAuditLogs([])` + `setEphemeralAuditLogs([])`. **Behavior change:** the backend clear wipes the whole shared trail — it does *not* preserve `PENDING_REVIEW` rows the way the old Firestore batch-delete did (no per-row delete endpoint; the carve-out re-lands with the Phase 3(4) RBAC pass). `handleClearAuditLogs`'s toast logic still works (in backend mode `preservedPendingCount` is `0`, so it shows "Audit logs cleared successfully (N entries removed)").
  - `localReviewMode` audit paths are **unchanged** (in-memory `auditLogs`/`ephemeralAuditLogs`); the polling effect short-circuits in that mode. `ephemeralAuditLogs` still bridges any patch that hasn't round-tripped before the next poll.
  - CSV export's timestamp formatting switched from `log.timestamp?.toDate ? ...` (which fell through to "now" for ISO-string timestamps) to `getLogTimestampValue(log.timestamp)`. Golden-set CSV export still reads local `auditLogs` state — unchanged.
  - Imports: dropped `getDocs`/`writeBatch`/`query`/`orderBy`/`limit` from the `firebase/firestore` import (only the audit path used them); added `appendAuditLog`/`listAuditLogs`/`patchAuditLog`/`clearAuditLogs` to the `backendApi` import. `addDoc`/`serverTimestamp`/`updateDoc`/`deleteDoc`/`onSnapshot`/`getDoc`/`setDoc`/`collection`/`doc`/`getDocFromServer` are still imported — `knowledge_base`/`config`/`users` paths still use them. Audit-write failures are still **fatal** (the `catch` calls `handleFirestoreError`, which logs + re-throws → aborts the rest of `handleSendMessage`) — same audit-or-bust posture as the Firestore era, so a `node backend/dist/server.js` run with **no `DATABASE_URL`** (the audit routes 503) breaks Analyst Chat after sanitization. Use the demo-compose stack (it has Postgres) or `localReviewMode` for bare-dev testing.
  - Verified: `npm run lint`, `npm run backend:test` (89/89), `npm run build`, `npm run backend:build`, `git diff --check` all pass. **Not** exercised against a live Postgres / running gateway in this sandbox — the changes are mechanical client-side rewires of calls that already had backend counterparts.
  - `Technical/SESSION_HANDOFF.md` (this file) updated. `CLAUDE.md`/`Technical/ARCHITECTURE.md` still describe Firestore-backed audit logs in places — those docs get refreshed in Phase 4 once the Firestore retirement (Phase 3 step 4) lands. Project memory `server-hosted-rewrite.md` updated.

### Phase 3 step 2 — live-Postgres validation (2026-05-13 session)

Exercised the new audit path against the demo-compose stack (gateway + pgvector Postgres + Sam Spade service + OTel collector + Jaeger + CTF frontend, all under `docker compose -f docker-compose.demo.yml`).

**Audit endpoints (curl smoke):**
- `POST /v1/audit-logs` → 201, server-stamps `id`/`userId`/`timestamp`, mirrors them into `record`. Indexed columns (`session_id`/`source`/`model_id`/`detection_level`) populated from the JSONB.
- `GET /v1/audit-logs?limit=50` → 200, full shared trail (no implicit user filter; the `userId` query param is optional). `sinceTimestamp=...` filter works (strict `>`).
- `PATCH /v1/audit-logs/:id` → 200; the `record = record || $patch::jsonb` merge plus the `CASE WHEN $patch ? 'detectionLevel' …` re-sync of column copies behaves correctly. Bad uuid → 400. Unknown uuid → 404.
- `DELETE /v1/audit-logs?userId=<uid>` → 200 with `{deleted: N}`, scoped wipe. Unscoped `DELETE /v1/audit-logs` wipes the whole shared trail (the documented behavior change from the old Firestore `PENDING_REVIEW` carve-out).
- Auth: requests without the shared bearer token → 401. With token + spoofable `x-counter-spy-user-id` header → routes accept; **cross-user reads/patches are allowed by design** (shared trail, RBAC deferred to step 4).

**Postgres state (verified via `psql` inside the container):** schema exactly matches `auditStore.ts`'s `SCHEMA_SQL`; indexes are `audit_logs_pkey` (PK on `id`), `audit_logs_created_at_idx` (DESC), `audit_logs_user_id_idx`, `audit_logs_source_idx`. `relrowsecurity = f` (no Postgres-level RLS). Pool: `max: 5`, `application_name: 'counter-spy-audit-store'` — separate `Pool` instance from the instruction-monitor pool, so audit traffic doesn't share back-pressure.

**Audit-store config:** falls back through `AUDIT_DATABASE_URL → DATABASE_URL → INSTRUCTION_MONITOR_DATABASE_URL`. The demo only sets the last; everything else works through the fallback. `initAuditStore()` is best-effort at boot (no `audit_store_init_failed` warnings in the logs).

**Known gaps / drift surfaced but not fixed here:**
- `auditStore.ts`'s header comment claims `session_id`/`model_id`/`detection_level` are indexed; the `CREATE INDEX` statements only cover `created_at`/`user_id`/`source`. Comment drift, not a functional bug — revisit when `ThreatDashboard.tsx` aggregation lands on those columns in step 3.
- Cross-user reads/patches/clears go through (the route handlers authenticate the caller but don't compare against the row's `user_id`). This is the intentional "shared trail" posture for the demo; **step 4 must re-introduce per-row enforcement**, either at the route handler (`WHERE user_id = $caller` on mutations + an admin override) or in the DB (RLS + `SET LOCAL role`).

**Three regressions found and fixed this session** (all surfaced because Phase 4 (partial) moved the analyst console from a separate `:3000` Vite container to the gateway on `:18080`, but a couple of co-located configs weren't updated):

1. **`vite.config.ts` chunking bug** — the production rolldown build had `codeSplitting.maxSize: 450 * 1024`, which broke `markdown-vendor` into two chunks with a circular import. The browser threw `TypeError: a is not a function` from `markdown-vendor-*.js` during module evaluation, which killed hydration before `App.tsx`'s `useEffect`s mounted — `setLoading(false)` never fired and the SSR splash hung forever. **Pre-existing** (the config was authored for the SPA build) but invisible until `cb59ecf` made the gateway serve the production bundle. **Fix:** removed `maxSize` from `rolldownOptions.output.codeSplitting`. The single `markdown-vendor` chunk is now 115 KB (was split into 15 KB + ~100 KB). Re-tune by re-adding `maxSize` with a higher ceiling if any future vendor chunk grows uncontrolled.

2. **OTel collector CORS** — `otel/collector-config.yaml`'s `receivers.otlp.protocols.http.cors.allowed_origins` listed only `:3000`/`:3001`, so browser spans from the gateway-served console at `:18080` were rejected with CORS errors. **Fix:** added `http://localhost:18080`/`http://127.0.0.1:18080` (and kept `:3000` for backwards-compat with older clones).

3. **CTF frontend iframe-CSP** — `ctf-frontend/vite.config.ts`'s default for `frame-ancestors` was `'self' http://localhost:3000 http://127.0.0.1:3000`, so the Sam Spade tab embedded by the console at `:18080` rendered blank (CSP blocked the embed). **Fix:** added `http://localhost:18080`/`http://127.0.0.1:18080` to the default. `CTF_ALLOWED_FRAME_ANCESTORS` env-var override still wins for non-localhost deployments.

**Not exercised through the UI:** the user was unable to complete Firebase Google sign-in because `localhost` isn't listed under the Firebase project's *Authorized domains* (this is a Firebase Console one-time setting, not a code fix). The `localReviewMode` workaround bypasses Firebase auth, but `App.tsx`'s audit-log polling effect short-circuits in that mode — so the new `/v1/audit-logs` path isn't exercised via the UI in `localReviewMode`. The headless curl smoke covered every CRUD endpoint, so the path is proven. Full UI validation is gated on either (a) adding `localhost` to Firebase Authorized domains, or (b) the auth-model decision in step 4 (which may replace Firebase OAuth entirely).

### Phase 3 step 3 — DONE (2026-05-13 session)

- `git mv src/lib/anomalyDetector.ts → backend/src/analysis/anomalyDetector.ts` and `git mv src/lib/metrics.ts → backend/src/analysis/metrics.ts`. Both are pure functions over arrays (no imports, no Firestore touchpoint) so nothing else changed on the way over.
- New `POST /v1/metrics/aggregate` route in `backend/src/server.ts` runs both analytics against the Postgres audit-log store. Request body `{sinceTimestamp?, source?, entropyThreshold?, limit?}` — strict zod schema; clamps `entropyThreshold ∈ [3, 4.6]` to match the dashboard's slider range and `limit ∈ [1, 5000]` (default 1000). The route reads via `listAuditLogs({sinceTimestamp, limit})`, applies a backend-side `getEffectiveDetectionLevelForMetrics(baseDetectionLevel, entropy, configuredEntropyThreshold)` (mirrors the dashboard's own `getEffectiveDetectionLevel` so the analytics agree with the rendered severity bands), filters by `source`, then runs `detectThreatSpikes` over `effective >= 2` rows and `calculateFalsePositiveMetrics` over the full window. Response: `{anomaly, fpr, sampleSize}`. Schema validation runs BEFORE the audit-store-configured check, so malformed inputs always 400 even when the store is unconfigured (the route handler reorders that intentionally — `requireBackendAuth` middleware → schema parse → `requireAuditStore` → `getAuthenticatedCallerId`).
- `aggregateMetrics()` Zod-validated client added to `src/lib/backendApi.ts` alongside the existing audit-log clients. Exports `MetricsAnomalyResult`, `MetricsFprResult`, `AggregateMetricsOptions`.
- `ThreatDashboard.tsx` rewired:
  - Imports: dropped `collection`, `query`, `where`, `getDocs`, `Timestamp` from `firebase/firestore` (only the audit-log Firestore query used them); kept `doc`, `onSnapshot`, `setDoc` for the still-Firestore governance config. Dropped `detectThreatSpikes`/`ThreatLog` from `../lib/anomalyDetector` and `calculateFalsePositiveMetrics`/`AuditLogMetrics` from `../lib/metrics` (both modules now live in `backend/src/analysis/`). Added `aggregateMetrics`/`listAuditLogs` from `../lib/backendApi`.
  - `buildMetricsFromLogs(logs)` (the closure inside the `loadMetrics` effect) stripped of its `detectThreatSpikes(threatLogs)→setMetrics` and `calculateFalsePositiveMetrics(...)→setFprMetrics` calls. It now does ONLY display-bucketing + operational-metrics state (24h threat chart, severity stacked chart, HITL/latency/resilience/prompt-shape/entropy-policy/alert-severity/layer-defense/detection-signals/obfuscation-signals/research-signals/ATLAS heatmap).
  - The whole real-mode `try` block (~230 lines of `getDocs(query(collection(db,'audit_logs'),where('timestamp','>=',Timestamp.fromDate(yesterday))))` + duplicated chart bucketing + duplicated operational-metrics computation) collapsed into: `listAuditLogs({sinceTimestamp: yesterday.toISOString(), limit: 1000})` → map `row.record` (full audit-log object with id/userId/timestamp mirrored in) → `mergeLocalAuditLogOverlays(...)` → `buildMetricsFromLogs(allLogs)` for display state → `aggregateMetrics({sinceTimestamp, source, entropyThreshold})` for `{anomaly, fpr}` → `setMetrics`/`setFprMetrics`. Eliminates the duplicate-bucketing path that previously diverged from the localReviewMode path.
  - `localReviewMode` path: `buildMetricsFromLogs(localAuditLogs)` still runs over the in-memory ephemeral logs (so the chart + operational widgets work); anomaly + FPR widgets get empty defaults (`isAnomaly:false`, `strictFPR:'N/A'`, etc.) because the server-side aggregate would have no Postgres data to operate on. Documented in-line.
- `src/lib/anomalyDetector.ts` + `src/lib/metrics.ts` deleted (via the `git mv` above; no other consumers — only `ThreatDashboard.tsx` imported them).
- New backend tests: `backend/test/metricsAggregation.test.ts` covers the pure functions directly (quiet window → no anomaly, 8-event last-hour pile → anomaly flagged + top attacker identified, empty input no-divide-by-zero; TP/TN/FP/FN partitioning + 50% strictFPR/FNR sample, unreviewed-only zeros). Two route-level tests in `securityRoutes.test.ts` cover `/v1/metrics/aggregate` auth (`401 no bearer`), audit-store-unconfigured (`503`), and schema validation (`400` on out-of-range `entropyThreshold`).
- Lint + 98/98 backend tests pass (was 91 — +5 pure-function + +2 route). Endpoint smoke-tested against the running demo gateway: returns `{anomaly:{…zeros}, fpr:{…zeros}, sampleSize:0}` against an empty Postgres.
- Phase 3 step 4 still up next (governance/policies/profiles stores; auth model decision).

### Phase 3 step 4 — retire Firestore; governance/policies stores; auth re-think
- Add `app_config` (key-value JSONB) table + `GET|PUT /v1/governance` (the `governanceConfig` doc + the `localStorage` system config — `App.tsx` ~1680s loaders) and `kb_policies` table + `GET|POST|DELETE /v1/policies` (the `knowledge_base` collection — `App.tsx` `handleSavePolicy`/`handleDeletePolicy`/`handleFileUpload`, `customPolicies`). Optionally a `user_profiles` table (the `users` collection — read at login).
- Then `src/lib/firebase.ts` shrinks to sign-in + uid; remove `firestore.rules` (re-express its per-user/per-field protections as route-handler checks + `audit_logs`/`app_config` column constraints); update `CLAUDE.md`'s "Vault" line. Switch `docker-compose.demo.yml`'s Postgres from `tmpfs` to a durable named volume now that it holds audit data.
- **Auth model is still undecided** (per user, 2026-05-12): keep Firebase as identity provider + backend verifies ID tokens (Firebase Admin SDK or a JWT-verify lib), vs. backend-owned login/sessions. The backend currently trusts the bearer-token-gated `x-counter-spy-user-id` header — fine for the demo, but the per-user RBAC story needs one of the above before this is production-real.

### Phase 4 (rest)
Refresh `README.md`, `Technical/ARCHITECTURE.md`, `Technical/LOCAL_DEVELOPMENT.md`, `Technical/SBOM.md`, `File_Structure.md`, and `infra/cloudformation/{scripts/deploy-frontend.sh,dev/03-frontend.yml}` for the no-separate-frontend-container shape; convert `Dockerfile.ctf-frontend` to a production/static build (or fold the CTF surface into the gateway too).

**Build/verify in this env:** `npm run lint` (frontend `tsc --noEmit` also typechecks `backend/src/**`), `npm run backend:test`, `npm run build` (Vite client+ssr), `npm run backend:build`. Start the gateway locally: `APP_ENV=dev INTERCEPT_BEARER_TOKEN=<≥16 chars> node backend/dist/server.js` — `/`, `/healthz`, `/v1/*`. Project memory: `server-hosted-rewrite.md`.

---

## Current Runtime Shape

- The Docker demo stack is the active local test path:
  - Frontend: `http://localhost:3000`
  - Backend health: `http://127.0.0.1:18080/healthz`
  - pgvector Postgres: `127.0.0.1:15432`
  - Rebuild command: `docker compose --env-file /Users/nate/Documents/Counter-Spy.ai/.env.demo.local -f /Users/nate/Documents/Counter-Spy.ai/docker-compose.demo.yml up --build -d`
- The instruction similarity monitor is enabled in the demo backend and uses `counter-spy-postgres`. The Postgres data directory is tmpfs-backed, initialized with SCRAM authentication and data checksums, so recreating the container starts with a clean instruction database. Sam Spade SQLite data still persists in its named Docker volume.
- The demo embedding sidecar is Ollama on the LM Studio Mac: `http://192.168.0.183:11434/v1`, model `nomic-embed-text`, `768` dimensions, max 4 chunks. The backend health endpoint should report `instructionMonitor.embeddings.source: "explicit"`.
- Similarity routing now separates fingerprint and semantic evidence: exact/loose SHA-256 or SimHash matches against stored `ADVERSARIAL` records remain adversarial blocks, while semantic whole-prompt or chunk-embedding matches are suspicious review events.
- Protected backend execution routes now require the shared bearer token. `/v1/intercept`, `/v1/translate`, `/v1/instruction-monitor/reviewed-adversarial`, and `/v1/ctf/sam-spade/*` reject unauthenticated requests.
- Browser callers no longer send backend runtime overrides for provider endpoints, model base URLs, backend-owned system prompts, responder, Sam Spade, or Lara translation. The Analyst Runtime Settings Safeguard API Key is the intentional exception: it is browser-memory-only and can be forwarded with Analyst Chat `/v1/intercept` requests for local LM Studio testing.
- The promoted Safeguard Effective Prompt is hardcoded in `DEFAULT_SYSTEM_CONFIG.safeguardEffectivePromptOverride`. Startup parsing normalizes blank values and previous app-generated baseline prompts back to the promoted default, so first-open/upgraded sessions should show the recommended and current hash as `590a286e60b99b0b353222b3ddaaa131db925a1f4d6222a0c3b1b3e49d203ad0` unless an operator saved a true custom prompt.
- Sam Spade sessions are owner-scoped by the authenticated caller id. Fetch/message/solve operations for another caller return not found or forbidden, and the frontend sends `x-counter-spy-user-id` through the shared backend API client.
- Firestore audit-log client creates now have a narrow rules allowlist and reject backend-owned security fields such as safeguard verdicts, gateway status, review state, and responder telemetry.
- Analyst Chat Last Execution Results now orders local verdict alert first, then backend safeguard status and Similarity Monitor detail, then `Detections` badges. Shared help/info icons are hidden while modal overlays are active except inside the open dialog content. Similarity Monitor evidence is also rendered from persisted `instructionSimilarity` data in the Prompt Details modal so it remains available after another prompt replaces the side rail. Stored hashes now include `Lookup`, backed by `/v1/instruction-monitor/records/:identifier`, and Active Guardrails includes a real Similarity Monitor toggle that sends `instructionSimilarityEnabled: false` when disabled.
- The Safeguard LLM may be disabled during feature testing. Feature-vector extraction must still run because it is calculated before any Safeguard LLM forwarding.
- Local review mode stores telemetry in memory. After a refresh, the Metrics card may show no feature-vector audit events until a new prompt is submitted.

## Feature Pressure Semantics

**Feature Pressure** is the operator-facing name for the analysis-only 0-100 score stored internally as `researchSignal` for backward compatibility.

- It is not an enforcement decision.
- It does not independently block, allow, or queue traffic.
- It is calculated from deterministic pre-inference evidence and persists on audit events when prompts are submitted.
- The Playground Feature Breakdown shows the current typed prompt live. If the editor is empty, it falls back to the latest submitted audit event with a feature vector.

The six normalized component pressures are:

| Component | Meaning |
| :--- | :--- |
| Instruction Pressure | Jailbreak-style control language such as ignore, override, system prompt, developer mode, or respond as. |
| Constraint Density | Concentration of control terms relative to prompt length. |
| Syntax / Wrapper Pressure | Unusual tags, brackets, wrappers, shell-like framing, special characters, and code-shaped prompt structure. |
| Obfuscation Pressure | Base64-like blobs, escape sequences, leetspeak, or other concealment bonuses. |
| Entropy Pressure | Max entropy window compared against the active entropy threshold. |
| N-Gram Signal | English trigram and Caesar-shift likelihood signal for alphabetic obfuscation. |

## Metrics Card Behavior

The Metrics view has a **Feature Pressure** card.

The Metrics view also rolls unreviewed `Suspicious` results into operational `Review` counts. This is display/workload aggregation only: audit records and detailed severity labels remain `Suspicious`, while the Alert Severity `Review` bucket, severity trend, and HITL Queue `Pending Review` count include those borderline items.

- `Avg Feature Pressure` is shown as `x / 100`.
- The six component rows are shown as average percentages across submitted prompts with feature vectors:
  - `Avg Instruction Pressure`
  - `Avg Constraint Density`
  - `Avg Syntax / Wrapper`
  - `Avg Obfuscation Pressure`
  - `Avg Entropy Pressure`
  - `Avg N-Gram Signal`
- `High Pressure Prompts` counts prompts with Feature Pressure >= 70.
- `Top Pressure Driver` is the most frequent top weighted driver across feature-vector audit events.
- The card no longer emphasizes Feature Sample count because every governed submission should now carry a feature vector.

## Important File Map

| Area | Files |
| :--- | :--- |
| Feature vector builder | `src/lib/promptFeatureVector.ts` |
| Feature vector types, snapshots, exports | `src/lib/playgroundMetrics.ts` |
| Playground Feature Breakdown | `src/components/SyntacticAnalyzer.tsx` |
| Metrics Feature Pressure card | `src/components/ThreatDashboard.tsx` |
| Audit-event feature vector attachment | `src/App.tsx` |
| English trigram / Caesar likelihood | `src/lib/languageLikelihood.ts` |
| Frontend deterministic sanitizer | `src/lib/sanitizer.ts` |
| Backend deterministic sanitizer | `backend/src/security/sanitizer.ts` |
| Safeguard orchestration and observability | `backend/src/server.ts` |
| Instruction similarity monitor | `backend/src/services/instruction-monitor/` |
| Protected backend API client | `src/lib/backendApi.ts` |
| Firestore audit-log create rules | `firestore.rules` |

## Safeguard Contract and Observability

The safeguard runtime contract is intentionally singular:

```json
{"verdict":"CLEAN|SUSPICIOUS|ADVERSARIAL","analystReasoning":"brief reason"}
```

Legacy decision-shaped responses such as `ALLOW_AND_FORWARD`, malformed JSON, or schema mismatches fail secure to `SUSPICIOUS` / `QUEUED`; they never default-allow.

Backend logs emit:

- `metric_increment` for `safeguard.schema` with shape `verdict`, `decision`, or `malformed`
- `metric_increment` for `safeguard.divergence` with `judgeVerdict`, `gatewayAction`, and `divergent`
- `safeguard_decision` with prompt hash, retry marker, response shape, judge verdict, gateway action, divergence boolean, optional raw reasoning trace, and latency
- `instruction_embedding_generated` with embedding model, runtime source, input count, dimensions, chunk count, and duration

## May 8 Security Remediation Validation

Focused validation added in `backend/test/securityRoutes.test.ts` covers:

- unauthenticated protected-route access fails for intercept, translate, and Sam Spade session creation
- client-supplied backend execution overrides are rejected by request schemas, except the allowlisted browser-memory Safeguard API Key for Analyst Chat local testing
- translation fails closed when backend Lara configuration is missing
- Sam Spade sessions are scoped to the authenticated caller and reject cross-user access

Latest local validation for this remediation:

- `npm run backend:test` passed: 128/128 tests
- `npm run lint` passed: frontend TypeScript plus backend typecheck

Firestore rules were tightened and statically reviewed in this session. A Firebase emulator rules test was not run in the local sandbox.

## Deterministic Detector Additions

The sanitizer now flags these structural jailbreak patterns:

| Flag | Behavior |
| :--- | :--- |
| `FORCED_PREFIX_INJECTION` | Opening instructions forcing the answer to start/begin/respond only with a required prefix. |
| `ANTI_SANITIZATION_CLAUSE` | Requests to avoid/disable sanitization, filters, moderation, warnings, disclaimers, or safety policies. |
| `PERSONA_INJECTION` | Persona assignment plus unrestricted-capability language. |
| `PAIRED_RESPONSE_INJECTION` | Dual approved/rejected, safe/unsafe, two-response, or opposite-response framing. Isolated hits are telemetry; paired with other jailbreak signals, route to review. |
| `ALLCAPS_PERSONA` | Signal-only telemetry for all-caps hyphenated persona handles. |
| `VERTICAL_TEXT` | Alphabetic vertical columns and `x - position N` rows are reflowed before detectors run; the signal itself routes to review/obfuscation handling. |
| `BINARY_ENCODING` | 8-bit binary payloads, including spaced bytes, continuous aligned blobs, and one-byte-per-line layouts. |
| `ASCII_DECIMAL` | Printable ASCII decimal byte lists, including recursive binary -> decimal wrapper payloads. |
| `A1Z26` | Alphabet-position encoding with optional `0` word-space markers and an English bigram plausibility gate. |
| `PIG_LATIN` | Signal-only detection by high non-common `ay`-suffix density; routes to review without attempting lossy decoding. |
| `SAFEGUARD_TIMEOUT` / `SAFEGUARD_ERROR` / `FAIL_SECURE` | Structured safeguard fail-secure states. Timeout/failure returns `SHIELD_ERROR`, marks records `PENDING_REVIEW`, and activates Global System Pause. |
| `instructionEmbeddingDurationMs` | Audit timing field for backend pgvector/Ollama embedding calls, surfaced in prompt details and Metrics embedding average/P95/sample count. |

Recognized decode/structural obfuscation remains strict: current policy treats known obfuscation signals as adversarial even before a concealed payload is proven to decode into a blocked phrase. Pig Latin is the current detect-and-review exception because decoding is ambiguous and lossy.

## Safeguard Timeout Boundary

- Backend safeguard calls use `SAFEGUARDS_TIMEOUT_MS`, default `30000`.
- The browser applies a 45s `/v1/intercept` abort as a second guard.
- Safeguard timeout/provider failure, including LM Studio API-token rejection, must not fall back to local inference.
- The fail-secure path emits `SHIELD_ERROR`, `SAFEGUARD_TIMEOUT` or `SAFEGUARD_ERROR`, and `FAIL_SECURE`, then queues the audit record and activates Global System Pause.

## Credit Card Redaction Boundary

- Generic 32-64 character hex strings are no longer treated as API keys.
- Credit-card redaction requires non-alphanumeric token boundaries, valid major-network lengths, issuer prefix checks, and Luhn validation.
- Long hashes, CIDs, transaction IDs, and hex payloads should remain intact for decoder inspection.

## Validation Snapshot

Last known checks for this work:

- `npm run test` passed with 112 tests after binary, ASCII decimal, A1Z26, Pig Latin, credit-card, and safeguard timeout/fail-secure changes.
- `npm run lint` passed.
- `git diff --check` passed.
- Docker demo stack includes backend, frontend, and pgvector Postgres. Recreate Postgres when a clean instruction database is needed.

## Docs Updated

The same behavior is also reflected in:

- `README.md`
- `Technical/SBOM.md`
- `Technical/ARCHITECTURE.md`
- `Technical/Technical_Specification.md`
- `Technical/LOCAL_DEVELOPMENT.md`
