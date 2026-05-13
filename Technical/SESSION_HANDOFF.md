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

### Phase 3 step 4 — retire Firestore (governance / system-config / users / KB policies) — PLAN FOR NEXT SESSION

> **User-verified scope (2026-05-13):** every editable surface stays — System Configuration dialog, blocked keywords / forbidden topics / regex rules, Policies tab (custom safeguard policies), HITL / Global Pause toggles, entropy + syntactic sliders, promote-to-KB workflow, user profile + role, golden set. We're moving where the data is stored (Firestore → Postgres), not removing functionality. **Auth-model decision is explicitly DEFERRED** (still on the user's plate after the data move lands).

**What still lives on Firestore today (post-Phase-3-step-3):**

| Firestore location | Shape (approximate) | Surface that edits it |
| :--- | :--- | :--- |
| `config/governance` doc | `{isHitlActive: boolean, isGlobalPause: boolean, entropyThreshold: number, syntacticThreshold: number}` | Metrics tab admin controls + sliders (`ThreatDashboard.tsx` lines ~510–602) |
| `config/system` doc | `SystemConfig` (see `App.tsx` near line ~289 — `safeguardEffectivePromptOverride`, `responderPrompt`, `samSpadePersonaPrompt`, `samSpadeScenarioPrompt`, plus blocked-keyword / forbidden-topic / regex-rule arrays, max context window, toggles, etc.) | System Configuration dialog (`App.tsx` line 3031 `setDoc(doc(db,'config','system'), normalizedConfig)`) |
| `users/{uid}` doc | `{uid, email, displayName, photoURL, role}` (role ∈ `'admin' \| 'developer'` per `parseUserProfile`) | Created at first login (`App.tsx` ~2198–2205); role updates via Profile UI |
| `knowledge_base/{policyId}` docs | Custom safeguard policies (the `POLICIES` shape in `src/lib/policies.ts` plus `isDefault: boolean, timestamp`) — name, category, prompt body, topics, keywords, regex rules | Policies tab — `handleSavePolicy` / `handleDeletePolicy` / `handleFileUpload` (`App.tsx` lines ~3060–3412) |
| `knowledge_base/golden-set` doc | "Promote to KB" canonical examples (one consolidated doc, not per-row) | Promote action on an audit row (`App.tsx` line ~2716 `doc(db, 'knowledge_base', 'golden-set')`) |
| `test/connection` doc | Trivial Firestore health-check ping at login (`App.tsx` line 534) | Auto — discard, not user-facing |

**Postgres schema (sketch).** Add to a new `backend/src/config/configStore.ts` (`app_config`), `backend/src/config/profileStore.ts` (`user_profiles`), `backend/src/config/policyStore.ts` (`kb_policies` + optional `kb_golden_set` row in policies or its own table — decide once `golden-set` shape is read in session):
```sql
CREATE TABLE IF NOT EXISTS app_config (
  key         text PRIMARY KEY,         -- 'governance', 'system'
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text                      -- caller uid of last writer (RBAC audit trail)
);

CREATE TABLE IF NOT EXISTS user_profiles (
  uid          text PRIMARY KEY,
  email        text,
  display_name text,
  photo_url    text,
  role         text NOT NULL DEFAULT 'developer'   -- 'admin' | 'developer' | future roles
              CHECK (role IN ('admin','developer','analyst','viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_policies (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  category     text,
  body         jsonb NOT NULL,                     -- prompt / topics / keywords / regex_rules / category-specific fields
  is_default   boolean NOT NULL DEFAULT false,     -- seeded from src/lib/policies.ts on first read of an empty table
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  promoted     boolean NOT NULL DEFAULT false       -- from the "promote to KB" workflow
);

-- Optional, depending on what knowledge_base/golden-set actually stores:
CREATE TABLE IF NOT EXISTS kb_golden_set (
  id           text PRIMARY KEY DEFAULT 'default',  -- single-row table OR per-example rows
  value        jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```
Connection-string resolution mirrors the existing audit-store: `APP_CONFIG_DATABASE_URL → DATABASE_URL → INSTRUCTION_MONITOR_DATABASE_URL`. Best-effort `initConfigStore()` at boot (same pattern as `initAuditStore`).

