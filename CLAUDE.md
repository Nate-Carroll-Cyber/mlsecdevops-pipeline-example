# CLAUDE.md — Counter-Spy.ai

This file provides persistent project context for Claude Code. Read this before making any changes to this repository.

---

## Project Overview

Counter-Spy.ai is an **Adversary-Aware AI Security Gateway**. It sits between untrusted user input and production LLMs, intercepting adversarial prompts before they reach the inference engine. This is a security operations platform — treat all changes with the same scrutiny as changes to a firewall ruleset.

---

## Architecture: The Shield-and-Sword Pattern

The codebase is bifurcated into two distinct security layers:

| Layer | File | Role |
| :--- | :--- | :--- |
| 🛡️ **Shield** | `src/lib/sanitizer.ts` | All local sanitization. This is the primary trust boundary. |
| ⚔️ **Sword** | `src/lib/gemini.ts` | Production LLM inference. Only receives sanitized payloads. |
| 📡 **Radar** | `src/lib/anomalyDetector.ts` | Z-Score anomaly detection engine. |
| 🔒 **Vault** | `firestore.rules` | Database-layer RBAC. Enforces integrity even if client is compromised. |

**The cardinal rule:** Nothing reaches `src/lib/gemini.ts` without first passing through `src/lib/sanitizer.ts`. Do not introduce any code path that bypasses this flow.

---

## Security Constraints — Read Before Modifying

> [!CAUTION]
> The following files are **security-critical**. Any modification requires explicit justification and must not weaken existing controls.

- `src/lib/sanitizer.ts` — Do not lower entropy thresholds, remove detection patterns, or add pass-throughs.
- `src/lib/syntacticAnalyzer.ts` — Thresholds: Suspicious > 50, Adversarial > 90. Do not raise these without documented rationale.
- `firestore.rules` — RBAC rules. Do not broaden read/write permissions.
- `src/lib/gemini.ts` — System prompt governs model persona. Do not modify the system instruction to relax security constraints.

**Entropy thresholds (do not modify without review):**

| Level | Threshold |
| :--- | :--- |
| Normal | < 4.5 |
| Suspicious | 4.5 – 5.5 |
| Adversarial | > 5.5 |

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
- All sanitization functions must return a typed result — never raw strings from untrusted input.

### Firestore
- All reads and writes go through the typed helpers in `src/lib/firebase.ts`.
- Never write directly to Firestore from a component — always go through `src/lib/`.
- The `sanitizedPrompt` field must never contain raw PII. Verify redaction before any write.

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
