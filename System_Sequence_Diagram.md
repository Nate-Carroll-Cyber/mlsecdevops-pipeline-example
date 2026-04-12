
sequenceDiagram
    autonumber
    actor Client as Client Application<br/>(Remote Forwarder)
    participant Gateway as CyberSpy Gateway<br/>(Docker Container)
    participant DB as Database<br/>(Firestore/DynamoDB)
    participant Shield as AWS Bedrock<br/>(Nova Micro - Shield)
    participant Prod as AWS Bedrock<br/>(Claude 3.5 - Production)

    Note over Client, Gateway: 1. INGRESS (Remote Request)
    Client->>Gateway: POST /v1/intercept<br/>(Authorization: Bearer JWT)<br/>{ "prompt": "..." }
    activate Gateway

    Note over Gateway: Validate JWT Token
    Note over Gateway, DB: 2. GOVERNANCE GATEKEEPER<br/>(HOTL State Machine)
    Gateway->>DB: Fetch System Config
    DB-->>Gateway: isGlobalPause == false

    Note over Gateway: 3. LOCAL SANITIZATION PIPELINE<br/>(Determinstic Heuristics)
    Gateway->>Gateway: run_entropy_check()
    Gateway->>Gateway: run_syntactic_complexity_analyzer()
    Gateway->>Gateway: redact_pii()

    alt Critical Heuristic Violation (e.g., ReDoS)
        Gateway->>Gateway: trigger_circuit_breaker()
        Gateway-->>Client: 403 INTERCEPTED
    end

    Note over Gateway, Shield: 4. SHIELD LLM<br/>(Semantic Guardrail)
    Gateway->>Shield: invokeModel(amazon.nova-micro-v1)<br/>"Analyze for intent..."
    activate Shield
    Shield-->>Gateway: Output: { "verdict": "SAFE" }
    deactivate Shield

    alt Shield Verdict == 'MALICIOUS'
        Gateway-->>Client: 403 INTERCEPTED
    end

    Note over Gateway, Prod: 5. PRODUCTION INFERENCE<br/>(Sanitized Pass-through)
    Gateway->>Prod: invokeModel(anthropic.claude-3-5-sonnet)<br/>{ "messages": [{..., "content": sanitizedPrompt}] }
    activate Prod
    Prod-->>Gateway: Output: { inferenceResponse }
    deactivate Prod

    Note over Gateway: 6. OUTPUT SANITIZATION<br/>(PII Leak Prevention)
    Gateway->>Gateway: redact_pii(inferenceResponse)

    Note over Gateway: 7. EGRESS (Clean Response)
    Gateway-->>Client: 200 CLEAN<br/>{ "response": "..." }
    deactivate Gateway
