# Technical Reference & Architecture Specification: Counter-Spy.ai

**Version:** v2.1  
**Status:** Beta / Promotion to Beta  
**Classification:** Proprietary / AppSec Engineering  

---

## 1. Architecture Deep Dive: The 'Shield-and-Sword' Pattern

Counter-Spy.ai employs a **Shield-and-Sword** architectural pattern to secure Large Language Model (LLM) interactions. This multi-stage defense-in-depth strategy ensures that adversarial payloads are neutralized at the edge before reaching high-compute inference engines.

### 1.0 Current Beta Implementation
The current Beta is a React/Vite/Firebase application with a TypeScript/Express backend gateway. Governance is still enforced first by local TypeScript sanitization logic in the client, while backend routes now own the secure intercept path, downstream responder handoff, manual Lara translation proxying, and the Sam Spade CTF API. Firebase Authentication still provides user identity and Firestore still stores audit logs, knowledge-base content, and synchronized governance configuration.

### 1.1 Logical Flow
The system bifurcates the request lifecycle into two distinct phases:
1.  **The Shield (Local Sanitization & Governance):** A low-latency engine that performs heuristic analysis, PII redaction, and policy enforcement.
2.  **The Sword (Backend-Mediated Inference):** The downstream responder receives only the governed payload through the backend `/v1/intercept` route. Credentials remain backend-owned, while the UI can provide browser-local Base URL and Model ID overrides for clean traffic without exposing provider secrets in the browser.
    *   **Current prompt-contract note:** The active decision model is guided by the visible firewall prompt, the active guardrails policy, optional forbidden-topics guidance, and relevant Knowledge Base policy context. The separate downstream responder prompt remains reserved for a later multi-stage responder architecture.
    *   **Current forbidden-category note:** The saved firewall prompt now explicitly instructs the decision model to treat the configured high-level forbidden categories semantically, including indirect, paraphrased, translated, obfuscated, or substantially equivalent forms, while storytelling remains non-exempt if used to smuggle one of those categories.
    *   **Current telemetry and gating note:** When the provider returns usage metadata, the gateway surfaces prompt/completion/total token counts. The browser can also apply an operator-supplied max context window as a pre-submit gate in Analyst Chat and the Prompt Playground, then reuse that same value to compute post-run context utilization for audit review.
*   **Manual Translation Gateway (`/v1/translate`)**:
    *   Owns backend-only Lara Translate access for the Playground.
    *   Runs only when an analyst explicitly triggers the Normalize - Translate pipeline.
    *   Supports two modes:
        *   auto-detect source -> English recovery
        *   English -> selected foreign-language variant generation
    *   Keeps translation licensing/cost exposure bounded by avoiding automatic calls on prompt edits or standard submissions.

### 1.2 System Resilience & Fallback Policies
The Beta implementation adheres to a **Fail-Secure** philosophy across all critical components:

| Component | Failure Scenario | Policy | Outcome |
| :--- | :--- | :--- | :--- |
| **Shield Engine** | Timeout / 5xx Error | **Fail-Secure** | Request is blocked; user receives a 503 Service Unavailable. |
| **Governance Sync** | Database Connection Loss | **Best-Effort Sync** | The app keeps its current in-memory/default governance state. It does not automatically force `isGlobalPause: true` on startup or sync failure. |
| **Sanitization** | ReDoS / Logic Error | **Fail-Secure** | If sanitization latency exceeds 100ms, the triggering request is blocked before inference, logged as `Adversarial` with `ReDoS_ATTEMPT_DETECTED`, and automatic Global System Pause is activated for subsequent traffic. |

---

## 2. Heuristic Logic & Mathematical Intent

### 2.1 Shannon Entropy Sliding Window
To defeat **Token Dilution**, the system utilizes a **Sliding Window Shannon Entropy** calculation.
*   **Formula:** $H(X) = -\sum_{i=1}^{n} P(x_i) \log_2 P(x_i)$
*   **Intent:** By isolating high-entropy spikes (e.g., Base64 shellcode) in 35-character windows, the system identifies obfuscated payloads that would otherwise be averaged out in a global entropy check.

