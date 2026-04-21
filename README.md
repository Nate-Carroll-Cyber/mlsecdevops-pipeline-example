# Counter-Spy.ai: Adversary-Aware Prompt Firewall & Forwarding Gateway

Counter-Spy.ai is a secure GenAI control-plane for adversary-aware LLM governance. It is a policy-enforcing firewall first, with a forwarding path for clean traffic and a review/block path for suspicious traffic.

Counter-Spy.ai decouples adversarial defense from response generation by enforcing a control-plane architecture that mediates all LLM interactions before inference.

> Govern Every Prompt. Question Every Answer.

## 📚 Documentation
- [Technical Architecture & Specifications](./docs/ARCHITECTURE.md) - Deep dive into the Shield-and-Sword pattern and heuristics.
- [Analyst & Administrator Operations Guide](./docs/ANALYST_GUIDE.md) - Standard Operating Procedures for SOC personnel.
- [Adversarial Prompt Analysis Plan](./docs/ADVERSARIAL_PROMPT_ANALYSIS.md) - Research plan for taxonomy, trend analysis, detection effectiveness, and failure-case reporting.
- [MITRE ATLAS Organizer Mapping](./docs/MITRE_ATLAS_MAPPING.md) - Active 16-node ATLAS organizer taxonomy used for labeling, heat maps, and research exports.
- [Sam Spade CTF Integration Spec](./docs/SAM_SPADE_CTF_INTEGRATION.md) - Architecture plan for bringing the noir elicitation scenario into Counter-Spy.ai as a governed input source.
- [Sam Spade API Contract](./docs/SAM_SPADE_API_CONTRACT.md) - Current backend session/message/solve interface for the Sam Spade CTF surface, shaped for a later service/container split.
- [Local Development](./docs/LOCAL_DEVELOPMENT.md) - Run the frontend, backend stub, tests, and Docker build before AWS access is available.

> [!IMPORTANT]
> **Sanitized Pass-through Guarantee**: Only the redacted version of a prompt is ever sent to the inference engine. Raw PII and secrets are neutralized at the local sanitization layer before any external API call is initiated.

## 🧠 Design Principles

- Treat every prompt as untrusted input
- Enforce policy before model invocation
- Minimize data exposure via sanitization
- Separate control-plane (defense) from inference-plane (response)
- Maintain full auditability of all decisions

## 🛡️ Core Security Architecture

The application implements a **Defense-in-Depth** strategy for AI interactions:

### 1. Local Sanitization Pipeline (The Filter)
Before any prompt is sent to the AI model, it passes through a local TypeScript-based sanitization layer:
- **PII & Secret Redaction**: Automatically detects and masks emails, AWS keys, IP addresses, credit card patterns, phone numbers, and SSNs. It also redacts the actual values of secret keys and passwords.
- **Regex Detection**: Evaluates input against configurable regular expressions to catch sophisticated prompt injection and instruction bypass attempts. Supports `break-all` formatting for complex, lengthy patterns.
- **Normalization**: Flattens input (e.g., leetspeak conversion) to prevent keyword bypasses.
- **Obfuscation Detection**: Extends decode-and-inspect coverage beyond Base64 and Hex to include URL encoding, HTML entities, reverse text, ROT13-style masking, NATO phonetic and Morse encodings, recursive mixed transforms, and structural wrappers such as end-sequence markers, chunked payloads, variable-expansion patterns, and vertical-text formatting.
- **Entropy Analysis (Sliding Window)**: Calculates Shannon entropy using a sliding window approach (35-character windows, 5-character steps) to detect localized high-entropy payloads (Base64, Hex, etc.) and prevent **Token Dilution** attacks.
  - **Math**: $$H(X) = -\sum_{i=1}^{n} P(x_i) \log_2 P(x_i)$$
  - **Global Entropy**: The average randomness across the entire prompt.
  - **Max Window Entropy**: The highest randomness found in any specific 35-character chunk. This defeats token dilution, where an attacker attempts to hide a high-entropy payload within paragraphs of normal, low-entropy text.
  - **Thresholds**: Counter-Spy.ai now treats entropy as a supporting triage signal rather than a standalone verdict. Symbol-heavy, non-ASCII-heavy, combining-mark, and other concealment-like chunks can elevate review sensitivity, while ordinary ASCII prose is penalized downward so clean traffic is not mislabeled simply for having healthy character variety.