**Backend endpoints to add:**
- `GET|PUT /v1/governance` — single-doc shape; PUT is operator-only (route-handler check on `user_profiles.role === 'admin'`).
- `GET|PUT /v1/system-config` — single-doc shape; PUT operator-only.
- `GET|PUT /v1/users/me` — caller reads/writes their own profile only. Role mutations gated to admin (a separate `PUT /v1/users/:uid/role` is cleaner).
- `GET|POST|PATCH|DELETE /v1/policies` — list / create / update / delete custom policies. POST + PATCH + DELETE operator-only.
- `GET|PUT /v1/golden-set` (or fold into `/v1/policies` as a special id) — TBD on shape inspection.

**Suggested commit order (one per Firestore location, smallest → biggest):**

1. **Governance config** (`config/governance`). Tiny shape, two callers (`ThreatDashboard.tsx` ~510–602 read + 4 setDoc patches; `App.tsx` ~2260 setProfile-time read + ~2169 setDoc). Add `app_config` table, `GET|PUT /v1/governance`, `getGovernanceConfig()`/`setGovernanceConfig()` Zod clients, rewire both callers. This is the proving-ground commit — establishes the `app_config` pattern.

2. **System config** (`config/system`). Same `app_config` table, separate key. App.tsx ~2300 onSnapshot listener + ~3031 setDoc. Adds `GET|PUT /v1/system-config` + Zod clients. Rewire the System Configuration dialog onto the new endpoints. Drop the localStorage shadow if any (check `loadLocalSystemConfig`).

3. **User profiles** (`users/{uid}`). New `user_profiles` table + `GET|PUT /v1/users/me` (and admin-gated `PUT /v1/users/:uid/role` if the existing UI surfaces a role-change button). App.tsx ~2234 — replace `onSnapshot(doc(db,'users',uid), ...)` with a one-shot `GET /v1/users/me` + a localStorage cache (no real-time multi-tab profile-sync needed). This commit also exposes the role-check primitive the other endpoints' admin-only branches depend on.

4. **KB policies** (`knowledge_base/*` collection + the `knowledge_base/golden-set` doc). New `kb_policies` table. `GET|POST|PATCH|DELETE /v1/policies` (list / create / update / delete) + Zod clients. App.tsx `handleSavePolicy` / `handleDeletePolicy` / `handleFileUpload` / `handlePromoteToKB` rewires. Replace the `onSnapshot(collection(db,'knowledge_base'))` realtime listener with a one-shot `GET /v1/policies` on tab open + manual refresh (the Policies tab doesn't need sub-second multi-tab sync). Seed the default policy set from `src/lib/policies.ts` server-side on first empty-table read. The `golden-set` doc: inspect its actual shape during this commit and either add a `kb_golden_set` row in `kb_policies` (single id `'golden-set'`) or its own one-row table.

5. **Final cleanup**. After steps 1–4 land, no `setDoc`/`getDoc`/`onSnapshot`/`addDoc`/`updateDoc`/`deleteDoc` calls exist in `src/` against `db`. Then:
   - Remove the `test/connection` health-check ping from App.tsx (line 534).
   - Drop the `firebase/firestore` import from App.tsx + ThreatDashboard.tsx; `src/lib/firebase.ts` shrinks to **just the Auth piece** (sign-in + uid), pending the auth-model decision.
   - **Delete `firestore.rules`** — its per-user/per-field RBAC re-expressed as route-handler `role === 'admin'` checks + table column constraints (already in the schema above).
   - Update `CLAUDE.md`'s "Vault" line (currently calls Firestore the database-layer RBAC vault — that role moves to Postgres + route handlers).
   - Switch `docker-compose.demo.yml`'s Postgres from `tmpfs` to a durable named volume now that it holds **all** the long-lived data (config, policies, profiles, audit logs).

**Frontend rewire patterns (consistent across all 4 steps).** For each Firestore location:
- Add Zod-validated client(s) in `src/lib/backendApi.ts` next to the existing `appendAuditLog`/`listAuditLogs`/etc. pattern.
- Replace `onSnapshot` realtime listeners with one-shot `GET` + a focused polling effect ONLY where multi-tab sync matters (governance config is the only one that probably wants 5s polling, since multiple analysts could be flipping HITL).
- Replace `setDoc`/`addDoc`/`updateDoc`/`deleteDoc` with the corresponding `PUT`/`POST`/`PATCH`/`DELETE` client.
- Keep `localReviewMode` working: localStorage fallback for config/system when Firebase auth is bypassed (current behavior — already handled by `loadLocalSystemConfig`).
- For role-gated writes (admin-only), the client just calls the endpoint and surfaces the 403 if the backend rejects — don't duplicate the role check on the client (defense-in-depth: backend is authoritative).

**Backend tests to add (per step):**
- `backend/test/configStore.test.ts` — pure-function coverage for the app-config store.
- `backend/test/policyStore.test.ts` — CRUD over kb_policies, default seeding.
- `backend/test/profileStore.test.ts` — get/put + role-update guard.
- Route-level tests in `securityRoutes.test.ts` for each endpoint: 401 no bearer, 403 non-admin writes where applicable, 400 bad body, 503 store-unconfigured (same shape as the existing metrics-aggregate tests).

**Out of scope for this step:**
- Auth-model decision (Firebase keep-and-verify-ID-token vs. backend-owned login vs. status-quo bearer-token). Discuss when the data move is done.
- The CTF iframe's safeguard-prompt postMessage bridge can stay; **after** step 4 lands the system config in Postgres, that bridge becomes redundant (the CTF backend can read the operator's effective prompt directly from `app_config`), but removing it is a follow-up not a prerequisite.

