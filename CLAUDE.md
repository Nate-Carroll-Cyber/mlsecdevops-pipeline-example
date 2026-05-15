# CLAUDE.md — Counter-Spy.ai

This file provides persistent project context for Claude Code. Read this before making any changes to this repository.

---

## Project Overview

Counter-Spy.ai is an **Adversary-Aware AI Security Gateway**. It sits between untrusted user input and production LLMs, intercepting adversarial prompts before they reach the inference engine. This is a security operations platform — treat all changes with the same scrutiny as changes to a firewall ruleset.

---

## Architecture: server-hosted Shield-and-Sword

This is a **server-hosted app** split across an npm-workspaces monorepo. The React analyst console is server-rendered and served by the gateway service (`services/gateway/src/server.ts` → `services/gateway/src/web/ssr.ts`), and **all sanitization/analysis runs server-side** — the browser ships no detection engine. Shared security primitives live in `packages/backend-shared/src/` and are imported by both `services/gateway/` and `services/sam-spade/`. The `/src` console calls those backend modules over `/v1/analyze*` via `src/lib/backendApi.ts`.

Workspaces:
- `packages/backend-shared/` (`@counter-spy/backend-shared`) — sanitizer, urlGuard, rateLimit, telemetry, safeguard defaults, provider clients. Imported by both services.
- `services/gateway/` (`@counter-spy/gateway`) — `/v1/intercept`, `/v1/analyze*`, `/v1/translate`, instruction-monitor, CTF review-artifact store, SSR analyst console.
- `services/sam-spade/` (`@counter-spy/sam-spade`) — standalone `/v1/ctf/sam-spade/*` CTF service with its own SQLite session store.

| Layer | File(s) | Role |
| :--- | :--- | :--- |
| 🛡️ **Shield** | `packages/backend-shared/src/security/sanitizer.ts` | The deterministic sanitization engine — PII/secret redaction, entropy, syntactic complexity, decode telemetry, verdict bands. **The trust boundary.** Reached from the UI via `POST /v1/analyze` / `/v1/analyze/full` / `/v1/analyze/output`. |
| 🔬 **Lab** | `services/gateway/src/analysis/*.ts` | Syntactic-complexity scoring, prompt feature vectors, language-likelihood, the obfuscation lab (~24 transforms), heuristic spell-normalization. Reached via `/v1/analyze/full`, `/v1/analyze/obfuscate`, `/v1/analyze/normalize`. |
| ⚔️ **Sword** | `services/gateway/src/server.ts` + `services/sam-spade/src/server.ts` (responder/safeguard provider calls via `packages/backend-shared/src/providers/`) | Production LLM inference (safeguard judge + downstream responder). Only receives sanitized payloads; `src/lib/gemini.ts` is a disabled browser stub. |
| 📡 **Radar** | `src/lib/anomalyDetector.ts`, `src/lib/metrics.ts` | Z-Score anomaly detection + confusion-matrix metrics over audit logs (still client-side; moves server-side with the audit-log store in a later phase). |
| 🔒 **Vault** | `firestore.rules` | Database-layer RBAC. Enforces integrity even if the client is compromised. |

**The cardinal rule:** no prompt reaches a production LLM (safeguard or responder) without first passing through `packages/backend-shared/src/security/sanitizer.ts`. The browser must not regain a local sanitization/analysis engine — keep all of it behind `/v1/analyze*`.

---

## Security Constraints — Read Before Modifying

> [!CAUTION]
> The following files are **security-critical**. Any modification requires explicit justification and must not weaken existing controls.

