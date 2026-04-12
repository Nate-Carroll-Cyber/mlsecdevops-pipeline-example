# Software Bill of Materials (SBOM) - Counter-Spy.ai

**Project Name:** Counter-Spy.ai  
**Version:** 1.9.2 (Bulk Ingest & DPO Labeling Update)  
**Date Generated:** 2026-04-12  
**Compliance Level:** Internal Security Governance

## 📦 Core Dependencies

| Package | Version | Description |
| :--- | :--- | :--- |
| `react` | `~19.0.4` | Frontend UI Library (Pinned to ~19.0.4 to mitigate CVE-2025-55182 & CVE-2026-23864 while allowing patches) |
| `firebase` | `^12.12.0` | Backend as a Service (Auth, Firestore). Verified `@firebase/auth` resolves to `1.13.0` (mitigates CVE-2024-11023). |
| `@google/genai` | `^1.48.0` | Google Gemini AI SDK |
| `motion` | `^12.23.24` | Animation and Layout Engine |
| `lucide-react` | `^0.546.0` | Icon Library |
| `react-markdown` | `^10.1.0` | Markdown Rendering (rehype-raw disabled to prevent XSS) |
| `sonner` | `^2.0.7` | Toast Notifications |
| `zod` | `^4.3.6` | Schema Validation |
| `clsx` | `^2.1.1` | Conditional Class Utilities |
| `recharts` | `^2.15.1` | Composable Charting Library (used for threat velocity visualization) |
| `class-variance-authority` | `^0.7.1` | CSS Class Variance Management |
| `tailwind-merge` | `^3.5.0` | Tailwind Class Merging |
| `next-themes` | `^0.4.6` | Theme Management (Dark Mode) |
| `@fontsource-variable/geist` | `^5.2.8` | Geist Variable Font |
| `express` | `^5.2.1` | Web Server Framework |
| `dotenv` | `^17.2.3` | Environment Variable Management (Known Risk: Planned migration to AWS Secrets Manager for production) |
| `tw-animate-css` | `^1.4.0` | Tailwind Animation Utilities |
| `@base-ui/react` | `^1.3.0` | Unstyled UI Components |

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
- **Inference Engine**: Google Gemini 3 Flash (Known Risk: Architectural risk regarding sensitive analyst prompts leaving the perimeter. Planned evaluation of local models for sensitive sessions).
- **Interactive Governance Controls**: Real-time administrative controls synchronized via Firestore. Includes **Human-in-the-Loop (HITL) Mode** for routing borderline traffic to a manual review queue, and **Global System Pause (DEFCON 1)**, a kill switch that halts all automated inference and visually alerts the SOC dashboard to ensure zero data leakage during coordinated attacks.
- **Audit Trail & Forensics**: Real-time logging with multi-column sorting, optimized UI spacing, and **Full Prompt Inspection** (scrollable pop-up for complete prompt text). Supports **Universal Analyst Review Workflow** (allowing review of Clean, Informational, Suspicious, and Adversarial logs) and **Multi-Tier Review** with editable severity assignments. Captures AI responses for full context and tracks `PENDING_REVIEW` status for intercepted prompts. Includes **False Negative Highlighting** for logs pre-labeled via the Bulk Ingestor.
- **Syntactic Complexity Analyzer**: Real-time detection of instruction stacking, probing, and model reverse engineering. Analyzes constraint density, special character ratios (using an inverse match regex to accurately capture code-like syntax, URL encoding, and HTML/script tags), and sentence verbosity to flag highly complex, obfuscated prompts. Accessible via the Analyst Playground and integrated into the core firewall.
- **Bulk Ingest Simulator**: High-velocity ingestion utility for synthetic traffic generation and adversarial testing. Features **Base Delay + Random Jitter** (3-10s) and **Screen Wake Lock API** integration for session persistence. Supports **DPO Pre-labeling** (Batch ID, Expected Verdict) for training data acquisition.
- **Golden Set Refinement**: Automated "Promote to KB" feature for acquiring negative training data (DPO format) from audit logs. Supports **JSON Export** for seamless integration with fine-tuning pipelines.
- **Data Disclosure Detection (Canary Tokens)**: Implementation of a unique system canary token (`COUNTERSPY_CANARY_TOKEN_...`) embedded in documentation and monitored via the sanitization pipeline. Automatic redaction and escalation if the token is detected in prompts or AI responses.
- **Anomaly Detection Metrics**: Real-time threat velocity analysis using a sliding window baseline (Z-Score/Ratio). Detects spikes in adversarial activity (e.g., >500% increase over 24h baseline) and identifies top offending User IDs. Visualized via the Metrics dashboard.
- **Performance & UX Metrics**: Automated calculation of **Strict False Positive Rate (FPR)** and **Analyst Reclassification Rate**. Provides a quantitative feedback loop to balance security robustness with user experience and analyst efficiency.
- **Data Persistence**: Google Cloud Firestore (US-West2) for Audit Logs, User Profiles, System Config, and unified Knowledge Base (default, custom, and training data documents).
- **Authentication**: Firebase Authentication (Google OAuth 2.0).
- **Documentation Rendering**: `react-markdown` for System Configuration and Policies. `rehype-raw` is explicitly disabled to prevent Stored XSS vulnerabilities from LLM output or Firestore documents.
- **Content Security Policy (CSP)**: *Known Gap* - A strict CSP is planned for implementation to provide a last-line defense against XSS.

---
*This document is generated automatically for compliance tracking. Versions listed are based on the primary `package.json` manifest.*
