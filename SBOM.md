# Software Bill of Materials (SBOM) - Counter-Spy.ai

**Project Name:** Counter-Spy.ai  
**Version:** 1.9.16 (Translation UX & Backend Readiness Pass)  
**Date Generated:** 2026-04-18  
**Compliance Level:** Internal Security Governance

## 📦 Core Dependencies

| Package | Version | Description |
| :--- | :--- | :--- |
| `react` | `~19.0.4` | Frontend UI Library (Pinned to ~19.0.4 to mitigate CVE-2025-55182 & CVE-2026-23864 while allowing patches) |
| `firebase` | `^12.12.0` | Backend as a Service (Auth, Firestore). Verified `@firebase/auth` resolves to `1.13.0` (mitigates CVE-2024-11023). |
| `@google/genai` | `^1.48.0` | Transitional Google Gemini SDK dependency retained from the original AI Studio alpha; browser-side inference is disabled pending backend-only provider integration |
| `motion` | `^12.23.24` | Animation and Layout Engine |
| `lucide-react` | `^0.546.0` | Icon Library |
| `react-markdown` | `^10.1.0` | Markdown Rendering (rehype-raw disabled to prevent XSS) |
| `sonner` | `^2.0.7` | Toast Notifications |
| `zod` | `^4.3.6` | Schema Validation |
| `clsx` | `^2.1.1` | Conditional Class Utilities |
| `recharts` | `^3.8.1` | Composable Charting Library (used for threat velocity visualization) |
| `class-variance-authority` | `^0.7.1` | CSS Class Variance Management |
| `tailwind-merge` | `^3.5.0` | Tailwind Class Merging |
| `next-themes` | `^0.4.6` | Theme Management (Dark Mode) |
| `@fontsource-variable/geist` | `^5.2.8` | Geist Variable Font |
| `express` | `^5.2.1` | Web Server Framework |
| `dotenv` | `^17.2.3` | Environment Variable Management (Known Risk: Planned migration to AWS Secrets Manager for production) |
| `tw-animate-css` | `^1.4.0` | Tailwind Animation Utilities |
| `@base-ui/react` | `^1.3.0` | Unstyled UI Components |

## 🖼️ Static Brand Assets

| Asset | Path | SHA-256 | Description |
| :--- | :--- | :--- | :--- |
| Counter-Spy.ai shield logo | `public/brand/counter-spy-shield.png` | `7abebd606cf61fe88fd8c7e2ba2e318671c18031f21dd00430bb2e0fe11fc4f9` | Cropped/resized display asset used in app chrome, login, and empty chat state. |
| Counter-Spy.ai shield logo source | `public/brand/counter-spy-shield-original.png` | `daf2935ce4182227c8c55238b19a64cea1b3de519c868011241c5f9d84fd5b9b` | Original user-provided PNG preserved for brand provenance and future derivative assets. |

## 🛠️ Build & Development Tools

| Package | Version | Description |
| :--- | :--- | :--- |
| `vite` | `^8.0.5` | Frontend Build Tool (Upgraded to 8.x to mitigate CVE-2026-39363, GHSA-v2wj-q39q-566r, and GHSA-4w7w-66w2-5vf9) |
| `typescript` | `~5.8.2` | Static Type Checking |
| `tailwindcss` | `^4.1.14` | Utility-first CSS Framework |
| `tsx` | `^4.21.0` | TypeScript Execution Engine |
| `autoprefixer` | `^10.4.21` | CSS Vendor Prefixing |
| `shadcn` | `^4.2.0` | UI Component CLI (Moved to devDependencies) |

## 🛡️ Security Components