- **Syntactic Complexity Analyzer**: Real-time detection of instruction stacking, probing, and model reverse engineering. 
  - **Logic**: Analyzes constraint density and special character ratios using an inverse match regex `/[a-zA-Z0-9\s]/g`. This captures code-like syntax and URL-encoded strings that attempt to bypass semantic filters.
  - Features analysis of sentence verbosity to flag highly complex, obfuscated prompts. Accessible via the Analyst Playground and integrated into the core firewall.
- **Keyword & Topic Filtering**: Matches input against configurable lists of blocked phrases and forbidden topics. Includes a curated default blocklist for detecting roleplay-based injections, reviewed against known jailbreak corpora.
- **Anti-ReDoS Circuit Breaker**: Local sanitization execution time (`latencyMs`) is strictly monitored via high-resolution timing. Payloads exhibiting Catastrophic Backtracking or intentional CPU lock-up attempts are instantly blocked and logged as `Adversarial` if execution exceeds 100ms, preventing Denial of Service attacks on the client environment.
- **Persistent Preview**: Live sanitization results remain visible after execution as "Last Execution Results" until a new prompt is initiated.

### 2. Output Sanitization Layer (The Guard)
A secondary sanitization layer is applied to all LLM responses:
- **Keyword Redaction**: Scans the model's output and masks any blocked keywords or forbidden topics with `[REDACTED_KEYWORD]`.
- **PII Leak Prevention**: Re-applies PII redaction to the model's response to prevent accidental data leakage.

### 3. Governance Engine
The system evaluates the sanitization results against active guardrails and provides real-time administrative controls:
- **Adversarial Interception**: If high entropy (>5.5) or high syntactic complexity (>90) is detected, the request is blocked pre-inference as Adversarial.
- **Suspicious Interception**: If blocked keywords, forbidden topics, symbol/encoding obfuscation, suspicious external-call attempts, or suspicious entropy plus concealment-like structure are detected, the request is blocked pre-inference as Suspicious.
- **Human-in-the-Loop (HITL) Mode**: When activated, automatically intercepts borderline traffic using the live governance thresholds (default entropy threshold `4.0` plus the active syntactic threshold) and routes it to a manual review queue (`PENDING_REVIEW`), allowing human analysts to intervene before the payload reaches the inference engine.
- **Forbidden Topics Enforcement**: A semantic governance layer that instructs the model to refuse and flag (via `[VIOLATION]` tags) any discussion of forbidden topics (e.g., Finances, Politics).

### 4. Operator Controls
- **Governance Status**:
  - **ACTIVE (Green)**: All core guardrails are enabled.
  - **REDUCED (Orange)**: One or more critical guardrails (PII Redaction, Logging, Blocked Keywords, or Blocked Topics) are disabled.
  - **DISABLED (Red)**: All guardrails are disabled.
- **Traffic Provenance**: Audit logs preserve a `source` marker such as `analyst_chat` or `bulk_ingest`, so test traffic can be compared against analyst-entered traffic without hiding records from the main dashboards.
- **Global System Pause (DEFCON 1)**: A real-time "kill switch" that halts 100% of automated inference. Incoming prompts are instantly routed to the manual review queue to ensure zero data leakage during coordinated attacks. The SOC dashboard transitions to a high-visibility crimson alert state.