### 2.1.1 English-Likeness Heuristic
To catch substitution-cipher gibberish that still looks like ordinary alphabetic prose, the frontend sanitizer also evaluates a bounded English-likeness heuristic.
*   **Intent:** Detect long alphabetic token sequences with weak English trigram support, high token uniqueness, and prose-like spacing that would evade raw entropy checks.
*   **Current Policy:** This heuristic is treated as an obfuscation-family signal, not a mild language warning. When it fires, the prompt is classified as `Adversarial`.

### 2.1.2 Entropy Policy Bands
Entropy is now evaluated with one shared policy across the live sanitizer, Audit Logs, and Metrics.
*   **Allowed:** `<= 3.6`
*   **Suspicious:** `> 3.6` and `<= configured Entropy Threshold`
*   **Adversarial:** `> configured Entropy Threshold`
*   **Intent:** Keep the governance slider focused on the operator-chosen adversarial ceiling while preserving a stable suspicious floor for concealment review.

### 2.2 Syntactic Complexity Scoring
The analyzer uses a weighted heuristic to detect "Instruction Stacking":
*   **Constraint Density (High Weight):** Frequency of imperative keywords.
*   **Special Char Ratio (Medium Weight):** Inverse-match regex `/[a-zA-Z0-9\s]/g` to detect code-like syntax.
*   **Thresholds:** Scores > 50 contribute to `Suspicious` classification; scores > 90 independently trigger `Adversarial` classification.

### 2.3 Obfuscation Severity Policy
The current Beta now enforces a stricter plain-text-English-chatbot posture for concealment attempts.
*   **Policy:** Any recognized obfuscation signal is classified as `Adversarial`, regardless of whether later recovery would have revealed otherwise benign content.
*   **Covered families:** URL encoding, HTML entities, unicode escapes, compatibility glyphs, symbol substitution, leetspeak, ROT13, reverse text, NATO phonetic, Morse code, braille, regional indicators, recursive decode chains, chunking, variable expansion, vertical text, coordinate ciphers, and low-English-likeness alphabetic gibberish.
*   **Reasoning:** Counter-Spy.ai now treats concealment itself as hostile behavior in the governed prompt path, rather than as a lower-severity curiosity that waits for a second content-based match.
*   **Execution boundary:** Recognized obfuscation-family adversarial verdicts are terminal at the local shield layer. Those prompts should not proceed into the backend `/v1/intercept` path, and backend-availability fallback messages should only appear for prompts that were locally eligible for downstream inference.
*   **Known coverage gap:** The current vertical-text detector is strongest on narrow one-character-per-line layouts. Position-indexed or more structured vertical layouts may still bypass this family detector until coverage is broadened.

---

## 3. State Management & Persistence

### 3.1 Global Pause (HOTL) Persistence
The governance state is persisted in Firestore (`config/governance`). 
*   **Current runtime behavior:** The frontend initializes `isGlobalPause` to `false` and then overlays Firestore state when the governance document arrives. In local review mode the same state remains in memory only. Operators should not assume startup automatically begins in a paused state.

### 3.2 Audit Log Retention
*   **Policy:** By default, logs are intended to be permanent for forensic auditability.
*   **Cost Management:** The Beta supports **Firestore TTL (Time-to-Live)**. Administrators can designate a TTL policy field in the Google Cloud Console, enabling automatic purging of logs older than a defined retention period (e.g., 90 days).

> [!NOTE]
> **Forensic Gap Awareness**: Firestore audit logs are retained independently of any downstream provider-side abuse monitoring window. If provider-side request logs are part of an investigation, forensic correlation must still happen inside that provider's retention window.

---

## 4. Security Mitigations

### 4.1 Anti-ReDoS Circuit Breaker
*   **Logic:** Every `sanitizeInput` execution is wrapped in a high-resolution timing block (`performance.now()`).
*   **Threshold:** 100ms.
*   **Policy:** Any sanitization pass completing above 100ms is treated as a potential ReDoS event. The triggering request is blocked before inference, logged as `Adversarial` with the `ReDoS_ATTEMPT_DETECTED` flag, and contributes to both the `ReDoS Trips` resilience metric and the Defense Funnel's pre-inference blocked count.

---

## 5. Gateway Architecture: `/v1/intercept`