- `packages/backend-shared/src/security/sanitizer.ts` — the Shield. Do not lower entropy thresholds, remove detection patterns, or add pass-throughs.
- `services/gateway/src/analysis/syntacticAnalyzer.ts` — Thresholds: Suspicious > 50, Adversarial > 90. Do not raise these without documented rationale.
- `services/gateway/src/server.ts` — the `/v1/intercept` and `/v1/analyze*` route handlers and the safeguard/responder verdict contracts govern firewall/responder behavior. Do not relax them. Do not add a code path that serves prompts to a provider LLM without `sanitizePrompt` first. The standalone CTF surface (`services/sam-spade/src/server.ts`) follows the same contracts via the shared sanitizer/safeguard helpers.
- `src/lib/policies.ts` — bundled MITRE/MCP-A2A safety policies (the hard-block phrases the console feeds into the Shield's blocked-keyword set). Do not weaken.
- `firestore.rules` — RBAC rules. Do not broaden read/write permissions.

**Entropy thresholds (do not modify without review):**

| Level | Threshold |
| :--- | :--- |
| Allowed | <= 3.8 |
| Suspicious | > 3.8 and <= configured Entropy Threshold |
| Adversarial | > configured Entropy Threshold |

---

## Dependency Constraints

Versions are pinned for security reasons. Do not upgrade the following without reviewing the associated CVEs documented in `Technical/SBOM.md`:

- `react` and `react-dom` — pinned to `~19.0.4` (CVE-2025-55182, CVE-2026-23864)
- `vite` — pinned to `^8.0.5` (CVE-2026-39363 and related)
- `@google/genai` — `^1.48.0`
- `express` — `^5.2.1`

Do not add new dependencies without updating `Technical/SBOM.md`.

---

## Key Conventions

### TypeScript
- Strict mode is enabled. Do not use `any` types in security-critical files.
- All sanitization/analysis functions must return a typed result — never raw strings from untrusted input.
- The console (`/src`) reaches the backend only through `src/lib/backendApi.ts` (Zod-validated responses). Do not `fetch` the API directly from a component, and do not import `services/**` or `packages/backend-shared/**` from `/src` — the analysis engines must stay server-side.

### SSR
- The app is server-rendered (`src/entry-server.tsx` → `renderToString`) and hydrated (`src/entry-client.tsx`). Anything that touches `window`/`document`/`localStorage`/Firebase at module load or in a `useState` initializer must be SSR-safe (guarded with `typeof window !== 'undefined'`, or deferred to a `useEffect`). The two builds are `vite build` → `dist/client/` and `vite build --ssr src/entry-server.tsx` → `dist/server/`.

### Firestore
- Firestore (`src/lib/firebase.ts`) is client-only and lazily initialized (inert under SSR). It currently still backs audit logs / governance / policies; that data path moves server-side in a later phase.
- Never write directly to Firestore from a component — always go through `src/lib/`.
- The `sanitizedPrompt` field must never contain raw PII. The Shield always redacts before returning, so write what `/v1/analyze*` produced; do not reconstruct the raw prompt.

### React
- `react-markdown` is configured with `rehype-raw` **disabled**. Do not enable it — this prevents XSS from LLM-generated content.
- Do not use `dangerouslySetInnerHTML` anywhere in the codebase.

### Environment Variables
- API keys live in `.env` (local) and AWS Secrets Manager (production).
- `.env` is in `.gitignore`. Never hardcode secrets. Never commit `.env`.
- The only required variable for local dev is `GEMINI_API_KEY`.

---

## Documentation

| File | Purpose |
| :--- | :--- |
| `README.md` | Project overview, security architecture, tech stack |
| `Technical/SBOM.md` | Dependency versions, CVE mitigations, known risks |
| `Technical/ARCHITECTURE.md` | Shield-and-Sword deep dive, API reference, heuristic math |
| `Regulatory/ANALYST_GUIDE.md` | SOC operator SOPs, HITL/HOTL workflows, DPO pipeline |

If you modify the security architecture, update `Technical/ARCHITECTURE.md`. If you add or update a dependency, update `Technical/SBOM.md`.

---

## What This Project Is Not

- Not a general-purpose chatbot. Do not suggest features that relax governance controls.
- Not a public-facing consumer product. The UX is optimised for trained SOC analysts.
- Not a replacement for human judgment. The HITL workflow exists precisely because automated classification has limits.