- **Sanitization Engine**: Custom TypeScript implementation (Sliding Window Shannon Entropy calculation to prevent token dilution with hardened risk thresholds [Suspicious > 4.5, Adversarial > 5.5], PII Redaction including Phone/SSN/Secret Values, Hardened Keyword & Topic Filtering for roleplay/DAN detection).
- **Anti-ReDoS Circuit Breaker**: High-resolution timing (`performance.now()`) monitors the sanitization pipeline. Payloads causing Catastrophic Backtracking (latency > 100ms) are instantly blocked and logged as `Adversarial` to prevent Denial of Service.
- **Regex Detection Patterns**: Configurable regular expressions for prompt injection detection. Hardcoded and internalized into the codebase (originally from dimitritholen) to mitigate supply chain risks. Features `break-all` layout support for lengthy patterns.
- **Output Filter**: Secondary sanitization layer for LLM responses with keyword and PII redaction.
- **Forbidden Topics Governance**: Semantic guardrail layer for blocking and escalating sensitive topics (Finances, Politics, etc.) with toggleable enforcement.
- **Inference Path**: Browser-side provider calls are disabled. Clean prompts are intended to route through the backend `/v1/intercept` gateway so provider credentials remain server-side.
- **Prompt Role Separation**: System configuration now distinguishes a firewall enforcement prompt from a downstream responder prompt, reducing prompt-role confusion between inspection and generation stages.
- **Future Decision Contract**: The firewall configuration includes a structured gateway contract centered on `ALLOW_AND_FORWARD`, `BLOCK`, `QUEUE_FOR_REVIEW`, and `FAIL_SECURE` decisions for the planned Bedrock runtime.
- **Prompt Drift Detection**: The UI computes SHA-256 fingerprints for the recommended system-configuration baseline and the active configuration so drift can be identified quickly during validation and incident response.
- **Backend Gateway Guard**: Express backend configuration is runtime-validated with Zod and can require a bearer token (`INTERCEPT_BEARER_TOKEN`) outside dev before serving `/v1/intercept`.
- **Interactive Governance Controls**: Real-time administrative controls synchronized via Firestore. Includes **Human-in-the-Loop (HITL) Mode** for routing borderline traffic to a manual review queue, and **Global System Pause (DEFCON 1)**, a kill switch that halts all automated inference and visually alerts the SOC dashboard to ensure zero data leakage during coordinated attacks.
- **Audit Trail & Forensics**: Real-time logging with multi-column sorting, optimized UI spacing, and **Full Prompt Inspection** (scrollable pop-up for complete prompt text). Supports **Universal Analyst Review Workflow** (allowing review of Clean, Informational, Suspicious, and Adversarial logs) and **Multi-Tier Review** with editable severity assignments. Captures AI responses for full context, tracks `PENDING_REVIEW` status for intercepted prompts, and preserves traffic provenance via a `source` field such as `analyst_chat` or `bulk_ingest`. Includes **False Negative Highlighting** for logs pre-labeled via the Bulk Ingestor.
- **Syntactic Complexity Analyzer**: Real-time detection of instruction stacking, probing, and model reverse engineering. Analyzes constraint density, special character ratios (using an inverse match regex to accurately capture code-like syntax, URL encoding, and HTML/script tags), and sentence verbosity to flag highly complex, obfuscated prompts. Accessible via the Analyst Playground and integrated into the core firewall.
- **Playground Research Metrics**: Browser-local research log for explicit Playground snapshots. Stores prompt hashes plus derived firewall metrics such as entropy, syntactic score, decode telemetry, verdict classification, and optional MITRE ATLAS annotations for trend analysis and JSON export without persisting raw prompt text by default.
- **Obfuscation Lab**: Prompt Playground workbench for generating browser-safe obfuscated prompt variants across encoding, cipher, unicode, structural-injection, and language-framing categories, then routing them back through the live firewall path for analyst evaluation. Supports single-technique generation, category fan-out, one-click batch analysis into the browser-local research log, and sequential firewall submission of all generated variants for full audit-log coverage with configurable replay delay and jitter.
- **Normalize - Translate Pipeline**: Prompt Playground workflow for verifying likely spelling intent before translation and then handing the resulting foreign-language prompt into the obfuscation stage. Supports browser-local heuristic normalization, optional LanguageTool correction, provider-backed translation settings, and structured research-log metadata for normalization backend, correction count, translation provider, and target language.
- **Backend Translation Gateway**: Provider-backed translation for the Playground now routes through the local Counter-Spy.ai backend via `/v1/translate` instead of direct browser-to-provider fetches. This keeps the research workflow aligned with the broader control-plane direction, gives the frontend API boundary a concrete first translation use case, and now exposes backend readiness directly in the Playground UI.
- **DeepL Translation Path**: The default translation workflow is now simplified around a recommended DeepL-style API path, reducing local environment complexity and making the Normalize - Translate path easier to operate during research and demos. Provider, source-language, and base-URL tuning are now treated as advanced settings instead of the default operator experience.
- **Sam Spade CTF Intake**: The Sam Spade front-end shell now includes a governed question input that forwards prompts into the existing Analyst Chat path under a dedicated `ctf_chat` provenance value. This gives the noir game surface a real control-plane handoff without bypassing the current sanitization, audit, and review flow.
- **Dedicated Sam Spade API**: Sam Spade now has a separate backend session/message/solve API with local in-memory plus JSON-backed session storage, allowing the CTF surface to evolve toward its own containerized service boundary later. The frontend maintains separate Sam Spade session state while mirroring reviewed artifacts into Analyst Chat and Audit Logs as downstream review surfaces, and solve attempts now emit the same review artifact shape as normal question turns.
- **Sam Spade Service Layout**: The backend implementation is now organized under `backend/src/services/sam-spade/` (`types`, `store`, `service`, `index`) so the later Docker/service split is largely a packaging and deployment exercise rather than a major refactor.
- **Sam Spade Service Config Surface**: Sam Spade settings now live behind a separate env/config module (`SAM_SPADE_ENABLED`, `SAM_SPADE_DEFAULT_CASE_ID`, `SAM_SPADE_STORE_PATH`, `SAM_SPADE_SERVICE_PORT`) so the future service split does not have to inherit the main backend configuration surface.
- **CTF Metrics Filter**: The Metrics dashboard now includes a dedicated `CTF Chat` source filter so Sam Spade telemetry can be isolated across threat velocity, false-positive metrics, obfuscation trends, and operational summaries.
- **SQLite Sam Spade Session Store**: Sam Spade session persistence now uses a local SQLite database path (`SAM_SPADE_STORE_PATH`) rather than a raw JSON artifact, making local Docker demos cleaner and giving ECS a more credible mounted-volume persistence story.
- **Local Docker Demo Stack**: A dedicated `docker-compose.demo.yml` plus `Dockerfile.frontend-demo` now provide a minimal end-to-end local demo path with backend health checks, frontend proxying, and a named volume for Sam Spade session data.
- **Cheap Upstream Language Recovery**: Sanitization now adds lightweight `SPELLING_OBFUSCATION`, `FOREIGN_LANGUAGE`, and `MIXED_LANGUAGE` detection signals so likely garbage, non-plain-text, or foreign-language prompts can be triaged before they consume upstream customer LLM tokens. Foreign-language recovery uses bounded heuristic phrase translation for policy analysis rather than full hot-path machine translation.
- **Obfuscation Signal Metrics**: Metrics dashboard now exposes counts for specific obfuscation detections including URL encoding, HTML entities, leetspeak, ROT13, reverse text, NATO phonetic, Morse code, recursive decode chains, and structural wrappers, plus a stacked 24-hour obfuscation trend chart for in-app time-series comparison of the most common techniques. Audit records now persist a compact `obfuscationSummary` field (`hasObfuscation`, `techniques`, `decodeTelemetry`) so reporting can read a normalized obfuscation digest instead of inferring solely from raw detection flags. Audit Logs now support technique-specific obfuscation filtering, and prompt details surface the same recorded obfuscation-signal badges plus stored decode telemetry for per-event review.
- **Modular Sanitizer Architecture**: The frontend sanitization engine is now split into focused normalization, language-recovery, and obfuscation helper modules while preserving the same policy behavior. This reduces maintenance risk in the hot path and gives the planned frontend API boundary a cleaner place to reuse or mirror the control-plane logic.
- **MITRE ATLAS Organizer Taxonomy**: Shared frontend taxonomy types now use a corpus-driven 16-node ATLAS organizer set for active labeling, heat-map visualization, and research exports, while still accepting older experimental ATLAS labels for backward compatibility with historical local snapshots.
- **Bulk Ingest Simulator**: High-velocity ingestion utility for synthetic traffic generation and adversarial testing. Features **Base Delay + Random Jitter** (3-10s) and **Screen Wake Lock API** integration for session persistence. Supports **DPO Pre-labeling** (Batch ID, Expected Verdict) for training data acquisition.
- **Golden Set Refinement**: Automated "Promote to KB" feature for acquiring negative training data (DPO format) from audit logs. Supports **JSON Export** for seamless integration with fine-tuning pipelines.
- **Data Disclosure Detection (Canary Tokens)**: Implementation of a unique system canary token (`COUNTERSPY_CANARY_TOKEN_...`) embedded in documentation and monitored via the sanitization pipeline. Automatic redaction and escalation if the token is detected in prompts or AI responses.
- **Anomaly Detection Metrics**: Real-time threat velocity analysis using a sliding window baseline (Z-Score/Ratio). Detects spikes in adversarial activity (e.g., >500% increase over 24h baseline) and identifies top offending User IDs. Visualized via the Metrics dashboard.
- **Performance & UX Metrics**: Automated calculation of **False Positive Rate** and an analyst-upgrade **False Negative Rate** for blocked traffic. Provides a quantitative feedback loop to balance security robustness with user experience and analyst severity tuning.
- **Data Persistence**: Google Cloud Firestore (US-West2) for Audit Logs, User Profiles, System Config, and unified Knowledge Base (default, custom, and training data documents).
- **Authentication**: Firebase Authentication (Google OAuth 2.0).
- **Runtime Validation**: Zod is used on backend requests, backend environment configuration, frontend backend-response parsing, Firebase config loading, and selected Firestore/Golden Set document ingestion.
- **Documentation Rendering**: `react-markdown` for System Configuration and Policies. `rehype-raw` is explicitly disabled to prevent Stored XSS vulnerabilities from LLM output or Firestore documents.
- **Content Security Policy (CSP)**: *Known Gap* - A strict CSP is planned for implementation to provide a last-line defense against XSS.

## 📎 Third-Party Attribution & Modification Notes

- **Arcanum Prompt Obfuscator / Arcanum PI Taxonomy**
  - Attribution: Jason Haddix / Arcanum Information Security
  - License note carried from the generated source header: `CC BY 4.0 — attribution required`
  - Counter-Spy.ai modifications: converted the generated obfuscation code into a browser-safe module, restructured the encoder registry for Playground workflows, and selectively incorporated technique families into detection heuristics for firewall research and testing.

- **Regex Detection Pattern Lineage**
  - Attribution: originally sourced from `dimitritholen`
  - Counter-Spy.ai modifications: internalized the regex patterns into the local firewall, reformatted them for system configuration and UI display, and integrated them with local sanitization, audit review, and threshold-tuning workflows.

---
*This document is generated automatically for compliance tracking. Versions listed are based on the primary `package.json` manifest.*
