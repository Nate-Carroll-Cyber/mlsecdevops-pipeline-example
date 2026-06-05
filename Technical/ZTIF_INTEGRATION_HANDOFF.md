# ZTIF Integration Handoff

## Goal

Integrate ZTIF-style per-surface intent contracts into Counter-Spy.ai without introducing a second routing vocabulary or another required LLM.

ZTIF should become a deterministic and semantic evidence layer inside Counter-Spy's existing governed routes. Counter-Spy remains the source of truth for final routing:

- `CLEAN`
- `SUSPICIOUS`
- `ADVERSARIAL`
- `QUEUED`
- `INTERCEPTED`
- `SHIELD_ERROR`

Do not import ZTIF's `PASS | FLAG | BLOCK | SKIP` directly into user-facing routing. Normalize ZTIF results into Counter-Spy route impacts and audit evidence.

## Design Summary

Counter-Spy already has the runtime machinery:

- deterministic sanitizer
- obfuscation detection
- PII/secret redaction
- backend `/v1/intercept`
- safeguard judge
- audit logs
- metrics
- HITL/manual review
- Sam Spade CTF route family

ZTIF adds the missing surface-specific declaration:

> For this exact input surface, what is the input allowed to mean?

Each governed request should optionally carry a trusted `surfaceId` in metadata, such as:

```ts
metadata: {
  source: 'ctf_chat',
  surfaceId: 'counterspy.sam_spade.player_question'
}
```

The backend resolves a server-owned ZTIF contract for that `surfaceId`. The client may send the `surfaceId`, but must not send contract contents.

## Routing Semantics

Use this internal vocabulary:

```ts
type ZtifSignal =
  | 'CONTRACT_MATCH'
  | 'CONTRACT_AMBIGUOUS'
  | 'CONTRACT_VIOLATION'
  | 'NOT_APPLIED';

type ZtifRouteImpact = 'none' | 'queue' | 'block';
```

Mapping:

| ZTIF signal | Counter-Spy impact | Counter-Spy route |
| --- | --- | --- |
| `CONTRACT_MATCH` | `none` | Continue normal pipeline |
| `CONTRACT_AMBIGUOUS` | `queue` | `SUSPICIOUS` / `QUEUED` |
| `CONTRACT_VIOLATION` | `block` | `ADVERSARIAL` / `INTERCEPTED` |
| `NOT_APPLIED` | `none` | Continue normal pipeline |

Important: `NOT_APPLIED` must never be treated as proof of safety.

## MVP Scope

Implement ZTIF Gate 1 deterministic regex checks first. Do not add a second LLM.

MVP surfaces:

1. `counterspy.analyst_chat.message`
2. `counterspy.sam_spade.player_question`
3. `counterspy.bulk_ingest.prompt`

MVP behavior:

- Resolve contract by `metadata.surfaceId`.
- Run ZTIF deterministic structural checks after request parsing and before safeguard forwarding.
- If ZTIF emits `CONTRACT_VIOLATION`, return existing Counter-Spy `403 INTERCEPTED` shape.
- If ZTIF emits `CONTRACT_AMBIGUOUS`, allow the existing safeguard path to continue, but carry ZTIF evidence into audit and safeguard context.
- If ZTIF emits `CONTRACT_MATCH` or `NOT_APPLIED`, continue normal routing.
- Add ZTIF evidence to audit records and metrics-ready fields.

## Files To Touch

### Shared Types

Create:

```text
packages/backend-shared/src/security/ztifContracts.ts
```

Export from:

```text
packages/backend-shared/src/index.ts
```

Define:

