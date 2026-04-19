# Technical Reference & Architecture Specification: Counter-Spy.ai

**Version:** 1.9.3-Alpha  
**Status:** Internal Review / Architecture Update  
**Classification:** Proprietary / AppSec Engineering  

---

## 1. Architecture Deep Dive: The 'Shield-and-Sword' Pattern

Counter-Spy.ai employs a **Shield-and-Sword** architectural pattern to secure Large Language Model (LLM) interactions. This multi-stage defense-in-depth strategy ensures that adversarial payloads are neutralized at the edge before reaching high-compute inference engines.

### 1.0 Current Alpha Implementation
The current Alpha was developed using **Google AI Studio** as a React/Vite/Firebase application. Governance is enforced by local TypeScript sanitization logic in the client, with Firebase Authentication for user identity and Firestore for audit logs, knowledge-base content, and synchronized governance configuration.

### 1.1 Logical Flow
The system bifurcates the request lifecycle into two distinct phases:
1.  **The Shield (Local Sanitization & Governance):** A low-latency engine that performs heuristic analysis, PII redaction, and policy enforcement.
2.  **The Sword (Production Inference):** The primary LLM (e.g., Gemini 3 Flash) which receives only the "cleansed" and governed payload.

### 1.2 System Resilience & Fallback Policies
The Alpha implementation adheres to a **Fail-Secure** philosophy across all critical components:

| Component | Failure Scenario | Policy | Outcome |
| :--- | :--- | :--- | :--- |
| **Shield Engine** | Timeout / 5xx Error | **Fail-Secure** | Request is blocked; user receives a 503 Service Unavailable. |
| **Governance Sync** | Database Connection Loss | **Fail-Secure** | System defaults to `isGlobalPause: true` until state is verified. |
| **Sanitization** | ReDoS / Logic Error | **Fail-Secure** | Execution halts; payload is discarded and logged as `Adversarial`. |

---

## 2. Heuristic Logic & Mathematical Intent

### 2.1 Shannon Entropy Sliding Window
To defeat **Token Dilution**, the system utilizes a **Sliding Window Shannon Entropy** calculation.
*   **Formula:** $H(X) = -\sum_{i=1}^{n} P(x_i) \log_2 P(x_i)$
*   **Intent:** By isolating high-entropy spikes (e.g., Base64 shellcode) in 35-character windows, the system identifies obfuscated payloads that would otherwise be averaged out in a global entropy check.

### 2.2 Syntactic Complexity Scoring
The analyzer uses a weighted heuristic to detect "Instruction Stacking":
*   **Constraint Density (High Weight):** Frequency of imperative keywords.
*   **Special Char Ratio (Medium Weight):** Inverse-match regex `/[a-zA-Z0-9\s]/g` to detect code-like syntax.
*   **Thresholds:** Scores > 50 trigger `Suspicious` classification; scores > 90 trigger `Adversarial` classification.

---

## 3. State Management & Persistence

### 3.1 Global Pause (HOTL) Persistence
The governance state is persisted in Firestore (`config/governance`). 
*   **Container Restart Behavior:** Upon initialization, the system defaults to a **Fail-Secure (Paused)** state. It remains in this state until a successful handshake with the database confirms the current `isGlobalPause` value. This prevents "Fail-Open" windows during container scaling or recovery events.

### 3.2 Audit Log Retention
*   **Policy:** By default, logs are intended to be permanent for forensic auditability.
*   **Cost Management:** The Alpha supports **Firestore TTL (Time-to-Live)**. Administrators can designate a TTL policy field in the Google Cloud Console, enabling automatic purging of logs older than a defined retention period (e.g., 90 days).

> [!NOTE]
> **Forensic Gap Awareness**: Firestore audit logs are retained independently of Google's Gemini API abuse monitoring window (55 days). For incidents requiring cross-referencing Gemini-side request logs, forensic analysis must occur within this 55-day window.

---

## 4. Security Mitigations

### 4.1 Anti-ReDoS Circuit Breaker
*   **Logic:** Every `sanitizeInput` execution is wrapped in a high-resolution timing block (`performance.now()`).
*   **Threshold:** 100ms.
*   **Policy:** Any payload causing execution to exceed 100ms is treated as a potential ReDoS attack. The process is killed, and the event is logged as `Adversarial` with the `REDOS_ATTEMPT` flag.

---

## 5. Future Gateway Architecture: `/v1/intercept`

The `/v1/intercept` endpoint is a planned gateway interface, not part of the current Alpha implementation. It is retained here as a roadmap reference for future service-to-service deployments that place Counter-Spy.ai between external clients and production inference services.

### 5.1 Authentication
Future external services would authenticate with the Counter-Spy gateway using **Bearer Tokens (JWT)**. 
*   **Header:** `Authorization: Bearer <JWT_TOKEN>`
*   **Validation:** 
    *   **Provider:** Tokens are validated against the configured Auth Provider (Firebase/OIDC).
    *   **Claims:** Validation requires `sub` (subject), `aud` (audience), and `exp` (expiration).
    *   **Policy:** Tokens are validated per-request; no local caching of validation state is performed in the Alpha to ensure immediate revocation propagation.
    *   **TTL:** Token lifespan and refresh cycles are governed by the Identity Provider's policy.
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
*   **Implementation Details**: For detailed dashboard telemetry and SOPs, refer to the [Analyst & Administrator Operations Guide](./ANALYST_GUIDE.md).
