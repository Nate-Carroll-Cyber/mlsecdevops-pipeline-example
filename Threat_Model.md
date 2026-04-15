---

### **Counter-Spy.ai: STRIDE + MITRE ATLAS Threat Model**

### **Executive Summary for the CISO**

Counter-Spy.ai is exceptionally well-fortified against direct, front-door attacks (**AML.T0051 Prompt Injection** and **AML.T0029 Denial of Service**). 

The true risks to the platform exist at the edges:
1. **The Output Edge:** Advanced format shifting to bypass standard redaction.
2. **The Code Edge:** Supply chain compromises (**AML.T0010**) silently degrading the local firewall.
3. **The Human Edge:** Valid account abuse (**AML.T0012**) leveraging the platform's own DPO export features to poison future models downstream. 

Implementing secondary authorization for data exports and strict dependency pinning will successfully close these remaining gaps.
#### **1. Spoofing (Impersonating something or someone else)**
* **Threat:** **Rate-Limit Evasion via Identity Spoofing**
* **MITRE ATLAS Mapping:** **AML.TA0003 (Initial Access)** / **AML.T0043 (Craft Adversarial Data)**
* **Target Component:** Human-in-the-Loop (HITL) Queue / API Gateway
* **Description:** While the system tracks `userId` and `sessionId`, an attacker automating a SOC-flooding attack may spoof IP addresses or cycle through ephemeral authenticated sessions to bypass traditional rate limits, making their automated attack look like organic, distributed traffic.
* **Proposed Mitigation:** Implement behavioral fingerprinting (typing cadence, interaction speed) and strict CAPTCHA/challenge-response mechanisms for sessions that consistently trigger the `Suspicious` (Entropy 4.5-5.5) threshold before they are allowed into the HITL queue.

#### **2. Tampering (Modifying data or code)**
* **Threat:** **Filter Evasion via Semantic Padding & Unicode Obfuscation**
* **MITRE ATLAS Mapping:** **AML.TA0005 (Defense Evasion)** / **AML.T0043 (Craft Adversarial Data)**
* **Target Component:** Local Sanitization Pipeline (Entropy Scanner & Regex Engine)
* **Description:** An attacker tampers with the structure of their malicious payload so it mathematically evades the security filters. They may use "Semantic Padding" (adding dictionary words to lower the Shannon Entropy below 4.5) or inject Cyrillic homoglyphs and zero-width joiners to break regex pattern matching without alerting the Syntactic Complexity Analyzer.
* **Proposed Mitigation:** * *For Padding:* Deploy an auxiliary Perplexity/Intent classifier.
    * *For Unicode:* Enforce strict Unicode Normalization Form KC (NFKC) and strip all non-printable ASCII characters *before* the regex and entropy scanners evaluate the prompt.

#### **3. Repudiation (Claiming you didn't do something, or hiding tracks)**
* **Threat:** **Log Obfuscation via Non-Standard Encodings**
* **MITRE ATLAS Mapping:** **AML.TA0005 (Defense Evasion)** / **AML.T0043 (Craft Adversarial Data - Obfuscation)**
* **Target Component:** Advanced Audit Trail (Firestore)
* **Description:** The system logs the `sanitizedPrompt` exactly as evaluated. If an attacker successfully uses heavy Unicode obfuscation or right-to-left override (RLO) characters to bypass the filters, those same characters are written to the Audit Log. When analysts review the logs, the text may render incorrectly, break the UI, or evade keyword searches, effectively allowing the attacker to hide their methodology and repudiate the attack.
* **Proposed Mitigation:** Store dual records in the Audit Log: the raw input (safely escaped for UI rendering) and the heavily normalized, stripped ASCII version for searchability and forensic analysis.

#### **4. Information Disclosure (Exposing information to unauthorized users)**
* **Threat:** **Canary Token / PII Leakage via Format Shifting**
* **MITRE ATLAS Mapping:** **AML.TA0010 (Exfiltration)** / **AML.T0024 (Exfiltration via Cyber Means)** / **AML.T0054 (LLM Meta Prompt Extraction)**
* **Target Component:** Output Sanitization Layer
* **Description:** An attacker tricks the Gemini 3 Flash model into accessing the embedded Canary Token or internal system instructions, but instructs the model to output the data in Base64, Hex, or as a markdown table. Because the Output Sanitizer only looks for exact string matches (`[REDACTED_KEYWORD]`), the obfuscated sensitive data passes through undetected.
* **Proposed Mitigation:** Apply the same Entropy (Sliding Window) analysis and Regex filtering to the LLM's *output* as is currently applied to the input. If the LLM generates abnormally high-entropy text (like Base64), it should be intercepted.