The `/v1/intercept` endpoint is now part of the current Beta implementation. It serves as the live backend gateway between the frontend control plane and downstream inference services, while still matching the longer-term service-to-service architecture planned for ECS.

### 5.1 Authentication
Future external services would authenticate with the Counter-Spy gateway using **Bearer Tokens (JWT)**. 
*   **Header:** `Authorization: Bearer <JWT_TOKEN>`
*   **Validation:** 
    *   **Provider:** Tokens are validated against the configured Auth Provider (Firebase/OIDC).
    *   **Claims:** Validation requires `sub` (subject), `aud` (audience), and `exp` (expiration).
    *   **Policy:** Tokens are validated per-request; no local caching of validation state is performed in the Beta to ensure immediate revocation propagation.
    *   **TTL:** Token lifespan and refresh cycles are governed by the Identity Provider's policy.
*   **Current Beta Note:** In dev, the backend can run without a bearer token. Outside dev, `INTERCEPT_BEARER_TOKEN` can be required before the gateway serves `/v1/intercept`.
*   **Additional Future Support:** Integration with **AWS IAM SigV4** is planned for service-to-service communication within VPC environments.

### 5.2 Endpoint Specification
`POST /v1/intercept`

**Request Body (JSON):**
| Field | Type | Description |
| :--- | :--- | :--- |
| `prompt` | `string` | The raw input string to be sanitized. |
| `userId` | `string` | The unique identifier for the requesting user. |
| `sessionId` | `string` | The identifier for the current interaction session. |
| `metadata` | `object` | Optional key-value pairs for additional context. |

**Response Definitions:**
| Code | Status | Description |
| :--- | :--- | :--- |
| `200` | `CLEAN` | Payload passed all guardrails. |
| `202` | `QUEUED` | Payload intercepted for HITL/HOTL review. |
| `401` | `UNAUTHORIZED` | Missing or invalid Bearer Token. |
| `403` | `INTERCEPTED` | Shield blocked payload (Adversarial/Suspicious). |
| `503` | `SHIELD_ERROR` | Fail-Secure block due to Shield Engine timeout/failure. |

Downstream responder outcomes such as `BLOCK`, `FAIL_SECURE`, `QUEUE_FOR_REVIEW`, and explicit policy-violation messages are normalized back into Counter-Spy.ai severity/status labels before they land in the audit trail.

---

## 6. Operational Controls: Telemetry Isolation

### 6.1 The `source` Field
The `source` field preserves traffic provenance without hiding data from the primary analyst views.
*   **Provenance:** Records can distinguish `analyst_chat` traffic from `bulk_ingest` traffic.
*   **DPO Labeling:** Bulk ingest logs carry `batchId` and `expectedVerdict` metadata, allowing analysts to perform "False Negative" audits while still comparing that traffic against analyst-entered activity.

### 6.2 Metrics Architecture
The platform utilizes a real-time anomaly detection engine to monitor threat velocity.
*   **Statistical Baseline:** Calculates a rolling 24-hour mean ($\mu$) and standard deviation ($\sigma$) of threat events.
*   **Z-Score Calculation:** $Z = \frac{x - \mu}{\sigma}$.
*   **Alerting Thresholds:** 
    *   **Z > 2.0**: Triggers "Anomalous Activity" dashboard alerts.
    *   **Z > 5.0**: Triggers high-priority escalation via PagerDuty/Slack integrations.
*   **Layered Defense Funnel:** The Metrics surface now tracks the governed prompt path across both enforcement layers:
    *   **Pre-Inference Block Rate:** Fraction of prompts blocked before the Safeguard LLM is invoked.
    *   **Model Intervention Rate:** Fraction of prompts that reached the Safeguard LLM and were then blocked or queued there.
    *   **Post-Model Escape Rate:** Fraction of likely malicious prompts that bypass both the pre-inference layer and the Safeguard LLM layer and still land clean or informational.
    *   **Ground-Truth Assist:** When available, bulk-ingest `expectedVerdict` labels are used to strengthen post-model escape calculations instead of relying only on final severity heuristics.
*   **Implementation Details**: For detailed dashboard telemetry and SOPs, refer to the [Analyst & Administrator Operations Guide](../OPERATIONS_GUIDE.MD).
