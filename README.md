# Counter-Spy.ai: Adversary-Aware Security Governance Assistant

Counter-Spy.ai is a specialized security operations platform designed to provide citation-backed advisory guidance while maintaining strict governance over AI interactions. It features a multi-layered sanitization pipeline that detects and intercepts adversarial attempts before they reach the LLM.

## 📚 Documentation
- [Technical Architecture & Specifications](./docs/ARCHITECTURE.md) - Deep dive into the Shield-and-Sword pattern and heuristics.
- [Analyst & Administrator Operations Guide](https://github.com/natecarroll-hue/CounterAgent/blob/main/OPERATIONS_GUIDE.MD) - Standard Operating Procedures for SOC personnel.

> [!IMPORTANT]
> **Sanitized Pass-through Guarantee**: Only the redacted version of a prompt is ever sent to the inference engine. Raw PII and secrets are neutralized at the local sanitization layer before any external API call is initiated.

## 🛡️ Core Security Architecture

The application implements a **Defense-in-Depth** strategy for AI interactions:

### 1. Local Sanitization Pipeline (The Filter)
Before any prompt is sent to the AI model, it passes through a local TypeScript-based sanitization layer:
- **PII & Secret Redaction**: Automatically detects and masks emails, AWS keys, IP addresses, credit card patterns, phone numbers, and SSNs. It also redacts the actual values of secret keys and passwords.
- **Regex Detection**: Evaluates input against configurable regular expressions to catch sophisticated prompt injection and instruction bypass attempts. Supports `break-all` formatting for complex, lengthy patterns.
- **Normalization**: Flattens input (e.g., leetspeak conversion) to prevent keyword bypasses.
- **Entropy Analysis (Sliding Window)**: Calculates Shannon entropy using a sliding window approach (35-character windows, 5-character steps) to detect localized high-entropy payloads (Base64, Hex, etc.) and prevent **Token Dilution** attacks. 
  - **Math**: $$H(X) = -\sum_{i=1}^{n} P(x_i) \log_2 P(x_i)$$
  - **Global Entropy**: The average randomness across the entire prompt.
  - **Max Window Entropy**: The highest randomness found in any specific 35-character chunk. This defeats token dilution, where an attacker attempts to hide a high-entropy payload within paragraphs of normal, low-entropy text.
  - **Thresholds**: Normal < 4.5, Suspicious 4.5-5.5, Adversarial > 5.5.
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
- **Adversarial Interception**: If high entropy (>5.5) or high syntactic complexity (>90) is detected, the request is blocked locally as Adversarial.
- **Suspicious Interception**: If blocked keywords, forbidden topics, or suspicious entropy (>4.5) are detected, the request is blocked locally as Suspicious.
- **Human-in-the-Loop (HITL) Mode**: When activated, automatically intercepts borderline traffic (e.g., Entropy > 4.5 or Syntactic Complexity > 50) and routes it to a manual review queue (`PENDING_REVIEW`), allowing human analysts to intervene before the payload reaches the inference engine.
- **Forbidden Topics Enforcement**: A semantic governance layer that instructs the model to refuse and flag (via `[VIOLATION]` tags) any discussion of forbidden topics (e.g., Finances, Politics).

### 4. Operator Controls
- **Governance Status**:
  - **ACTIVE (Green)**: All core guardrails are enabled.
  - **REDUCED (Orange)**: One or more critical guardrails (PII Redaction, Logging, Blocked Keywords, or Blocked Topics) are disabled.
  - **DISABLED (Red)**: All guardrails are disabled.
- **Hide Simulated Traffic**: A toggleable filter in the Analyst Sidebar that instantly removes synthetic/simulated traffic from the Audit Logs and Metrics Dashboard, allowing analysts to focus on real-world adversarial activity.
- **Global System Pause (DEFCON 1)**: A real-time "kill switch" that halts 100% of automated inference. Incoming prompts are instantly routed to the manual review queue to ensure zero data leakage during coordinated attacks. The SOC dashboard transitions to a high-visibility crimson alert state.

### 5. AI Inference (Gemini 3 Flash)
- **System Instructions**: The model is governed by a strict system prompt that defines its persona as a security analyst and forbids revealing internal configurations.
- **Semantic Filtering**: The model acts as a semantic guardrail, identifying and refusing requests that relate to forbidden topics even if they don't use exact keywords.
- **Low Temperature**: Set to `0.2` to minimize stochastic variation and improve response determinism.

## 📦 Security Mitigations & Dependency Management

To ensure the integrity of the security operations platform, Counter-Spy.ai implements strict dependency governance:
- **React Server Components (RCE) Mitigation**: `react` and `react-dom` are pinned to `19.0.4` to mitigate CVE-2025-55182 and related DoS vulnerabilities.
- **Vite Dev Server Security**: Vite is upgraded to `^8.0.5` to mitigate arbitrary file read and path traversal vulnerabilities (CVE-2025-31125, CVE-2025-32395, CVE-2026-39363, GHSA-v2wj-q39q-566r, GHSA-4w7w-66w2-5vf9).
- **Stored XSS Prevention**: `react-markdown` is configured to explicitly disallow `rehype-raw`, preventing malicious HTML/JS injection from LLM outputs or compromised Firestore policy documents.
- **Supply Chain Security**: Regular expression detection patterns have been internalized rather than sourced dynamically, and CLI tools like `shadcn` are strictly isolated to `devDependencies`.

## 📊 Key Features

- **Advanced Audit Trail**: Every interaction is logged with its entropy score, detection flags, and a unique Session ID. The audit table features **multi-column sorting**, optimized column spacing, and **Full Prompt Inspection**—allowing analysts to click any truncated prompt to view the complete text in a scrollable, text-only pop-up dialog.
- **Anomaly Detection & Metrics Dashboard**: A dedicated dashboard for real-time threat velocity analysis. It compares current hourly threat rates against a 24-hour baseline to identify significant spikes in adversarial activity. Utilizes real-time Z-Score calculations ($Z = \frac{x - \mu}{\sigma}$) to distinguish between random noise and coordinated automated attacks. Features a critical alert banner for immediate incident response and a time-series chart for trend analysis.
- **Analyst Review Workflow**: Administrators can review **all** interactions (including those marked as Clean) to catch false negatives. The workflow supports **Multi-Tier Review**, allowing analysts to re-edit and update the **Resultant Severity** at any time as new threat intelligence becomes available.
  - **False Negative Highlighting**: Logs pre-labeled as "Adversarial" (via the Bulk Ingestor) that are classified as "Clean" by the system are automatically highlighted with a red border and an **FN (False Negative)** badge, allowing for rapid identification of firewall bypasses.
  - *The platform automatically calculates both the strict False Positive Rate (FPR) and the Analyst Reclassification Rate, ensuring the firewall's regex and entropy thresholds can be tuned to balance robust security with a frictionless user experience.*
- **Automated Golden Set Refinement**: Administrators can "Promote" specific audit logs to a **Golden Set** for future DPO (Direct Preference Optimization) fine-tuning. This captures the prompt, the AI's response, and a user-provided "Rejected" reason in a structured JSON format. Supports **one-click JSON export** of the entire set for training pipelines.
- **Dynamic Guardrails**: Administrators can toggle security features (PII Redaction, Entropy Filtering, Blocked Keywords, Blocked Topics, Logging, etc.) on the fly.
- **Knowledge Base**: Integrated security policies, MITRE ATLAS mapping, Markdown-rendered System Configuration, and full lifecycle management (upload/delete) of custom `.md` documents. Includes a dedicated **Fine-Tuning Training Data** section for managing the Golden Set.
- **Analyst Mode**: A toggleable administrative view for managing system configurations and reviewing logs.
- **Analyst Playground**: A dedicated sandbox environment featuring the Syntactic Complexity Analyzer, allowing security teams to test and tune firewall thresholds against complex prompt injection attempts in real-time.
- **Bulk Ingest Simulator**: A high-velocity ingestion utility for processing `.txt` files of prompts (one per line). Features **Base Delay + Random Jitter** (3-10s) to simulate realistic traffic patterns while respecting API rate limits. Integrated with the **Screen Wake Lock API** to maintain session persistence during long-running batch operations.
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
| `promoted` | `boolean` | Whether the log has been added to the Golden Set. |
| `isSimulation` | `boolean` | True if the log originated from the Bulk Ingest Simulator. |
| `batchId` | `string` | Unique identifier for a specific bulk ingest run. |
| `expectedVerdict` | `string` | The pre-labeled expected outcome (e.g., `Adversarial`) for DPO analysis. |

## 🏗️ Deployment Architecture

- **Cloud Infrastructure**: AWS (ECS Fargate, Bedrock) · Google Cloud (Firestore via Firebase).
- **Containerization**: Docker (Multi-stage builds, non-root execution).
- **Inference Gateway**: Hybrid support for `@google/genai` and AWS Bedrock SDK.

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS 4, Shadcn UI.
- **Charting**: Recharts (Composable React charting library).
- **UI/UX**: Modernized dark-themed interface with Geist typography, fluid animations, and an **auto-resizing chat input** with smart scrolling for lengthy prompts.
- **Backend/Database**: Firebase (Firestore, Authentication).
- **AI Engine**: Gemini 3 Flash via `@google/genai` (`^1.48.0`).
- **Animations**: Motion (Framer Motion).
- **Responsive Layout**: Optimized flexbox architecture ensuring sidebars and chat windows maintain visibility and scrollability during high-volume interactions.

## 🚀 Getting Started

### Environment Variables

> [!WARNING]
> Never commit `.env` to version control. For production deployments, 
> use AWS Secrets Manager as documented in the SBOM.

Create a `.env` file with the following:
```env
GEMINI_API_KEY=your_gemini_api_key
```

### Installation
1. Clone the repository.
2. Install dependencies: `npm install`
3. Start the development server: `npm run dev`

### Customization
To update the application logo, modify the `APP_LOGO_URL` constant in `src/App.tsx`. This constant should point to a public URL of your desired PNG image.

## 🔒 Data Disclosure Detection

To detect and prevent unauthorized data disclosure, a unique **Canary Token** is embedded within the system's documentation. This token is strictly monitored and must not be disclosed within training data, audit logs, prompts, or AI responses.

The sanitization pipeline is configured to automatically redact this token if it appears in any system interaction.

## 📜 Governance Policy
This application is designed for security professionals. All bypass attempts are automatically detected, blocked, and permanently logged in the immutable Audit Trail. Attempting to bypass the sanitization layer is a violation of the system's governance policy.
