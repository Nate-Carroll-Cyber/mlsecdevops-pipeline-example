## 🗂️ Repository Structure

Counter-Spy.ai is an npm workspaces monorepo. The React analyst console (`src/`) is built and **server-rendered** by the gateway service; all sanitization/analysis runs server-side in either `packages/backend-shared/` (shared primitives) or `services/gateway/` (gateway-only logic). The Sam Spade CTF surface is its own service.

```
counter-spy.ai/
│
├── 📚 Technical/                         # Engineering & implementation documentation
│   ├── ADVERSARIAL_PROMPT_ANALYSIS.md    # Research and evaluation plan
│   ├── ARCHITECTURE.md                   # Technical specs (Shield-and-Sword pattern & heuristics)
│   ├── LOCAL_DEVELOPMENT.md              # Local dev and Docker workflow
│   ├── MITRE_ATLAS_MAPPING.md            # Threat taxonomy mapping
│   ├── SAM_SPADE_API_CONTRACT.md         # Sam Spade backend contract
│   ├── SAM_SPADE_CTF_INTEGRATION.md      # Sam Spade integration design
│   ├── SBOM.md                           # Technical software bill of materials
│   └── Technical_Specification.md        # Deep technical reference
│
├── 🏛️ Regulatory/                       # Compliance, assurance, and trust materials
│   ├── ANALYST_GUIDE.md                  # SOPs for SOC personnel (HITL/HOTL workflows)
│   ├── EU_AI_Act_Mapping.md              # EU AI Act compliance mapping
│   ├── Model_Card.md                     # Model reference and risk notes
│   └── Threat_Model.md                   # Threat model narrative
│
├── 💻 src/                               # Analyst console (React 19 + Vite SSR)
│   ├── components/                       # Reusable React Components
│   │   ├── ui/                           # Hardened Shadcn UI Primitives
│   │   │   ├── alert.tsx                 # Crimson alert banners (DEFCON 1 state)
│   │   │   ├── badge.tsx                 # Severity & FN (False Negative) indicators
│   │   │   ├── button.tsx                # Interactive controls
│   │   │   ├── card.tsx                  # Layout containers for metrics & logs
│   │   │   ├── dialog.tsx                # Full Prompt Inspection modals
│   │   │   ├── dropdown-menu.tsx         # Analyst reclassification controls
│   │   │   ├── input.tsx                 # Standard text inputs
│   │   │   ├── scroll-area.tsx           # Scroll containers for high-volume log views
│   │   │   ├── separator.tsx             # Visual layout dividers
│   │   │   ├── sonner.tsx                # Toast notifications for system events
│   │   │   ├── switch.tsx                # Guardrail & Kill Switch toggles
│   │   │   ├── tabs.tsx                  # Primary navigation (Chat · Logs · Metrics · KB)
│   │   │   └── textarea.tsx              # Auto-resizing chat input
│   │   ├── HelpTooltip.tsx               # Shared overlay-aware help icon
│   │   ├── SyntacticAnalyzer.tsx         # Real-time complexity visualization
│   │   ├── ThemeProvider.tsx             # Dark mode & Geist typography context
│   │   ├── ThemeToggle.tsx               # UI theme switcher
│   │   └── ThreatDashboard.tsx           # Anomaly detection & Z-Score charting
│   │
│   ├── 🧠 lib/                           # Browser-side helpers (analysis stays server-side)
│   │   ├── analysisTypes.ts              # Zod/TS types shared with /v1/analyze* responses
│   │   ├── atlasTaxonomy.ts              # MITRE ATLAS organizer taxonomy for labeling
│   │   ├── backendApi.ts                 # Backend gateway client for /v1/intercept, /v1/analyze*, responder, CTF, translate
│   │   ├── devLog.ts                     # devLog/devWarn — no-ops in production builds
│   │   ├── firebase.ts                   # Firestore & Auth (client-only, lazy, SSR-inert)
│   │   ├── gemini.ts                     # Disabled browser stub (kept for legacy references)
│   │   ├── playgroundMetrics.ts          # Browser-local Playground/Bulk metric records
│   │   ├── policies.ts                   # Knowledge Base (MITRE ATLAS, System Config, MCP/A2A)
│   │   ├── translate.ts                  # Browser-side glue for /v1/translate
│   │   ├── utils.ts                      # Tailwind merging & shared helpers
│   │   └── webTelemetry.ts               # Optional browser OpenTelemetry (dynamic import; no-op unless VITE_OTEL_EXPORTER_OTLP_ENDPOINT is set)
│   │
│   ├── App.tsx                           # Application shell & state orchestration
│   ├── entry-client.tsx                  # React hydration entry (browser)
│   ├── entry-server.tsx                  # React SSR entry (renderToString)
│   ├── index.css                         # Global styles & Tailwind CSS 4 configuration
│   └── *.d.ts                            # React DOM client/server type shims
│
├── 📦 packages/                          # npm workspace: shared backend code
│   └── backend-shared/                   # @counter-spy/backend-shared
│       ├── src/
│       │   ├── security/
│       │   │   ├── sanitizer.ts          # 🛡️ Shield — PII, entropy, regex, forbidden-phrase, ReDoS engine
│       │   │   ├── urlGuard.ts           # SSRF egress guard (validates outbound provider base URLs)
│       │   │   └── safeguardDefaults.ts  # DEFAULT_SAFEGUARD_EFFECTIVE_PROMPT fallback for CTF surface
│       │   ├── middleware/
│       │   │   └── rateLimit.ts          # Fixed-window limiter (bearer-token / IP keyed)
│       │   ├── providers/
│       │   │   ├── openaiCompat.ts       # Shared OpenAI-compatible request shapes
│       │   │   ├── responderClient.ts    # Downstream responder client
│       │   │   └── safeguardClient.ts    # Safeguard judge client (timeout-bounded, fail-secure)
│       │   ├── prompts/
│       │   │   └── samSpadeDefaults.ts   # Sam Spade persona/scenario prompts (backend-owned)
│       │   ├── auth.ts                   # requireBackendAuth (bearer-token validation)
│       │   ├── observability.ts          # Structured log() helper + metric_increment
│       │   ├── telemetry.ts              # 📈 Glass — OpenTelemetry SDK bootstrap (OTLP/HTTP)
│       │   └── index.ts                  # Public barrel
│       ├── tsconfig.json
│       └── package.json
│
├── ⚙️ services/                          # npm workspace: deployable backend services
│   ├── gateway/                          # @counter-spy/gateway
│   │   ├── src/
│   │   │   ├── server.ts                 # ⚔️ Sword — /v1/intercept, /v1/analyze*, /v1/translate, SSR, instruction-monitor, CTF review-artifacts
│   │   │   ├── analysis/                 # 🔬 Lab — server-side analysis engines
│   │   │   │   ├── anomalyDetector.ts    # Statistical engine (Z-Score, rolling baselines)
│   │   │   │   ├── languageLikelihood.ts # English/foreign-language likelihood scoring
│   │   │   │   ├── metrics.ts            # Audit-log metrics aggregation
│   │   │   │   ├── obfuscation.ts        # Obfuscation lab (~24 transforms)
│   │   │   │   ├── promptFeatureVector.ts# Feature vector / Feature Pressure scoring
│   │   │   │   ├── sanitizerNormalization.ts # Shared normalization helpers
│   │   │   │   ├── spellNormalize.ts     # Heuristic spell-normalization
│   │   │   │   └── syntacticAnalyzer.ts  # Syntactic complexity scoring (Suspicious > 50, Adversarial > 90)
│   │   │   ├── audit/auditStore.ts       # Postgres-backed audit log store
│   │   │   ├── config/configStore.ts     # Governance / system config store
│   │   │   ├── ctf/                      # CTF review-artifact store
│   │   │   │   ├── reviewArtifactStore.ts# SQLite-backed CTF review artifacts (gateway-owned)
│   │   │   │   └── types.ts
│   │   │   ├── services/instruction-monitor/ # pgvector instruction-similarity monitor
│   │   │   │   ├── config.ts
│   │   │   │   ├── service.ts
│   │   │   │   ├── fingerprint.ts        # SHA-256/loose/SimHash fingerprinting
│   │   │   │   ├── seed-core.ts          # `core` seed importer CLI
│   │   │   │   ├── export-core.ts        # Reviewed-adversarial exporter CLI
│   │   │   │   ├── types.ts
│   │   │   │   └── index.ts
│   │   │   └── web/ssr.ts                # SSR helper (React renderToString → HTML)
│   │   ├── test/                         # Gateway test suite (node --test)
│   │   ├── Dockerfile                    # Gateway image (also builds Vite client+SSR)
│   │   ├── docker-entrypoint.sh          # su-exec entrypoint
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── sam-spade/                        # @counter-spy/sam-spade — standalone CTF service
│       ├── src/
│       │   ├── server.ts                 # /healthz + /v1/ctf/sam-spade/* on SAM_SPADE_SERVICE_PORT
│       │   └── services/sam-spade/
│       │       ├── config.ts             # SAM_SPADE_* env validation
│       │       ├── service.ts            # Session/message/solve handlers
│       │       ├── store.ts              # SQLite session store (WAL, Zod-validated reads)
│       │       ├── types.ts
│       │       └── index.ts
│       ├── test/                         # Sam Spade test suite
│       ├── Dockerfile                    # Sam Spade image (backend-shared + services/sam-spade only)
│       ├── tsconfig.json
│       └── package.json
│
├── 🎭 ctf-frontend/                      # Standalone noir CTF Vite SPA (not a workspace; own lockfile)
│
├── 🐳 docker-compose.demo.yml            # Demo stack: gateway + sam-spade-service + ctf-frontend + postgres + otel
├── 🐳 docker-compose.sam-spade.yml       # Standalone sam-spade-service (profile: sam-spade)
├── 🐳 Dockerfile.ctf-frontend            # CTF frontend image (Vite dev today; production build is a Phase-4 follow-up)
│
├── otel/                                 # OpenTelemetry collector config for the demo stack
├── seeds/pgvector/                       # Instruction-monitor seed snapshots (`core.json`, etc.)
├── infra/                                # CloudFormation templates (target AWS deployment)
│
├── .env.example                          # Template for required environment variables
├── .gitignore                            # Version control exclusion rules
├── components.json                       # Shadcn UI configuration
├── firebase-applet-config.json           # Firebase project credentials
├── firebase-blueprint.json               # Firestore IR (Intermediate Representation)
├── firestore.rules                       # 🔒 Hardened RBAC & data validation rules
├── index.html                            # HTML entry point (Vite dev / client build)
├── metadata.json                         # App metadata & frame permissions
├── package.json                          # Root workspaces manifest (frontend deps + workspace orchestration scripts)
├── README.md                             # Project overview & documentation hub
├── tsconfig.json                         # TypeScript compiler configuration
└── vite.config.ts                        # Vite build & dev server configuration
```

