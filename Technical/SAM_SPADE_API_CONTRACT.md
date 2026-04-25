# Sam Spade API Contract

This document defines the current local API boundary for the Sam Spade CTF surface inside Counter-Spy.ai. The implementation currently runs inside the main backend process, but the contract is shaped so the Sam Spade logic can later move into its own containerized service without forcing a frontend rewrite.

## Goals

- keep the Sam Spade game state separate from Analyst Chat state
- route all Sam Spade prompts through governed backend handling first
- mirror reviewed artifacts into Analyst Chat and Audit Logs as downstream surfaces
- preserve a stable API contract that can later point to a separate Sam Spade container

## Session Lifecycle

1. Frontend creates or resumes a Sam Spade session
2. Player submits a message or a case-solving theory
3. Backend sanitizes and evaluates the input
4. If the turn is blocked, or if it contains sensitive redaction placeholders such as `[REDACTED_CREDIT_CARD]`, backend marks it for review before gameplay continues
5. If the turn is clean, backend calls the safeguard judge and then forwards the sanitized turn to the configured downstream responder
6. Backend updates Sam Spade session state with the responder-backed noir reply and emits a review artifact
7. Frontend mirrors that artifact into Analyst Chat and Audit Logs

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

### `POST /v1/ctf/sam-spade/message`

Submit a normal interrogation prompt.

Current behavior note:

- blocked turns are intercepted before gameplay
- blocked turns return the generic gameplay response `Bad content.` and are not forwarded to the Sam Spade responder
- sensitive redaction flags such as `CREDIT_CARD`, `SSN`, `API_KEY`, `JWT`, and `SECRET_KEY` force interception for CTF gameplay even when the wider platform would treat the redaction as an informational data-exposure alert
- clean turns call the live downstream responder after local sanitizer and safeguard judge approval
- the responder receives the active Downstream Responder Prompt plus Sam Spade persona/scenario prompts from System Configuration
- review artifacts may include responder prompt profile, provider, model, status, and latency telemetry

Request:

```json
{
  "sessionId": "uuid",
  "prompt": "What kind of risk was the witness trying to avoid?"
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

## Future Container Split

The contract is intentionally stable enough to support:

`Sam Spade frontend shell -> Counter-Spy.ai backend proxy -> Sam Spade service container`

Possible later split:

- `counter-spy-frontend`
- `counter-spy-backend`
- `sam-spade-service`

In that model, Counter-Spy.ai can remain the policy/governance/review surface while Sam Spade owns scenario logic and session progression.