### 5. Inference Engine (Pluggable LLM Architecture)
- **Backend-Only Inference Path**: Direct browser-side model access is disabled so provider credentials are not exposed in the client bundle.
- **Authenticated Gateway Pattern**: Clean prompts are intended to flow through an authenticated backend gateway (`/v1/intercept`) before any external inference provider is called.
- **Vendor-Neutral Posture**: The control-plane is designed to stay decoupled from any single provider so the downstream inference engine can evolve across backend-managed OpenAI-compatible and future multi-model runtimes without exposing provider secrets to the browser.
- **Split Prompt Roles**: System configuration now separates a **Firewall Prompt** from a **Downstream Responder Prompt** so enforcement logic and forwarded generation instructions stay distinct.
- **Future Structured Output Contract**: The firewall prompt is being shaped around structured decisions such as `ALLOW_AND_FORWARD`, `BLOCK`, `QUEUE_FOR_REVIEW`, and `FAIL_SECURE` for the future Bedrock gateway path.
- **Config Drift Fingerprint**: The System Configuration view exposes a SHA-256 hash for the recommended baseline and the active live config, making prompt drift easier to detect during review and incident response.
- **Fail-Closed Fallback**: If the backend or downstream responder is unavailable, the UI remains reviewable but clean prompts do not silently bypass the control plane. Runtime responder failures are surfaced so operators can distinguish provider issues from local review behavior.

## 📦 Security Mitigations & Dependency Management

To ensure the integrity of the security operations platform, Counter-Spy.ai implements strict dependency governance:
- **React Server Components (RCE) Mitigation**: `react` and `react-dom` are pinned to `19.0.4` to mitigate CVE-2025-55182 and related DoS vulnerabilities.
- **Vite Dev Server Security**: Vite is upgraded to `^8.0.5` to mitigate arbitrary file read and path traversal vulnerabilities (CVE-2025-31125, CVE-2025-32395, CVE-2026-39363, GHSA-v2wj-q39q-566r, GHSA-4w7w-66w2-5vf9).
- **Stored XSS Prevention**: `react-markdown` is configured to explicitly disallow `rehype-raw`, preventing malicious HTML/JS injection from LLM outputs or compromised Firestore policy documents.
- **Frontend Secret Exposure Reduction**: Browser-side provider key injection has been removed. LLM credentials are expected to live in backend runtime configuration or a secret manager, not the React bundle.
- **Supply Chain Security**: Regular expression detection patterns have been internalized rather than sourced dynamically, and CLI tools like `shadcn` are strictly isolated to `devDependencies`.

## 📊 Key Features

- **Advanced Audit Trail**: Every interaction is logged with its entropy score, detection flags, and a unique Session ID. The audit table features **multi-column sorting**, optimized column spacing, and **Full Prompt Inspection**—allowing analysts to click any truncated prompt to view the complete text in a scrollable, text-only pop-up dialog. Admins can also use **Purge Session** to **remove all data** before a fresh test run.
- **Research-Ready Exports**: Audit log CSV exports now reserve fields for **MITRE ATLAS organizer labeling**, optional local archetypes, and analyst confidence/notes so longitudinal adversarial prompt analysis can evolve without another schema reset.
- **Anomaly Detection & Metrics Dashboard**: A dedicated dashboard for real-time threat velocity analysis. It compares current hourly threat rates against a 24-hour baseline to identify significant spikes in adversarial activity. Utilizes real-time Z-Score calculations ($Z = \frac{x - \mu}{\sigma}$) to distinguish between random noise and coordinated automated attacks. Features a critical alert banner for immediate incident response, a time-series chart for trend analysis, and a layered **Defense Funnel** summary that reports pre-inference block rate, Safeguard LLM intervention rate, and post-model escape rate.
- **MITRE ATLAS Technique Heat Map**: The Metrics view uses the active 16-node MITRE ATLAS organizer taxonomy as its top-level structure so labeled prompt activity can be reviewed in the same corpus-driven layout used by the research dataset.
- **Analyst Review Workflow**: Administrators can review **all** interactions (including those marked as Clean) to catch false negatives. The workflow supports **Multi-Tier Review**, allowing analysts to re-edit and update the **Resultant Severity** at any time as new threat intelligence becomes available.
  - **False Negative Highlighting**: Logs pre-labeled as "Adversarial" (via the Bulk Ingestor) that are classified as "Clean" by the system are automatically highlighted with a red border and an **FN (False Negative)** badge, allowing for rapid identification of firewall bypasses.
  - *The platform automatically calculates both the False Positive Rate and the analyst-upgrade False Negative Rate, ensuring the firewall's regex and entropy thresholds can be tuned against both overblocking and under-severity classification.*
