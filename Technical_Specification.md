---

# 🛡️ Counter-Spy.ai: Technical Reference & Architecture Specification

**Version:** 1.9.3-Alpha  
**Status:** Internal Review / Architecture Update  
**Classification:** Proprietary / AppSec Engineering

## 1. Architecture: The 'Shield-and-Sword' Pattern
Counter-Spy.ai utilizes a **Shield-and-Sword** architectural pattern to secure Large Language Model (LLM) interactions. This defense-in-depth strategy ensures that adversarial payloads are neutralized at the edge before reaching high-compute inference engines.

### 1.1 Logical Flow
The system bifurcates the request lifecycle into two distinct phases:
1.  **The Shield (Local Sanitization & Governance):** A low-latency engine that performs heuristic analysis, PII redaction, and policy enforcement via local code and a lightweight "Shield LLM" (Amazon Nova Micro).
2.  **The Sword (Production Inference):** The primary, high-reasoning LLM (e.g., Claude 3.5 Sonnet or Gemini 3 Flash) which receives only the "cleansed" and governed payload.

### 1.2 System Sequence Diagram


### 1.3 System Resilience & Fallback Policies
The Alpha implementation adheres to a **Fail-Secure** philosophy. If any security component fails, the system defaults to a "Block" state to protect the production model.

| Component | Failure Scenario | Policy | Outcome |
| :--- | :--- | :--- | :--- |
| **Shield LLM** | Timeout / 500 Error | Fail-Secure | Request is blocked; returns `503 Service Unavailable`. |
| **Governance Sync** | Database Connection Loss | Fail-Secure | System defaults to `isGlobalPause: true` until verified. |
| **Sanitization** | ReDoS / Logic Error | Fail-Secure | Execution halts; payload is discarded and logged as `Adversarial`. |

---

## 2. Core Security Heuristics

### 2.1 Shannon Entropy Sliding Window
To defeat **Token Dilution** (hiding malicious code within large blocks of text), the system utilizes a sliding window approach to calculate Shannon Entropy.
* **Formula:** $H(X) = -\sum_{i=1}^{n} P(x_i) \log_b P(x_i)$
* **Implementation:** 35-character windows with 5-character steps.
* **Intent:** By isolating spikes (e.g., Base64 shellcode or Hex strings), the system identifies obfuscated payloads that would be "averaged out" in a global check.

### 2.2 Syntactic Complexity Scoring
The analyzer uses a weighted heuristic to detect "Instruction Stacking" and model probing.
* **Constraint Density (High Weight):** Frequency of imperative keywords (e.g., *ignore, disregard, system, override*).
* **Special Char Ratio (Medium Weight):** Utilizes an inverse-match regex `/[a-zA-Z0-9\s]/g` to identify code-like syntax, URL encoding, and HTML/script tags.
* **Scoring:** Scores > 65 trigger "Suspicious" flags; > 90 trigger "Adversarial" blocks.

### 2.3 Anti-ReDoS Circuit Breaker
* **Logic:** Every `sanitizeInput` execution is wrapped in a high-resolution timing block (`performance.now()`).
* **Threshold:** 100ms.
* **Policy:** Any payload causing execution to exceed 100ms is killed and logged as a `REDOS_ATTEMPT`. This prevents attackers from locking up CPU resources via catastrophic backtracking.

---

## 3. Governance & State Management

### 3.1 Global Pause (HOTL) Persistence
The governance state is persisted in the database (`config/governance`). 
* **Container Initialization:** Upon startup, the application defaults to **Fail-Secure (Paused)**. 
* **Handshake:** It remains in a paused state until a successful handshake with the database confirms the current `isGlobalPause` value. This prevents "Fail-Open" vulnerabilities during container scaling or recovery.

### 3.2 Audit Log Retention
* **Policy:** Default logs are permanent for forensic auditability and DPO refinement.
* **Cost Management:** Supports **TTL (Time-to-Live)**. Administrators can enable TTL on the `timestamp` field to automatically purge logs older than a defined retention period (e.g., 90 days).

---

## 4. API Reference: `/v1/intercept`

### 4.1 Authentication
External services must authenticate with the gateway using **Bearer Tokens (JWT)**.
* **Header:** `Authorization: Bearer <JWT_TOKEN>`
* **Validation:** Tokens are validated against the configured Identity Provider.

### 4.2 Response Definitions
| Code | Status | Description |
| :--- | :--- | :--- |
| **200** | `CLEAN` | Payload passed all guardrails and returned inference. |
| **202** | `QUEUED` | Payload intercepted for HITL/HOTL review. |
| **401** | `UNAUTHORIZED` | Missing or invalid Bearer Token. |
| **403** | `INTERCEPTED` | Shield blocked payload (Adversarial/Suspicious). |
| **503** | `SHIELD_ERROR` | Fail-Secure block due to Shield LLM failure. |

---

## 5. Operational Controls & Telemetry

### 5.1 The `isSimulation` Flag
Used to populate dashboards for demonstrations and bulk ingest testing.
* **Isolation:** The `ThreatDashboard` filters queries to exclude logs where `isSimulation == true`.
* **DPO Labeling:** Simulated logs carry `batchId` and `expectedVerdict` metadata, allowing analysts to perform "False Negative" audits without skewing the real-world threat velocity baseline.

---