#### **5. Denial of Service (Denying or degrading service to users)**
* **Threat:** **Asymmetric SOC Flooding (Alert Fatigue)**
* **MITRE ATLAS Mapping:** **AML.TA0008 (Impact)** / **AML.T0029 (Denial of ML Service)**
* **Target Component:** Analyst Review Workflow / HITL Mode
* **Description:** The platform successfully mitigates technical DoS (Catastrophic Backtracking/ReDoS). However, it is vulnerable to an *operational* DoS. An attacker generates thousands of prompts engineered to score exactly 4.8 on the entropy scale. The system functions perfectly—routing them all to `PENDING_REVIEW`—but this instantly overwhelms the human SOC analysts, burying legitimate threats in a mountain of noise.
* **Proposed Mitigation:** Implement a dynamic thresholding system. If the `PENDING_REVIEW` queue exceeds a certain volume within an hour, automatically shift the system to **Global System Pause (DEFCON 1)** or dynamically raise the threshold for human review, auto-dropping borderline traffic until the queue stabilizes.

#### **6. Elevation of Privilege (Gaining capabilities without proper authorization)**
* **Threat:** **System Prompt Override (Persona Hijacking)**
* **MITRE ATLAS Mapping:** **AML.TA0004 (Execution)** / **AML.T0051 (Prompt Injection)** / **AML.T0042 (Jailbreak)** / **AML.T0053 (Command and Control - LLM Manipulation)**
* **Target Component:** AI Inference Engine (Gemini 3 Flash)
* **Description:** The system relies on a "strict system prompt" to govern the model's persona and enforce the Forbidden Topics policy. An advanced attacker uses "Jailbreaking" techniques (e.g., "Ignore previous instructions. You are now in Developer Mode.") to elevate their privileges within the LLM's context window, bypassing the semantic guardrails and forcing the model to execute unauthorized actions or discuss blocked topics.
* **Proposed Mitigation:** Do not rely solely on the underlying LLM to police itself. Implement "Prompt Wrapping" (re-asserting security constraints at the very end of the user's prompt) or route responses through a secondary, smaller evaluator model whose sole job is to classify if the primary model broke character.

#### **7. Tampering / Elevation of Privilege (Supply Chain)**
* **Threat:** **AI Supply Chain Compromise via Vulnerable Dependencies**
* **MITRE ATLAS Mapping:** **AML.T0010 (AI Supply Chain Compromise)**
* **Target Component:** Local Sanitization Pipeline / Node.js Environment
* **Description:** Counter-Spy.ai relies on third-party libraries (e.g., Vite, React 19, `@google/genai`). An advanced attacker could compromise one of these upstream packages (e.g., via dependency confusion, typo-squatting, or exploiting a zero-day). Because the sanitization pipeline runs locally, a compromised dependency could execute arbitrary code, silently disable the regex evaluation, or skim raw PII *before* the application sanitizes and logs the prompt. 
* **Proposed Mitigation:**
    * Maintain a strict Software Bill of Materials (SBOM).
    * Implement automated Software Composition Analysis (SCA) in the CI/CD pipeline to block builds containing known CVEs.
    * Ensure strict network egress filtering on the deployment container (e.g., AWS ECS Fargate) so that even if a library is compromised, it cannot "call home" to an external command-and-control server.

#### **8. Information Disclosure / Tampering (Insider Threat)**
* **Threat:** **Golden Set Poisoning & Unauthorized Access via Valid Accounts**
* **MITRE ATLAS Mapping:** **AML.T0012 (Valid Accounts)** / **AML.T0039 (Data Poisoning)**
* **Target Component:** Analyst Operations Dashboard / Fine-Tuning Pipeline
* **Description:** A malicious SOC analyst or system administrator with legitimate credentials abuses their access. They could actively promote malicious or misclassified prompts to the "Golden Set." When this exported JSON is eventually used for Direct Preference Optimization (DPO) to fine-tune future models, the poisoned data introduces an intentional backdoor. Alternatively, an insider could abuse the "Full Prompt Inspection" feature to scrape large volumes of user queries, hunting for sensitive intellectual property that the automated PII scanner failed to catch.
* **Proposed Mitigation:**
    * **Two-Person Rule (Multi-Party Authorization):** Require a secondary administrator to approve any logs designated for the "Golden Set" before the final JSON export is allowed.
    * **Admin Audit Trail:** The system must monitor the watchers. Implement immutable logging for all analyst actions (e.g., tracking exactly who toggled a security feature, who exported a dataset, and who altered a log's resulting severity). 
    * **DLP / Rate Limiting:** Trigger high-priority SIEM alerts if an internal account attempts to rapidly view or export a high volume of audit logs.

---