- **Automated Golden Set Refinement**: Administrators can "Promote" specific audit logs to a **Golden Set** for future DPO (Direct Preference Optimization) fine-tuning. This captures the prompt, the AI's response, and a user-provided "Rejected" reason in a structured JSON format. Supports **one-click JSON export** of the entire set for training pipelines.
- **Dynamic Guardrails**: Administrators can toggle security features (PII Redaction, Entropy Filtering, Obfuscation Detection, Blocked Keywords, Blocked Topics, Logging, etc.) on the fly.
- **Knowledge Base**: Integrated security policies, MITRE ATLAS mapping, Markdown-rendered System Configuration, and full lifecycle management (upload/delete) of custom `.md` documents. This internal guardrail workspace is now restricted to admin roles. Includes a dedicated **Fine-Tuning Training Data** section for managing the Golden Set.
- **MCP / A2A Safety Detection**: The built-in MCP / A2A Agent Safety Policy contributes hard-block indicator phrases to the effective blocked-keyword set used by the live sanitization path and the Analyst Playground, helping detect instruction-override, approval-bypass, and exfiltration patterns common to tool-using agents.
- **MCP / A2A Guardrail Reference**: The recommended Guardrails Policy now explicitly tells the firewall baseline to review the MCP / A2A Agent Safety Policy when evaluating tool-use, routing, approval-bypass, or exfiltration patterns.
- **Analyst Mode**: A toggleable administrative view for managing system configurations and reviewing logs.
- **Analyst Playground**: A dedicated sandbox environment featuring the Syntactic Complexity Analyzer, allowing security teams to test and tune firewall thresholds against complex prompt injection attempts in real-time. Single-prompt Playground submissions can also be routed through the same live firewall path used by Analyst Chat, with audit provenance preserved as `playground`. It now includes a manual **Normalize - Translate** pipeline so analysts can verify likely spelling intent, either recover foreign-language prompts back into English or generate one foreign-language variant from English, and then hand the result into the obfuscation workflow.
- **Backend-Mediated Lara Translation**: The Playground translation stage now routes through the Counter-Spy.ai backend instead of calling translation providers directly from the browser. It is still intentionally manual and text-only: Lara Translate runs only when an analyst explicitly triggers the pipeline, supporting both auto-detect source -> English recovery and English -> analyst-selected foreign-language variant generation while keeping credentials server-side.
- **Sam Spade CTF Intake**: The Sam Spade home tab now includes a live question field backed by a dedicated backend session/message/solve API under a `ctf_chat` source. This keeps the noir CTF surface aligned with the same governed sanitization, review, and audit path as the rest of Counter-Spy.ai without treating Analyst Chat as the transport layer.
- **Dedicated Sam Spade API Path**: The Sam Spade surface now uses its own backend session/message/solve API (`/v1/ctf/sam-spade/...`) with separate frontend session state and local backend persistence. All Sam Spade turns are logged into the audit trail, while only suspicious or pending-review traffic is mirrored into Analyst Chat as downstream review content. Clean Sam Spade turns currently use deterministic noir reply logic after guardrail approval; they are not yet routed through the live downstream responder.
- **CTF Audit Filter**: Audit Logs now include a quick `CTF Chat` source filter so Sam Spade traffic can be isolated immediately without losing the broader audit trail view.
- **CTF Metrics Filter**: The Metrics view now includes a dedicated `CTF Chat` source filter so Sam Spade traffic can be isolated in charts and operational summaries without leaving the main telemetry surface.
- **Layered Defense Metrics**: The Metrics view now calculates three explicit funnel rates for governed traffic: **Pre-Inference Block Rate** (% blocked before the Safeguard LLM), **Model Intervention Rate** (% caught by the Safeguard LLM after reaching it), and **Post-Model Escape Rate** (% of likely malicious prompts that bypass both layers and still land clean/informational). When present, bulk-ingest `expectedVerdict` labels are used to strengthen escape-rate calculations.
- **Local Docker Demo Stack**: A minimal `docker-compose.demo.yml` now brings up the backend plus a frontend demo container for an end-to-end local pass, while Sam Spade session state persists in a Docker-backed SQLite volume instead of a raw JSON file.
- **Obfuscation Lab**: The Prompt Playground includes an analyst-facing obfuscation workbench for generating test variants across encoding, cipher, unicode, structural-injection, and language-framing techniques. Analysts can generate a single variant, fan out an entire category, use **Analyze All Variants** to record a mini evaluation run into the research log, or **Submit All Variants** to create full firewall and audit-log coverage from one source prompt with adjustable replay delay and jitter. The intended augmentation order is now explicit in the UI: normalize, optionally translate, then add evasions.
- **Playground Research Log**: The Analyst Playground can record explicit metrics snapshots to browser-local storage, capturing prompt hashes, syntactic score, syntactic sub-metrics, entropy, decode telemetry, redaction labels, suspicious-chunk metadata, verdict trends, optional normalization/translation metadata, and optional MITRE ATLAS organizer annotations for later export and longitudinal analysis (for example, 30-day and 180-day trend summaries). The research log now exports in both **JSON** and **CSV** formats. **Purge Session** removes this data too, and a new bulk ingest run clears the prior local research batch before recording the new upload so the sample count reflects the current ingest session.
- **Cheap Upstream Triage**: The sanitization layer now treats obvious encodings and evasions as first-pass security signals, applies lightweight spelling recovery when it helps expose blocked policy language, performs heuristic foreign-language recovery for policy analysis, and elevates non-ASCII/symbol-heavy concealment patterns before traffic earns upstream tokens. Foreign-language and spelling-recovery hits are visible in Metrics and Audit Log detail views, while strong content hits still drive the final severity.
- **Sensitive Data Alerting**: PII, credit-card, secret, and redacted-secret disclosures now surface as their own analyst-facing alert category instead of reading like generic suspicious chatter, which makes data-exposure review easier to distinguish from jailbreak-style prompting.
- **Policy Violation Labeling**: Blocked keywords, forbidden topics, and regex-rule matches now emit a shared `POLICY_VIOLATION` signal so operator-facing responses, Audit Logs, and CSV exports distinguish explicit policy hits from generic suspicious traffic.
- **Obfuscation Metrics Visibility**: The Metrics tab breaks out obfuscation-oriented detections such as URL encoding, HTML entities, leetspeak, ROT13, reverse text, NATO phonetic, Morse code, recursive decode chains, and structural wrappers, and now includes a stacked 24-hour obfuscation trend so key techniques can be compared in one view. Audit records also persist a compact `obfuscationSummary` field (`hasObfuscation`, `techniques`, `decodeTelemetry`) to simplify reporting without re-deriving everything from raw flag arrays. Audit Logs now support both saved family presets and specific-technique filtering, and prompt details surface the recorded obfuscation signal badges and stored decode telemetry for each entry.
- **Responder Telemetry Settings**: Admin view now exposes a small responder telemetry dialog under Analyst Chat system status. Browser-side responder endpoint, model, and API key overrides have been removed; only an optional **Max Context Window** value is stored locally so the audit trail can estimate responder context utilization when the provider returns token usage.
- **Responder Outcome Classification**: Non-standard downstream responses such as `BLOCK`, `FAIL_SECURE`, `QUEUE_FOR_REVIEW`, and explicit policy-violation strings are normalized back into Counter-Spy.ai severity labels so Audit Logs and Metrics reflect the final safeguarded outcome instead of assuming clean traffic.
- **Modular Sanitization Pipeline**: The TypeScript sanitization layer is now split into focused normalization, language-recovery, and obfuscation helper modules so the hot path stays easier to profile, test, and extend as the frontend firewall and future API boundary continue to grow.
- **Bulk Ingest Simulator**: A high-velocity ingestion utility for processing `.txt` files of prompts (one per line). Features **Base Delay + Random Jitter** (3-10s) to simulate realistic traffic patterns while respecting API rate limits. Integrated with the **Screen Wake Lock API** to maintain session persistence during long-running batch operations.
  - **Multi-line Prompt Blocks**: In addition to one-line prompts, the simulator accepts `===PROMPT===` / `===END===` blocks so long or multi-line test payloads can be uploaded without manual escaping or JSON formatting.
  - **DPO Pre-labeling**: Supports optional `Batch ID` and `Expected Verdict` assignment during ingest, facilitating the collection of high-quality training data for model fine-tuning.

