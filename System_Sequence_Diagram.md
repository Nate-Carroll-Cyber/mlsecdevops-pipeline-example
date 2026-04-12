sequenceDiagram
    participant C as Remote Client
    participant G as CyberSpy Gateway
    participant DB as Firestore DB
    participant S as Bedrock Shield
    participant P as Bedrock Production

    Note over C, G: 1. Ingress
    C->>G: POST /v1/intercept

    Note over G, DB: 2. Governance
    G->>DB: Check Global Pause
    DB-->>G: isGlobalPause = false

    Note over G: 3. Local Sanitization
    G->>G: Entropy & Complexity Checks

    Note over G, S: 4. Shield Check
    G->>S: Invoke Nova Micro
    S-->>G: "SAFE"

    Note over G, P: 5. Final Inference
    G->>P: Invoke Claude 3.5
    P-->>G: Inference Result

    Note over G: 6. Output Scrubbing
    G->>G: Redact PII in Response

    Note over G, C: 7. Egress
    G-->>C: 200 CLEAN Response
