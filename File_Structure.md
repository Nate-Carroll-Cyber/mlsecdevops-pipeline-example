## 🗂️ Repository Structure

```
counter-spy.ai/
│
├── 📚 docs/                              # Platform Documentation
│   ├── ANALYST_GUIDE.md                  # SOPs for SOC personnel (HITL/HOTL workflows)
│   └── ARCHITECTURE.md                   # Technical specs (Shield-and-Sword pattern & heuristics)
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
├── SBOM.md                               # Software Bill of Materials & CVE mitigations
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
| 📚 **The Manual** | `docs/` | Operational documentation — provides context for both technical implementers and SOC analysts. |