## 📋 Audit Log Schema

Every interaction is captured in Firestore with the following schema:

| Field | Type | Description |
| :--- | :--- | :--- |
| `userId` | `string` | Unique Firebase UID of the user. |
| `sessionId` | `string` | Unique identifier for the chat session. |
| `timestamp` | `timestamp` | Server-side creation time. |
| `sanitizedPrompt` | `string` | The prompt after PII/Secret redaction. |
| `detectionFlags` | `string[]` | Types of security triggers detected (e.g., `EMAIL`, `AWS_KEY`). |
| `entropy` | `number` | Shannon entropy score of the input. |
| `detectionLevel` | `integer` | 0: Clean, 1: Info, 2: Suspicious, 3: Adversarial. |
| `escalationRecommended` | `boolean` | True if high-risk patterns were detected. |
| `reviewed` | `boolean` | Whether an analyst has reviewed the log. |
| `status` | `string` | The current status of the log (e.g., `PENDING_REVIEW`, `REVIEWED`). |
| `resultantSeverity` | `string` | Final severity assigned by an analyst (Clean to Adversarial). |
| `response` | `string` | The AI's generated response to the prompt. |
| `promptTokens` | `number` | Optional provider-reported prompt token count for safeguarded downstream responses. |
| `completionTokens` | `number` | Optional provider-reported completion token count. |
| `totalTokens` | `number` | Optional total token count returned by the responder provider. |
| `contextWindowLimit` | `number` | Optional admin-configured context window used for headroom estimation. |
| `contextWindowUtilization` | `number` | Optional estimated percentage of context consumed by the responder call. |
| `promoted` | `boolean` | Whether the log has been added to the Golden Set. |
| `source` | `string` | Provenance of the record, such as `analyst_chat` or `bulk_ingest`. |
| `batchId` | `string` | Unique identifier for a specific bulk ingest run. |
| `expectedVerdict` | `string` | The pre-labeled expected outcome (e.g., `Adversarial`) for DPO analysis. |