```ts
export type ZtifRiskTier = 'low' | 'medium' | 'high' | 'critical';

export type ZtifSignal =
  | 'CONTRACT_MATCH'
  | 'CONTRACT_AMBIGUOUS'
  | 'CONTRACT_VIOLATION'
  | 'NOT_APPLIED';

export type ZtifRouteImpact = 'none' | 'queue' | 'block';

export interface ZtifRegexRule {
  id: string;
  label: string;
  pattern: string;
  flags?: string;
  impact: ZtifRouteImpact;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  surfaces?: string[];
}

export interface ZtifIntentContract {
  contractId: string;
  surfaceId: string;
  version: string;
  riskTier: ZtifRiskTier;
  declaredPurpose: string;
  semanticBoundaries: string[];
  gate1?: {
    minLength?: number;
    maxLength?: number;
    allowUrls?: boolean;
    maxUrlsInInput?: number;
    blockedPatterns?: ZtifRegexRule[];
    flagPatterns?: ZtifRegexRule[];
  };
}

export interface ZtifEvaluationResult {
  applied: boolean;
  contractId?: string;
  surfaceId?: string;
  signal: ZtifSignal;
  routeImpact: ZtifRouteImpact;
  matchedRules: Array<{
    id: string;
    label: string;
    severity?: string;
    impact: ZtifRouteImpact;
  }>;
  reasons: string[];
}
```

### Contract Store

Create:

```text
services/gateway/src/config/ztifContractStore.ts
```

For MVP, hardcode contracts in TypeScript. Do not add DB persistence yet.

Add:

```ts
export function getZtifContract(surfaceId: string | undefined): ZtifIntentContract | null
```

Initial contracts should cover:

- Analyst Chat
- Sam Spade player question
- Bulk Ingest prompt

Use the ZTIF regex patterns listed below, but apply surface-sensitive rules carefully.

### Evaluator

Create:

```text
services/gateway/src/security/ztifEvaluator.ts
```

Implement:

```ts
export function evaluateZtifContract(args: {
  contract: ZtifIntentContract | null;
  prompt: string;
  source?: string;
}): ZtifEvaluationResult
```

Rules:

- If no contract, return `applied: false`, `signal: 'NOT_APPLIED'`, `routeImpact: 'none'`.
- Run length checks.
- Run URL allowance checks if configured.
- Run blocked regex rules.
- Run flag regex rules.
- Blocked match -> `CONTRACT_VIOLATION`, `routeImpact: 'block'`.
- Flag match -> `CONTRACT_AMBIGUOUS`, `routeImpact: 'queue'`.
- No match -> `CONTRACT_MATCH`, `routeImpact: 'none'`.

Use safe regex construction:

```ts
function compileRule(rule: ZtifRegexRule): RegExp {
  return new RegExp(rule.pattern, rule.flags ?? 'iu');
}
```

Avoid Python-style inline flags such as `(?i)` in stored TypeScript rules.

### Safeguard Prompt Context

Create:

```text
services/gateway/src/security/ztifPromptContext.ts
```

Implement:

```ts
export function buildZtifSafeguardContext(result: ZtifEvaluationResult, contract: ZtifIntentContract | null): string
```

Only return context when a contract was applied.

Context should include:

- contract ID
- surface ID
- risk tier
- declared purpose
- semantic boundaries
- deterministic matched rules, if any

It should instruct the existing safeguard judge to classify violations using Counter-Spy's existing runtime contract:

```json
{"verdict":"CLEAN|SUSPICIOUS|ADVERSARIAL","analystReasoning":"brief reason"}
```

Do not ask the safeguard judge to output ZTIF verdicts.

### Backend Metadata Schema

Update:

```text
services/gateway/src/server.ts
```

Find `InterceptMetadataSchema` and add:

```ts
surfaceId: z.string().min(1).max(160).optional()
```

Also update frontend type definitions in:

```text
src/lib/backendApi.ts
```

Add `surfaceId?: string` to the backend metadata type.

### Intercept Route Integration

Update:

```text
services/gateway/src/server.ts
```

Inside `POST /v1/intercept`, after request validation and before the safeguard call:

1. Resolve:

```ts
const surfaceId = input.metadata?.surfaceId;
const ztifContract = getZtifContract(surfaceId);
const ztifEvaluation = evaluateZtifContract({
  contract: ztifContract,
  prompt: input.prompt,
  source: getInstructionSource(input.metadata),
});
```

2. If `ztifEvaluation.routeImpact === 'block'`, return existing 403-style intercept response.

Use Counter-Spy naming:

```ts
res.status(403).json({
  status: 'INTERCEPTED',
  verdict: 'ADVERSARIAL',
  reason: ztifEvaluation.reasons[0] ?? 'ZTIF contract violation',
  detectionFlags: [
    'ZTIF_CONTRACT_VIOLATION',
    ...ztifEvaluation.matchedRules.map((rule) => rule.id),
  ],
  ztif: {
    contractId: ztifEvaluation.contractId,
    surfaceId: ztifEvaluation.surfaceId,
    signal: ztifEvaluation.signal,
    routeImpact: ztifEvaluation.routeImpact,
    matchedRules: ztifEvaluation.matchedRules,
    reasons: ztifEvaluation.reasons,
  },
});
return;
```

Adjust field names to match the actual `InterceptResponse` type. Do not invent a response shape that breaks the client.

3. If not blocked, append ZTIF context to the existing safeguard effective prompt:

```ts
const ztifContext = buildZtifSafeguardContext(ztifEvaluation, ztifContract);
const safeguardSystemPrompt = [existingSafeguardPrompt, ztifContext]
  .filter(Boolean)
  .join('\n\n');
```

Use this combined prompt where the route currently passes `input.metadata.safeguardEffectivePrompt` to the safeguard client.

### Audit Fields

Update audit creation/patch logic where `/v1/intercept` records backend telemetry.

Add optional fields:

```ts
ztifApplied?: boolean;
ztifContractId?: string | null;
ztifSurfaceId?: string | null;
ztifSignal?: ZtifSignal | null;
ztifRouteImpact?: ZtifRouteImpact | null;
ztifMatchedRules?: Array<{ id: string; label: string; severity?: string; impact: string }>;
ztifReasons?: string[];
```

Likely files:

```text
src/App.tsx
src/lib/backendApi.ts
services/gateway/src/audit/auditStore.ts
services/gateway/src/server.ts
```

Do not make these required fields. Existing audit logs must continue to load.

### Frontend Metadata

Update call sites that invoke `/v1/intercept`.

Known likely call sites:

```text
src/App.tsx
src/lib/backendApi.ts
```

Add surface IDs:

```ts
// Analyst Chat
surfaceId: 'counterspy.analyst_chat.message'

// Bulk Ingest
surfaceId: 'counterspy.bulk_ingest.prompt'
```

For Sam Spade, check the service split. The current docs say Sam Spade may route through `services/sam-spade` rather than gateway `/v1/intercept`. If Sam Spade has its own message route, mirror the same metadata/contract pattern there after the gateway MVP.

## Initial Regex Rules

Use these as TypeScript regex strings. Do not include Python inline `(?i)`.

Global-ish prompt injection rules:

```ts
[
  { id: 'ZTIF_IGNORE_PREVIOUS_INSTRUCTIONS', label: 'Ignore previous instructions', pattern: 'ignore\\s+(all\\s+)?previous\\s+instructions', flags: 'iu', impact: 'block', severity: 'CRITICAL' },
  { id: 'ZTIF_IGNORE_PREVIOUS', label: 'Ignore previous', pattern: 'ignore\\s+(all\\s+)?previous', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_YOU_ARE_NOW', label: 'Role reassignment', pattern: 'you\\s+are\\s+now\\s+(a|an)?', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_NEW_INSTRUCTION', label: 'New instruction injection', pattern: 'new\\s+instruction', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_SYSTEM_DIRECTIVE', label: 'System directive prefix', pattern: 'system\\s*:\\s*(override|instruction|directive)?', flags: 'iu', impact: 'block', severity: 'CRITICAL' },
  { id: 'ZTIF_ASSISTANT_PREFIX', label: 'Assistant role prefix', pattern: 'assistant\\s*:\\s*', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_CHATML_START', label: 'ChatML start token', pattern: '<\\|', flags: 'u', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_CHATML_END', label: 'ChatML end token', pattern: '\\|>', flags: 'u', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_JAILBREAK', label: 'Jailbreak keyword', pattern: 'jailbreak', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_DAN_MODE', label: 'DAN mode', pattern: 'DAN\\s+mode', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_DEVELOPER_MODE', label: 'Developer mode', pattern: 'developer\\s+mode', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_UNRESTRICTED_MODE', label: 'Unrestricted mode', pattern: 'unrestricted\\s+mode', flags: 'iu', impact: 'block', severity: 'HIGH' }
]
```