**Validation per commit:**
- `npm run lint` + `npm run backend:test` (will grow from 98 by new tests).
- `npm run build` (Vite client + ssr).
- `docker compose up -d --build counter-spy-backend` against the demo stack.
- Curl smoke against each new endpoint (matching the audit-logs smoke pattern in step 2's writeup).
- UI spot-check of the corresponding tab in the browser.

**Branch state on entering this work:** `feat/server-hosted-app` at `59adca9` (Phase 3 step 3). Working tree clean modulo the user's untracked `Technical/PLATFORM_ROADMAP.md`. Demo stack containers are running; `docker compose -f docker-compose.demo.yml ps` confirms gateway healthy.

### Monorepo source split (npm workspaces) — PLANNED for next session

> **Context (2026-05-13):** Today's session completed Phase 3 step 4 commits 1 + 2 (governance + system config moved to Postgres) AND a network-level decoupling of the Sam Spade CTF from the gateway (commit `d0c24df`). With the gateway and sam-spade-service now running on independent ports with no proxy, the user asked whether the two are "still on the same container" — and yes, at the **source level** they still share `backend/Dockerfile`, `backend/src/**`, `package.json`, and `node_modules`. Any change in one forces an image rebuild of the other. The next decoupling axis is source.
>
> User-chosen approach (2026-05-13): **monorepo with npm workspaces**, executed **before** the rest of Phase 3 step 4 (user profiles + KB policies + cleanup) so those land on the cleaner two-service shape.

**Target structure:**
```
counter-spy-claude.ai/
├── package.json                       # workspaces: ["packages/*", "services/*"]
├── packages/
│   └── backend-shared/                # @counter-spy/backend-shared (both services)
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── security/sanitizer.ts
│           ├── security/safeguardDefaults.ts
│           ├── security/urlGuard.ts
│           ├── middleware/rateLimit.ts
│           ├── telemetry.ts
│           └── index.ts
├── services/
│   ├── gateway/                       # @counter-spy/gateway
│   │   ├── Dockerfile                 # replaces backend/Dockerfile (gateway role)
│   │   ├── package.json               # deps: backend-shared workspace:*, express, pg, firebase-admin?, etc.
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── server.ts              # gateway routes only
│   │       ├── analysis/*             # 8 files
│   │       ├── audit/auditStore.ts
│   │       ├── config/configStore.ts
│   │       ├── ctf/reviewArtifactStore.ts
│   │       ├── services/instruction-monitor/*
│   │       └── web/ssr.ts
│   └── sam-spade/                     # @counter-spy/sam-spade
│       ├── Dockerfile                 # new, sam-spade-specific
│       ├── package.json               # deps: backend-shared workspace:*, express, better-sqlite3, etc.
│       ├── tsconfig.json
│       └── src/
│           ├── server.ts              # sam-spade routes only
│           └── services/sam-spade/*   # 5 files (session store, service.ts, types, config)
├── src/                               # Frontend (analyst console) — unchanged
├── ctf-frontend/                      # CTF UI — unchanged
└── (backend/ deleted at the end)
```

**Inventory (validated by `grep -E "^import .* from '\./(...)" backend/src/server.ts`):**

| Module in `backend/src/...` | Destination |
| :--- | :--- |
| `security/sanitizer.ts` | `packages/backend-shared/src/security/` |
| `security/safeguardDefaults.ts` | `packages/backend-shared/src/security/` |
| `security/urlGuard.ts` | `packages/backend-shared/src/security/` |
| `middleware/rateLimit.ts` | `packages/backend-shared/src/middleware/` |
| `telemetry.ts` | `packages/backend-shared/src/` |
| `analysis/*` (8 files) | `services/gateway/src/analysis/` |
| `audit/auditStore.ts` | `services/gateway/src/audit/` |
| `config/configStore.ts` | `services/gateway/src/config/` |
| `ctf/reviewArtifactStore.ts` | `services/gateway/src/ctf/` |
| `services/instruction-monitor/*` (7 files) | `services/gateway/src/services/instruction-monitor/` |
| `web/ssr.ts` | `services/gateway/src/web/` |
| `services/sam-spade/*` (5 files) | `services/sam-spade/src/services/sam-spade/` |

**Shared boilerplate currently in `server.ts`** (needs a decision per commit):
- Express setup, CORS middleware, JSON body parser
- Bearer auth middleware (`requireBackendAuth`)
- Caller ID extractor (`getAuthenticatedCallerId`)
- Request ID + structured logger
- `/healthz` handler
- 404 handler
- Env loading (`EnvSchema`)

**Decision:** put auth helpers + logger + the env schema in `backend-shared` (~100 lines of helpers). Each service's `server.ts` instantiates its own Express app, applies the shared middleware, then registers its own routes. Duplication of the 30-line Express setup boilerplate is acceptable.

**Commit sequence:**

#### Commit 1: workspaces scaffold (no behavior change)
- Add `"workspaces": ["packages/*", "services/*"]` to root `package.json`.
- Create `packages/backend-shared/package.json` (empty stub: `name: "@counter-spy/backend-shared"`, `version: "0.1.0"`, `type: "module"`).
- Create `services/gateway/package.json` and `services/sam-spade/package.json` stubs.
- Run `npm install` — verify workspaces resolve.
- **Verify:** `npm run lint` + `npm run backend:test` (existing `backend/**` untouched, all 108 tests still green) + the demo stack still runs.

#### Commit 2: move shared modules into `backend-shared`
- `git mv backend/src/security/* packages/backend-shared/src/security/`
- `git mv backend/src/middleware/rateLimit.ts packages/backend-shared/src/middleware/rateLimit.ts`
- `git mv backend/src/telemetry.ts packages/backend-shared/src/telemetry.ts`
- Author `packages/backend-shared/src/index.ts` re-exporting all symbols.
- Update `backend/src/server.ts` imports: `'./security/sanitizer.js'` → `'@counter-spy/backend-shared/security/sanitizer'` (or via the index re-export — decide once we see whether TS path resolution prefers one form).
- Update `backend/test/*.ts` imports to `@counter-spy/backend-shared`.
- Add `"exports"` to `backend-shared/package.json` mapping the sub-paths.
- For the dev/tsx path: rely on tsconfig `paths` for source-to-source resolution. For the prod/tsc path: backend-shared compiles its own `dist/` and the `exports` field points at `dist/*.js`.
- Add `packages/backend-shared/tsconfig.json` (minimal — `tsc -p` builds to `dist/`).
- Add `"build"` script to `backend-shared/package.json`.
- Update root `tsconfig` (or backend's) to add `paths` so existing tooling still resolves.
- **Verify:** `npm run lint` + `npm run backend:test` (108 still green) + `npm run backend:build` (compiles both backend-shared AND backend) + demo stack rebuild + smoke test.

#### Commit 3: extract `services/sam-spade`
- Create `services/sam-spade/package.json` (deps: `@counter-spy/backend-shared: "workspace:*"`, `express`, `better-sqlite3`, `zod`, the ones sam-spade actually uses).
- Create `services/sam-spade/tsconfig.json` (extends base; emits to `dist/`).
- Create `services/sam-spade/Dockerfile` (modeled on `backend/Dockerfile` but only compiles backend-shared + services/sam-spade).
- `git mv backend/src/services/sam-spade/* services/sam-spade/src/services/sam-spade/`
- Author `services/sam-spade/src/server.ts` — extract the sam-spade routes from `backend/src/server.ts` (the four `/v1/ctf/sam-spade/*` route handlers + their imports). Use the shared middleware from backend-shared.
- Update `docker-compose.demo.yml` `counter-spy-sam-spade-service` to build from `services/sam-spade/Dockerfile`.
- Move/update `backend/test/samSpade*.test.ts` to `services/sam-spade/test/`.
- **Verify:** `npm run lint` + service test (`npm run test --workspace=@counter-spy/sam-spade` or equivalent) + demo rebuild + smoke against `:18120` (session, message, solve all work).

#### Commit 4: extract `services/gateway` + delete `backend/`
- Create `services/gateway/package.json` (deps: `@counter-spy/backend-shared: "workspace:*"`, `express`, `pg`, etc.).
- Create `services/gateway/tsconfig.json`.
- Create `services/gateway/Dockerfile` (compiles backend-shared + services/gateway + runs vite client+ssr build for the analyst console).
- `git mv backend/src/{analysis,audit,config,ctf,web} services/gateway/src/`
- `git mv backend/src/services/instruction-monitor services/gateway/src/services/instruction-monitor`
- Author `services/gateway/src/server.ts` — what's left of `backend/src/server.ts` after sam-spade extraction (all the gateway routes + SSR mount).
- Update `docker-compose.demo.yml` `counter-spy-backend` to build from `services/gateway/Dockerfile`.
- Move/update gateway-side tests to `services/gateway/test/`.
- **Delete** `backend/` entirely.
- Update root `package.json` scripts: `npm run backend:dev` → `npm run dev --workspace=@counter-spy/gateway`, etc.
- **Verify:** lint + tests + builds + demo rebuild + full smoke (all `/v1/*` paths + analyst console SSR + sam-spade still works via `:18120`).

#### Commit 5: docs + final polish
- Update `CLAUDE.md`: the "File map" section, the architecture table, the security-critical file paths (now `packages/backend-shared/src/security/sanitizer.ts` etc.).
- Update `Technical/ARCHITECTURE.md` with the new monorepo layout.
- Update `Technical/LOCAL_DEVELOPMENT.md` with the new dev commands.
- Update `Technical/SBOM.md` — each service now has its own `package.json` so the SBOM needs three entries (root frontend + backend-shared + gateway + sam-spade).
- Update `File_Structure.md` to mirror the new tree.
- Update `.env.example` if any new env vars surface.
- **Verify:** `git ls-files | grep backend/` returns nothing; `docker compose up --build` builds all three images independently; touching `packages/backend-shared/src/security/sanitizer.ts` rebuilds both service images but touching `services/gateway/src/audit/auditStore.ts` only rebuilds the gateway image.

**Risks / open questions:**
- npm workspaces + `exports` field + TS path resolution can interact weirdly. The fallback is tsconfig `paths` everywhere. May need a couple of iterations in commit 2 to find a setup that works in both `tsx` (dev) and `tsc → node` (prod).
- The current `backend/tsconfig.json` is shared between dev and prod. Splitting into multiple service tsconfigs needs care to keep `--noEmit` lint working (one `tsc --noEmit` per workspace, called from root).
- Test ordering: `npm run backend:test` currently uses `backend/test/*.test.ts`. After the split, tests will live under each workspace. The root `test` script needs to fan out (or use `npm run test --workspaces`).
- The `instructionMonitor:seed:core` + `instructionMonitor:export:core` scripts currently run via `tsx backend/src/services/instruction-monitor/seed-core.ts`. They become workspace-scoped.

**Branch state on entering this work:** `feat/server-hosted-app` at `d0c24df` (network-level CTF decouple). Working tree clean modulo `Technical/PLATFORM_ROADMAP.md` untracked. Demo stack running; gateway + sam-spade-service + ctf-frontend all healthy at `:18080`, `:18120`, `:3001`.

**After this work lands, resume the rest of Phase 3 step 4** (user profiles → KB policies → cleanup) against the new `services/gateway` shape. The remaining touchpoints are gateway-only, so those commits get smaller.

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