## 🏗️ Deployment Architecture

- **Cloud Infrastructure**: Transitional local/Firebase alpha today, AWS target architecture next (ECS Fargate, API Gateway, Bedrock).
- **Containerization**: Docker (Multi-stage builds, non-root execution).
- **Inference Gateway**: Backend `/v1/intercept` gateway stub today, AWS-authenticated API Gateway/ECS path planned.

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS 4, Shadcn UI.
- **Charting**: Recharts (Composable React charting library).
- **UI/UX**: Modernized dark-themed interface with Geist typography, fluid animations, and an **auto-resizing chat input** with smart scrolling for lengthy prompts.
- **Backend/Database**: Firebase Authentication + Firestore in the current alpha, with an Express TypeScript backend gateway added for secure intercept flow.
- **Inference Engine**: Browser-side inference disabled. The current product posture is firewall-and-forward, with clean prompts intended to route through the backend gateway to managed providers.
- **Animations**: Motion (Framer Motion).
- **Responsive Layout**: Optimized flexbox architecture ensuring sidebars and chat windows maintain visibility and scrollability during high-volume interactions.

## 🚀 Getting Started

### Environment Variables

> [!WARNING]
> Never commit `.env` to version control. For production deployments, 
> use AWS Secrets Manager as documented in the SBOM.

Create a `.env` file only for app-local values such as:
```env
VITE_API_BASE_URL=http://127.0.0.1:18080
```