SQL/NoSQL/code rules:

```ts
[
  { id: 'ZTIF_SQL_SELECT_FROM', label: 'SQL SELECT FROM', pattern: 'SELECT.*FROM', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_SQL_DROP_TABLE', label: 'SQL DROP TABLE', pattern: 'DROP\\s+TABLE', flags: 'iu', impact: 'block', severity: 'CRITICAL' },
  { id: 'ZTIF_SQL_KEYWORDS', label: 'SQL keyword command', pattern: '(SELECT|DROP|INSERT|UPDATE|DELETE|UNION)\\s', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_SQL_COMMENT_PAYLOAD', label: 'SQL comment payload', pattern: "';\\s*--", flags: 'u', impact: 'block', severity: 'CRITICAL' },
  { id: 'ZTIF_MONGO_WHERE', label: 'Mongo $where operator', pattern: '\\$where', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_MONGO_NE', label: 'Mongo $ne operator', pattern: '\\$ne', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_EVAL_CALL', label: 'eval call', pattern: 'eval\\s*\\(', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_EXEC_EVAL_SYSTEM_CALL', label: 'exec/eval/system call', pattern: '(exec|eval|system)\\s*\\(', flags: 'iu', impact: 'queue', severity: 'HIGH' }
]
```

HTML/header rules:

```ts
[
  { id: 'ZTIF_SCRIPT_TAG', label: 'Script tag', pattern: '<script', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_JAVASCRIPT_URL', label: 'javascript URL', pattern: 'javascript:', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_ENCODED_CR', label: 'Encoded carriage return', pattern: '%0d', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_ENCODED_LF', label: 'Encoded line feed', pattern: '%0a', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_NULL_BYTE', label: 'Null byte', pattern: '\\x00', flags: 'u', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_BCC_HEADER', label: 'BCC header injection', pattern: 'bcc:', flags: 'iu', impact: 'block', severity: 'HIGH' },
  { id: 'ZTIF_CC_HEADER', label: 'CC header injection', pattern: 'cc:', flags: 'iu', impact: 'block', severity: 'HIGH' }
]
```

Surface-specific reserved identity rules. Do not apply globally:

```ts
[
  { id: 'ZTIF_RESERVED_ADMIN', label: 'Reserved admin identity', pattern: 'admin', flags: 'iu', impact: 'block', severity: 'MEDIUM', surfaces: ['counterspy.username', 'counterspy.profile_bio'] },
  { id: 'ZTIF_RESERVED_SUPPORT', label: 'Reserved support identity', pattern: 'support', flags: 'iu', impact: 'block', severity: 'MEDIUM', surfaces: ['counterspy.username', 'counterspy.profile_bio'] },
  { id: 'ZTIF_RESERVED_MODERATOR', label: 'Reserved moderator identity', pattern: 'moderator', flags: 'iu', impact: 'block', severity: 'MEDIUM', surfaces: ['counterspy.username', 'counterspy.profile_bio'] },
  { id: 'ZTIF_RESERVED_OFFICIAL', label: 'Reserved official identity', pattern: 'official', flags: 'iu', impact: 'block', severity: 'MEDIUM', surfaces: ['counterspy.username', 'counterspy.profile_bio'] }
]
```

## Suggested Contract Defaults

Analyst Chat:

```ts
{
  contractId: 'ZTIF-CS-ANALYST-CHAT-001',
  surfaceId: 'counterspy.analyst_chat.message',
  version: '1.0.0',
  riskTier: 'high',
  declaredPurpose: 'Analyst prompts submitted for governed security analysis or safe responder forwarding.',
  semanticBoundaries: [
    'No attempts to bypass Counter-Spy guardrails',
    'No attempts to reveal hidden system prompts or provider credentials',
    'No encoded or obfuscated instruction payloads intended to evade inspection'
  ],
  gate1: {
    minLength: 1,
    maxLength: 20000,
    allowUrls: true,
    blockedPatterns: PROMPT_INJECTION_RULES,
    flagPatterns: [EXEC_EVAL_SYSTEM_CALL_RULE]
  }
}
```

Sam Spade:

```ts
{
  contractId: 'ZTIF-CS-SAM-SPADE-001',
  surfaceId: 'counterspy.sam_spade.player_question',
  version: '1.0.0',
  riskTier: 'high',
  declaredPurpose: 'Player questions intended to investigate and solve the Sam Spade CTF scenario.',
  semanticBoundaries: [
    'No requests to reveal hidden scenario state',
    'No requests to print system prompts or private game rules',
    'No attempts to bypass scoring or moderation',
    'No real-world PII, payment data, credentials, or secrets'
  ],
  gate1: {
    minLength: 1,
    maxLength: 2000,
    allowUrls: false,
    blockedPatterns: PROMPT_INJECTION_RULES
  }
}
```

Bulk Ingest:

```ts
{
  contractId: 'ZTIF-CS-BULK-INGEST-001',
  surfaceId: 'counterspy.bulk_ingest.prompt',
  version: '1.0.0',
  riskTier: 'critical',
  declaredPurpose: 'Batch replay of labeled prompts for firewall evaluation, metrics, and research analysis.',
  semanticBoundaries: [
    'Adversarial examples are allowed as test material',
    'Bulk prompts must remain in governed analysis flow',
    'Bulk prompts must not bypass audit, review, or configured routing controls'
  ],
  gate1: {
    minLength: 1,
    maxLength: 50000,
    allowUrls: true,
    blockedPatterns: [],
    flagPatterns: PROMPT_INJECTION_RULES
  }
}
```

Bulk Ingest should usually queue/evaluate rather than hard-block, because adversarial content is expected there.

## Tests

Add unit tests under:

```text
services/gateway/test/
```

Suggested tests:

1. `ztifEvaluator.test.ts`
   - no surface ID returns `NOT_APPLIED`
   - clean prompt returns `CONTRACT_MATCH`
   - prompt injection returns `CONTRACT_VIOLATION`
   - flag rule returns `CONTRACT_AMBIGUOUS`
   - bulk ingest treats prompt injection as queue/flag, not hard block
   - invalid regex fixture should not crash evaluator if compile is guarded

2. `ztifIntercept.test.ts`
   - `/v1/intercept` with Sam Spade surface and `Ignore previous instructions` returns existing 403 `INTERCEPTED`
   - `/v1/intercept` clean Sam Spade prompt continues to safeguard path
   - response/audit includes `ZTIF_CONTRACT_VIOLATION` detection flag on block

3. Existing regression tests
   - `npm run gateway:test`
   - `npm run lint`

## Implementation Order

1. Add shared ZTIF types.
2. Add hardcoded contract store.
3. Add evaluator with regex matching.
4. Add unit tests for evaluator.
5. Add `surfaceId` to metadata schemas/types.
6. Wire `/v1/intercept` precheck.
7. Add ZTIF prompt context to existing safeguard prompt.
8. Add optional audit fields.
9. Add frontend `surfaceId` for Analyst Chat and Bulk Ingest.
10. Investigate Sam Spade route split and add equivalent surface metadata/evaluation there.
11. Run tests and lint.
12. Update `Technical/ARCHITECTURE.md` or `Technical/SESSION_HANDOFF.md` with final behavior.

## Non-Goals For First Pass

- Do not add another LLM.
- Do not port the ZTIF Python pipeline.
- Do not add database-backed contract editing yet.
- Do not expose contract authoring in the UI yet.
- Do not make ZTIF fields required in audit rows.
- Do not globally block words like `admin`, `support`, or `official`.
- Do not replace Counter-Spy's existing sanitizer or safeguard judge.

## Definition Of Done

- Counter-Spy can accept `metadata.surfaceId`.
- Backend resolves a server-owned ZTIF contract.
- Deterministic ZTIF regex rules can block or queue through Counter-Spy's existing route semantics.
- No ZTIF `PASS | FLAG | BLOCK | SKIP` values appear as final routing outcomes.
- Clean traffic still follows the existing safeguard/responder path.
- Blocked ZTIF traffic uses existing `INTERCEPTED`/`ADVERSARIAL` handling.
- Audit records include optional ZTIF evidence.
- Tests cover clean, block, queue, and no-contract cases.
