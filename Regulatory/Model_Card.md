# Counter-Spy.ai Model Governance Card

## 1. System Role

Counter-Spy.ai is a proxy LLM-as-a-Judge and mitigation stack. It is designed to sit between user prompts and a downstream responder model, applying local sanitization, policy enforcement, structured safeguard judging, and output review before or after provider inference.

The system is model-neutral. It does not assume a fixed Gemini, OpenAI, or open-weight model. Operational deployments must attach provider-specific model cards for the configured safeguard judge and downstream responder.

## 2. Model Boundaries

- **Local sanitizer:** TypeScript policy engine that runs before external inference and enforces PII/secret redaction, entropy thresholds, regex rules, blocked keywords, forbidden phrases, language recovery, and obfuscation detection.
- **Safeguard judge:** OpenAI-compatible API endpoint called by the backend `/v1/intercept` gateway. It receives the visible Firewall Prompt, guardrails policy, relevant Knowledge Base context, and a backend-owned structured JSON verdict contract.
- **Downstream responder:** Separate responder model called only after local checks and the safeguard judge return a clean forwarding decision. It receives the Downstream Responder Prompt as its instruction.
- **Sam Spade CTF:** Governed by the shared review/audit path, but clean gameplay replies still use deterministic in-service noir response logic rather than the live downstream responder.

## 3. Runtime Configuration

Analyst Chat and Responder runtime configuration are intentionally separate.

- **Analyst Chat / safeguard configuration:** OpenAI-compatible base URL, model ID, and API key can be backend-managed through `SAFEGUARDS_*` environment variables or supplied as browser-memory-only overrides for local demos.
- **Responder configuration:** Provider, base URL, model ID, API key, and max context window can be backend-managed or supplied as browser-memory-only overrides. The responder can use an OpenAI-compatible provider or Gemini to demonstrate brokering between separate frontier model providers.
- **Credential handling:** Browser-entered safeguard and responder API keys are held in memory only and are not intended to be committed to source control.

## 4. Decision Contract

The safeguard path expects structured decisions such as `ALLOW_AND_FORWARD`, `BLOCK`, `QUEUE_FOR_REVIEW`, and `FAIL_SECURE`. The backend maps these decisions into Counter-Spy.ai outcomes such as `CLEAN`, `SUSPICIOUS`, `ADVERSARIAL`, or `PENDING_REVIEW` before audit and metrics processing.

The visible Firewall Prompt remains the reviewable policy baseline, including forbidden-category and gibberish/obfuscation guidance. The backend appends the JSON verdict contract outside that user-visible prompt.

## 5. Safety and Fail-Closed Behavior

Prompts are not forwarded directly to the responder. Eligible clean prompts must pass local sanitizer checks and the safeguard judge first. If the backend, safeguard judge, or responder cannot complete, the gateway fails closed and surfaces the error instead of silently bypassing controls.

Global System Pause halts automated forwarding, routes new Analyst Chat prompts into manual review, and stops active Bulk Ingest replay.

## 6. Transparency Requirements

For compliance review, maintain the following alongside this card:

- Provider model cards for the active safeguard judge and downstream responder.
- Current System Configuration hash and recommended baseline hash.
- Active environment variable inventory for backend-managed credentials.
- Audit retention policy for Firestore and any provider-side logs.
- Known limitations, including deterministic Sam Spade replies and local-review/demo behavior.