---

## 🏛️ Key Architectural Components

| Nickname | File | Role |
| :--- | :--- | :--- |
| 🛡️ **The Shield** | `packages/backend-shared/src/security/sanitizer.ts` | Deterministic sanitization engine — intercepts all adversarial payloads server-side before any safeguard or responder call. Shared by both backend services. |
| 🔬 **The Lab** | `services/gateway/src/analysis/*.ts` | Gateway-only analysis engines: syntactic complexity, prompt feature vectors, language likelihood, obfuscation lab, anomaly detection, metrics aggregation, spell normalization. |
| ⚔️ **The Sword** | `services/gateway/src/server.ts` + `services/sam-spade/src/server.ts` + `src/lib/backendApi.ts` | Backend-mediated inference path — local sanitizer, OpenAI-compatible safeguard judge, downstream responder, Sam Spade CTF persona/scenario handoff, and governed intercept result handling. |
| 🕵️ **The Case File** | `services/sam-spade/` + `services/gateway/src/ctf/reviewArtifactStore.ts` + `ctf-frontend/` | Sam Spade CTF session, review, and gameplay gatekeeping. The standalone `@counter-spy/sam-spade` service owns `/v1/ctf/sam-spade/*` and its SQLite session store; the noir UI is the standalone `ctf-frontend/` Vite app, which posts review artifacts to the gateway's `/v1/ctf/review-artifacts` (durable across gateway restarts) so the main frontend's Sam Spade tab can mirror CTF activity into Audit/Metrics. |
| 🚧 **The Bulkhead** | `packages/backend-shared/src/middleware/rateLimit.ts` + `packages/backend-shared/src/security/urlGuard.ts` | Edge hardening — fixed-window rate limiter (bearer-token/IP keyed) and the SSRF egress guard. Both shared between gateway and sam-spade. |
| 📈 **The Glass** | `packages/backend-shared/src/telemetry.ts` + `otel/collector-config.yaml` | OpenTelemetry bootstrap (traces/metrics/logs over OTLP) imported first by both service entry points, plus the demo-stack collector config. |
| 📡 **The Radar** | `services/gateway/src/analysis/anomalyDetector.ts` + `services/gateway/src/analysis/metrics.ts` | Statistical anomaly engine and confusion-matrix metrics over the audit-log store. |
| 🔒 **The Vault** | `firestore.rules` | Database-layer enforcement — ensures data integrity and PII privacy even if the client layer is compromised. |
| 📚 **The Manual** | `Technical/` + `Regulatory/` | Operational and assurance documentation — provides context for implementers, analysts, and compliance review. |
