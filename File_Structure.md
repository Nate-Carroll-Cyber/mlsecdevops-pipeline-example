## 🗂️ Repository Structure

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
├── 💻 src/                               # Application Source Code
│   │
│   ├── components/                       # Reusable React Components
│   │   │
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
│   │   │
│   │   ├── SyntacticAnalyzer.tsx         # Real-time complexity visualization
│   │   ├── ThemeProvider.tsx             # Dark mode & Geist typography context
│   │   ├── ThemeToggle.tsx               # UI theme switcher
│   │   └── ThreatDashboard.tsx           # Anomaly detection & Z-Score charting
│   │
│   ├── 🧠 lib/                           # Core Logic & Security Engines
│   │   ├── anomalyDetector.ts            # Statistical engine (Z-Score, rolling baselines)
│   │   ├── firebase.ts                   # Firestore & Auth initialization
│   │   ├── backendApi.ts                 # Backend gateway client for intercept, responder, CTF, translation, and governed 403 result handling
│   │   ├── gemini.ts                     # Legacy deterministic fallback helpers retained for local/demo paths
│   │   ├── metrics.ts                    # Telemetry aggregation & filtering logic
│   │   ├── playgroundMetrics.ts          # Browser-local Playground/Bulk metric records, including backend safeguard attribution fields
│   │   ├── policies.ts                   # Knowledge Base (MITRE ATLAS, System Config)
│   │   ├── sanitizer.ts                  # 🛡️  Shield — PII, entropy, regex, forbidden phrase & ReDoS engine
│   │   ├── sanitizerLanguage.ts          # Local language/translation policy helpers
│   │   ├── sanitizerNormalization.ts     # Shared normalization and canonicalization helpers
│   │   ├── sanitizerObfuscation.ts       # Obfuscation-family detection helpers
│   │   ├── syntacticAnalyzer.ts          # Heuristic complexity scoring logic
│   │   └── utils.ts                      # Tailwind merging & shared helpers
│   │
│   ├── App.tsx                           # Application shell & state orchestration
│   ├── index.css                         # Global styles & Tailwind CSS 4 configuration
│   └── main.tsx                          # React entry point
│
├── .env.example                          # Template for required environment variables
├── .gitignore                            # Version control exclusion rules
├── components.json                       # Shadcn UI configuration
├── firebase-applet-config.json           # Firebase project credentials
├── firebase-blueprint.json               # Firestore IR (Intermediate Representation)
├── firestore.rules                       # 🔒 Hardened RBAC & data validation rules
├── index.html                            # HTML entry point
├── metadata.json                         # App metadata & frame permissions
├── package.json                          # Dependency manifest (pinned versions)
├── README.md                             # Project overview & documentation hub
├── tsconfig.json                         # TypeScript compiler configuration
└── vite.config.ts                        # Vite build & dev server configuration
```

---

## 🏛️ Key Architectural Components

| Nickname | File | Role |
| :--- | :--- | :--- |
| 🛡️ **The Shield** | `src/lib/sanitizer.ts` | Local sanitization engine — intercepts all adversarial payloads before any external API call is initiated. |
| ⚔️ **The Sword** | `backend/src/server.ts` + `src/lib/backendApi.ts` | Backend-mediated inference path — local sanitizer, OpenAI-compatible safeguard judge, downstream responder, Sam Spade CTF persona/scenario handoff, and governed intercept result handling. |
| 🕵️ **The Case File** | `backend/src/services/sam-spade/` + `ctf-frontend/` | Sam Spade CTF session, review, and gameplay gatekeeping — clean turns reach the responder, while sensitive/adversarial turns are masked as `Bad content.` and routed to audit review. The backend image runs this surface as its own container via `COUNTER_SPY_ROLE=sam-spade` (a gateway delegates `/v1/ctf/sam-spade/*` to it through `SAM_SPADE_SERVICE_URL`); the noir UI is the standalone `ctf-frontend/` Vite app, which posts review artifacts to `/v1/ctf/review-artifacts` so the main frontend (when `VITE_CTF_FRONTEND_URL` is set) embeds it and mirrors CTF activity into Audit/Metrics. |
| 🚧 **The Bulkhead** | `backend/src/middleware/rateLimit.ts` + `backend/src/security/urlGuard.ts` | Edge hardening — fixed-window rate limiter (bearer-token/IP keyed) and the SSRF egress guard that validates every outbound provider base URL. |
| 📈 **The Glass** | `backend/src/telemetry.ts` + `otel/collector-config.yaml` | OpenTelemetry bootstrap (traces/metrics/logs over OTLP) and the demo-stack collector config. |
| 📡 **The Radar** | `src/lib/anomalyDetector.ts` | Statistical anomaly engine — calculates real-time Z-Scores to detect coordinated automated attacks. |
| 🔒 **The Vault** | `firestore.rules` | Database-layer enforcement — ensures data integrity and PII privacy even if the client layer is compromised. |
| 📚 **The Manual** | `Technical/` + `Regulatory/` | Operational and assurance documentation — provides context for implementers, analysts, and compliance review. |
