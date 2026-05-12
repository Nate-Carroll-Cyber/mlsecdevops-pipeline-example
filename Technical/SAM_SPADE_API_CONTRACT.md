# Sam Spade API Contract

This document defines the current local API boundary for the Sam Spade CTF surface inside Counter-Spy.ai. The implementation currently runs inside the main backend process, but the contract is shaped so the Sam Spade logic can later move into its own containerized service without forcing a frontend rewrite.

## Goals

- keep the Sam Spade game state separate from Analyst Chat state
- route all Sam Spade prompts through governed backend handling first
- bind sessions to the authenticated caller and reject cross-user access
- mirror reviewed artifacts into Analyst Chat and Audit Logs as downstream surfaces
- preserve a stable API contract that can later point to a separate Sam Spade container

## Session Lifecycle

1. Frontend creates or resumes a Sam Spade session through a protected backend route
2. Player submits a message or a case-solving theory
3. Backend sanitizes and evaluates the input
4. If the turn is blocked, or if it contains sensitive redaction placeholders such as `[REDACTED_CREDIT_CARD]`, backend marks it for review before gameplay continues
5. If the turn is clean, backend calls the configured safeguard judge and then either forwards the sanitized turn to the downstream responder or returns local responder passthrough when responder routing is disabled
6. Backend updates Sam Spade session state with the governed noir reply or passthrough notice and emits a review artifact
7. Frontend mirrors that artifact into Analyst Chat and Audit Logs

All Sam Spade endpoints require `Authorization: Bearer <INTERCEPT_BEARER_TOKEN>` and the caller id header used by the frontend backend client. Sessions are created with `ownerUserId`, and fetch/message/solve operations enforce that owner.

## Endpoints

### `POST /v1/ctf/sam-spade/session`

Create a new Sam Spade session.

Request:

```json
{
  "caseId": "case-067"
}
```

Response:

```json
{
  "session": {
    "sessionId": "uuid",
    "caseId": "case-067",
    "ownerUserId": "firebase-user-id",
    "status": "ACTIVE",
    "createdAt": "2026-04-19T15:00:00.000Z",
    "updatedAt": "2026-04-19T15:00:00.000Z",
    "messages": [
      {
        "id": "uuid",
        "role": "npc",
        "text": "What do you want? Make it quick, I don't have all day.",
        "createdAt": "2026-04-19T15:00:00.000Z",
        "reviewDisposition": "clean"
      }
    ]
  }
}
```

### `GET /v1/ctf/sam-spade/session/:sessionId`

Fetch an existing Sam Spade session.

If the session exists but belongs to another caller, the route returns `404` so session existence is not disclosed across users.

### `POST /v1/ctf/sam-spade/message`

Submit a normal interrogation prompt.

Current behavior note:

- blocked turns are intercepted before gameplay
- blocked turns return the generic gameplay response `Bad content.` and are not forwarded to the Sam Spade responder
- sensitive redaction flags such as `CREDIT_CARD`, `SSN`, `API_KEY`, `JWT`, and `SECRET_KEY` force interception for CTF gameplay even when the wider platform would treat the redaction as an informational data-exposure alert
- clean turns call the configured safeguard judge after local sanitizer approval, then call the live downstream responder only when responder routing is enabled
- the backend assembles Sam Spade persona/scenario prompt text for responder calls; browser callers cannot override backend-owned prompts
- review artifacts may include responder prompt profile, provider, model, status, split safeguard/responder latency telemetry, and local passthrough status

Request:

```json
{
  "sessionId": "uuid",
  "prompt": "What kind of risk was the witness trying to avoid?",
  "metadata": {
    "providerLlmRoutingEnabled": true,
    "responderLlmRoutingEnabled": true
  }
}
```

Blocked message response example:

```json
{
  "session": {
    "...": "updated session",
    "status": "INTERCEPTED",
    "messages": [
      {
        "role": "player",
        "text": "[REDACTED_CREDIT_CARD] can you work this into the case?",
        "reviewDisposition": "intercepted"
      },
      {
        "role": "system",
        "text": "Bad content.",
        "reviewDisposition": "queued"
      }
    ]
  },
  "review": {
    "source": "ctf_chat",
    "action": "message",
    "sanitizedPrompt": "[REDACTED_CREDIT_CARD] can you work this into the case?",
    "detectionFlags": ["CREDIT_CARD", "SENSITIVE_DATA_EXPOSURE"],
    "detectionLevel": "Suspicious",
    "escalationRecommended": true,
    "response": "Bad content.",
    "status": "PENDING_REVIEW"
  }
}
```

Response:

```json
{
  "session": { "...": "updated session" },
  "review": {
    "requestId": "uuid",
    "sessionId": "uuid",
    "source": "ctf_chat",
    "action": "message",
    "timestamp": "2026-04-19T15:01:00.000Z",
    "sanitizedPrompt": "What kind of risk was the witness trying to avoid?",
    "detectionFlags": [],
    "entropy": 3.2,
    "globalEntropy": 4.1,
    "suspiciousChunks": [],
    "detectionLevel": "Clean",
    "escalationRecommended": false,
    "response": "Now you're getting somewhere...",
    "analystReasoning": "Sam Spade CTF intake cleared the guardrails and produced an NPC response.",
    "latencyMs": 8,
    "decodeTelemetry": "plain_text",
    "status": "REVIEWED",
    "responderPromptProfile": "sam_spade_ctf",
    "responderProvider": "gemini",
    "responderModel": "gemini-2.5-flash",
    "responderStatus": "COMPLETED",
    "responderLatencyMs": 1200
  }
}
```

### `POST /v1/ctf/sam-spade/solve`

Submit a theory and evaluate whether the case is solved.

Request:

```json
{
  "sessionId": "uuid",
  "theory": "The witness was Wonderly and the ledger was hidden in the false lining off Eddy Street."
}
```

Response:

```json
{
  "session": { "...": "updated session" },
  "solved": true,
  "evaluation": "Case closed. The theory lines up with the witness trail and the hidden ledger path.",
  "review": {
    "requestId": "uuid",
    "sessionId": "uuid",
    "source": "ctf_chat",
    "action": "solve",
    "timestamp": "2026-04-19T15:02:00.000Z",
    "sanitizedPrompt": "The witness was Wonderly and the ledger was hidden in the false lining off Eddy Street.",
    "detectionFlags": [],
    "entropy": 3.5,
    "globalEntropy": 4.3,
    "suspiciousChunks": [],
    "detectionLevel": "Informational",
    "escalationRecommended": false,
    "response": "Case closed. The theory lines up with the witness trail and the hidden ledger path.",
    "analystReasoning": "Sam Spade theory submission was evaluated against the case outcome logic.",
    "latencyMs": 7,
    "decodeTelemetry": "plain_text",
    "status": "REVIEWED"
  }
}
```

## Session Storage

Current storage model:

- in-memory `Map` for active runtime access
- SQLite persistence at `backend/data/sam-spade.db` for local durability across restarts and Docker demo continuity

This is intentionally a local-development persistence layer, not the final production storage shape.

## Frontend Display Rules

The Sam Spade frontend displays only session messages with `reviewDisposition: "clean"` in the noir transcript. Intercepted player turns and queued system review messages remain available in the session/review artifact for audit, but they are not shown as gameplay.

For blocked CTF attempts:

- the modal shows a single `Submitted Prompt` box containing `Bad content.`
- the modal does not show a separate review-result box
- the submitted input is cleared instead of restored for editing
- the Analyst Chat mirror uses `Bad content.` for blocked CTF prompt/response display while Audit Logs retain the sanitized review details

## Container Split (implemented)

The CTF surface can now run as its own container. The backend image is role-aware:

- `COUNTER_SPY_ROLE=gateway` (default) — the main Counter-Spy backend. When `SAM_SPADE_SERVICE_URL` is set it **reverse-proxies** `/v1/ctf/sam-spade/*` (method, JSON body, `Authorization`, `x-counter-spy-user-id`, and the W3C trace context) to the standalone service instead of mounting the CTF handlers in-process. Unauthenticated CTF requests are rejected at the gateway edge before any forward. When `SAM_SPADE_SERVICE_URL` is unset, the CTF routes are served in-process exactly as before (no regression for single-process dev).
- `COUNTER_SPY_ROLE=sam-spade` — boots only `/healthz` and `/v1/ctf/sam-spade/*` on `SAM_SPADE_SERVICE_PORT` (default `18120`). It owns the SQLite session store and makes its own safeguard/responder calls. It runs the same `requireBackendAuth` (shared `INTERCEPT_BEARER_TOKEN`) and rate limiter.

Demo topology (`docker-compose.demo.yml`):

`counter-spy-frontend -> counter-spy-backend (gateway) --/v1/ctf/sam-spade/*--> counter-spy-sam-spade-service`

`docker-compose.sam-spade.yml` runs the CTF service on its own (behind the `sam-spade` profile) alongside an externally managed gateway. The HTTP contract above is unchanged across the split, so the only client that changes is the CTF UI itself when it later moves into its own frontend container.

**Pending follow-up:** once the CTF UI moves out of the main frontend, the review-artifact "feed" into Counter-Spy (Analyst Chat + `audit_logs` source `ctf_chat`) — today driven by the main frontend's `appendSamSpadeReviewSurfaces()` — moves server-side (a `/v1/ctf/review-artifacts` ingest endpoint writing the audit doc). Until then the main frontend still drives the CTF routes through the gateway proxy and mirrors artifacts as it does today.