### Installation
1. Clone the repository.
2. Install dependencies: `npm install`
3. Start the development server: `npm run dev`

For local review without Google authentication, use **Continue in Local Review Mode** on `localhost`. Direct browser-side inference is disabled so provider secrets do not ship in the client bundle. To route clean prompts through the local backend stub, start `APP_PORT=18080 npm run backend:dev` and run the frontend with `VITE_API_BASE_URL=http://127.0.0.1:18080 npm run dev`.

For the Docker demo stack on `http://localhost:3000`, the frontend uses same-origin proxying to reach the backend. Analyst Chat clean traffic still uses `/v1/intercept` even when `VITE_API_BASE_URL` is unset, and the admin-only gear under **System Status** now only controls optional responder telemetry such as max context window.

For stable local demo secrets, the Docker stack now reads provider credentials from a gitignored file at `.env.demo.local`. This keeps backend-only credentials stable across `docker compose up --build`, container recreates, and laptop restarts without committing secrets to the repo.

For local translation testing, use Lara Translate through the local Counter-Spy.ai backend:

```bash
APP_PORT=18080 npm run backend:dev
VITE_API_BASE_URL=http://127.0.0.1:18080 npm run dev
```

Then set the backend env vars:

- `LARA_ACCESS_KEY_ID`
- `LARA_ACCESS_KEY_SECRET`
- optional `LARA_API_BASE_URL` if you are not using the default Lara host

Then open the Playground and use **Use Recommended Settings** in the Normalize - Translate panel. The current translation path is hardcoded to:

- Provider: `lara`
- Mode 1: auto-detect source -> `English`
- Mode 2: `English` -> analyst-selected foreign target language
- Credentials: backend-only

Translation still runs only when you explicitly click **Run Normalize -> Translate** in the Playground. It is not executed on every prompt edit or submission.

For the Docker demo stack, place Lara credentials in `.env.demo.local`:

```env
LARA_ACCESS_KEY_ID=your_lara_access_key_id
LARA_ACCESS_KEY_SECRET=your_lara_access_key_secret
LARA_API_BASE_URL=https://api.laratranslate.com
```

That file is ignored by git and is the preferred stable local-demo path for Lara configuration.

### Customization
The branding shield is bundled at `public/brand/counter-spy-shield.png`, with the original source image preserved at `public/brand/counter-spy-shield-original.png`. To change the app chrome logo, replace the display PNG or update the `APP_LOGO_URL` constant in `src/App.tsx`.

## 🔒 Data Disclosure Detection

To detect and prevent unauthorized data disclosure, a unique **Canary Token** is embedded within the system's documentation. This token is strictly monitored and must not be disclosed within training data, audit logs, prompts, or AI responses.

The sanitization pipeline is configured to automatically redact this token if it appears in any system interaction.

Alongside the canary token, the System Configuration view computes a SHA-256 fingerprint for both the recommended prompt baseline and the currently active configuration. This gives analysts and incident responders a quick way to detect prompt drift or unauthorized configuration changes without diffing long prompt text by hand.

## 📜 Governance Policy
This application is designed for security professionals. All bypass attempts are automatically detected, blocked, and permanently logged in the immutable Audit Trail. Attempting to bypass the sanitization layer is a violation of the system's governance policy.

## 📎 Third-Party Attribution

- **Arcanum Prompt Obfuscator / Arcanum PI Taxonomy**
  - Attribution: Jason Haddix / Arcanum Information Security
  - Source basis noted in the original generated file header: "Arcanum Prompt Obfuscator" (`CC BY 4.0 — attribution required`)
  - Counter-Spy.ai modifications: refactored the generated obfuscation logic for browser-safe execution, reorganized technique metadata for Prompt Playground use, and selectively promoted high-signal techniques into the detection pipeline.

- **Regex Detection Pattern Lineage**
  - Attribution: regex prompt-injection pattern work originally sourced from `dimitritholen`
  - Counter-Spy.ai modifications: internalized the patterns into the local firewall, reformatted them for UI management, combined them with additional governance metadata, and extended their usage into tuning and review workflows.
