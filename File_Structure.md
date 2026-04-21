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
│   │   ├── gemini.ts                     # ⚔️  Sword — Gemini 3 Flash inference integration
│   │   ├── metrics.ts                    # Telemetry aggregation & filtering logic
│   │   ├── policies.ts                   # Knowledge Base (MITRE ATLAS, System Config)
│   │   ├── sanitizer.ts                  # 🛡️  Shield — PII, Entropy, Regex & ReDoS engine
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
| ⚔️ **The Sword** | `src/lib/gemini.ts` | Primary inference engine — receives only the cleansed, governed payload from the Shield. |
| 📡 **The Radar** | `src/lib/anomalyDetector.ts` | Statistical anomaly engine — calculates real-time Z-Scores to detect coordinated automated attacks. |
| 🔒 **The Vault** | `firestore.rules` | Database-layer enforcement — ensures data integrity and PII privacy even if the client layer is compromised. |
| 📚 **The Manual** | `Technical/` + `Regulatory/` | Operational and assurance documentation — provides context for implementers, analysts, and compliance review. |
