# Counter-Spy.ai Dev CloudFormation

This folder contains the first AWS dev target for Counter-Spy.ai in `us-east-1`.

See [DEPLOYMENT_INPUTS.md](./DEPLOYMENT_INPUTS.md) for the values to collect once AWS credentials are available.

> [!IMPORTANT]
> **Phase 4 architecture mismatch — these templates predate the server-hosted rewrite.** As of branch `feat/server-hosted-app` the analyst console is **server-rendered by the gateway** (`services/gateway/`), not a static S3/CloudFront SPA. Sam Spade also runs as its own service (`services/sam-spade/`) on port `18120`. Before deploying:
>
> - **`03-frontend.yml`** currently provisions S3 + CloudFront for a static SPA. The analyst console no longer needs that; the only remaining static frontend is `ctf-frontend/`, which is still a Vite dev container in the demo stack and needs a production build before the static-bucket path applies to it.
> - **`scripts/deploy-frontend.sh`** runs `npm run build` (Vite client + SSR), then uploads `dist/` to the bucket from `03-frontend.yml`. With SSR the `dist/server/` half doesn't belong on S3, and the analyst console isn't served statically at all.
> - **`04-backend.yml`** currently provisions one ECS service. After Phase 3 step 4 the gateway also needs Postgres (audit logs, app_config, user_profiles, kb_policies, instruction-similarity corpus on the durable `counter_spy_postgres_data` named volume locally — RDS or Aurora Serverless v2 in AWS), plus admin-gate env wiring. Sam Spade should be a second ECS service mounted at `/v1/ctf/sam-spade/*` via the same ALB or a separate target group.
>
> Open architectural decisions before these templates can be the canonical deploy target:
> 1. Drop `03-frontend.yml` entirely (analyst console + CTF both behind ECS) **or** repurpose it for a CTF-only static bucket once `ctf-frontend/` has a production Vite build.
> 2. Decide the Postgres provider for AWS (RDS Postgres + pgvector extension, Aurora Serverless v2, or self-hosted on a sidecar volume).
> 3. Auth-model decision (status-quo bearer / Firebase ID-token verify / backend-issued JWT) — affects whether `02-auth.yml`'s Cognito User Pool is the canonical identity source.

## Stack Order

1. `01-network-dns.yml` creates the VPC, Route53 hosted zone, and ACM certificates.
2. `02-auth.yml` creates the Cognito User Pool, groups, and optional Google federation.
3. `06-security.yml` creates the CloudFront WAF ACL.
4. `03-frontend.yml` creates the private S3/CloudFront frontend. Pass the WAF ARN from stack 3 as `CloudFrontWebAclArn`.
5. `05-data.yml` creates DynamoDB hot tables and the S3 Object Lock archive bucket.
6. `04-backend.yml` creates ECR, ECS Fargate, internal ALB, API Gateway VPC Link, Cognito JWT authorizer, and regional API WAF.

The backend stack starts with `DesiredCount=0` so the infrastructure can be created before the first image is pushed to ECR.

## Manual Prerequisites

- AWS CLI credentials for the target dev account.
- Provider access for the OpenAI-compatible safeguard judge and the configured downstream responder, including final model IDs and secret sources.
- Squarespace NS delegation to the name servers output by `01-network-dns.yml`.
- Google OAuth client ID and secret when enabling Workspace federation.

## Current Runtime Alignment Notes

The local Docker/demo runtime exposes a substantially larger gateway surface than the first dev CloudFormation target. The full current route map is in [Technical/ARCHITECTURE.md §5.1.1](../../../Technical/ARCHITECTURE.md). Highlights `04-backend.yml` must cover before an end-to-end hosted demo:

- The full `/v1/intercept`, `/v1/analyze*`, `/v1/translate`, `/v1/audit-logs` (4 verbs), `/v1/metrics/aggregate`, `/v1/governance`, `/v1/system-config`, `/v1/users/*`, `/v1/policies` (4 verbs), `/v1/instruction-monitor/*`, and `/v1/ctf/review-artifacts` set served by the gateway.
- The `/v1/ctf/sam-spade/*` set served by the standalone Sam Spade service on its own port (default `18120`).
- The server-rendered analyst console served by the gateway itself (the SSR `/` catch-all).

Confirm the frontend auth token source matches the API authorizer. The local app uses Firebase Auth + a shared `INTERCEPT_BEARER_TOKEN`; the CloudFormation target was originally drafted around a Cognito JWT authorizer. The auth-model is still an open decision — see the Phase 4 callout above.

The gateway task must also receive **admin-gate + persistence config** in addition to the safeguard/responder provider configuration:

- `INTERCEPT_BEARER_TOKEN` — shared bearer (current model; replace with JWT verification when the auth-model decision lands).
- `APP_CONFIG_DATABASE_URL` (or `DATABASE_URL`, or fallback `INSTRUCTION_MONITOR_DATABASE_URL`) — Postgres connection string used by the audit, app_config (governance + system), user_profiles, kb_policies, and instruction-monitor stores. The gateway lazy-creates every table on first hit.
- `INSTRUCTION_MONITOR_*` set when the pgvector instruction monitor is enabled.
- `SAFEGUARDS_API_BASE_URL`, `SAFEGUARDS_API_KEY`, `SAFEGUARDS_MODEL_ID`, optional `SAFEGUARDS_TIMEOUT_MS`.
- `RESPONDER_PROVIDER`, `RESPONDER_API_BASE_URL`, `RESPONDER_API_KEY`, `RESPONDER_MODEL_ID`.
- `LARA_ACCESS_KEY_ID` + `LARA_ACCESS_KEY_SECRET` (optional `LARA_API_BASE_URL`) if `/v1/translate` is needed.
- `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_SERVICE_NAME` etc. for OpenTelemetry.

Without those values, clean prompts should fail closed rather than bypassing the safeguard/responder path.

**Admin-gate bootstrap**: a fresh database has no admin rows, so every operator is locked out of `PUT /v1/governance`, `PUT /v1/system-config`, `POST/PATCH/DELETE /v1/policies`, and `PUT /v1/users/:uid/role` until an admin row is inserted manually. The recipe (psql one-liner) lives in [Technical/LOCAL_DEVELOPMENT.md → First-time admin bootstrap](../../../Technical/LOCAL_DEVELOPMENT.md#first-time-admin-bootstrap). The AWS deploy story should pick one of: (a) run the same psql one-liner against RDS on first deploy from a one-shot ECS task, (b) seed an admin row in the CloudFormation `Outputs` post-deploy script, or (c) wire the auth-model decision so admin promotion happens through verified identity (e.g. first Cognito user in the `admins` group → `INSERT ... role='admin'` on demand). Don't ship without one of those.

## Local Checks

```bash
npm run lint                # frontend + backend-shared + gateway + sam-spade tsc
npm run gateway:test        # gateway test suite
npm run sam-spade:test      # sam-spade test suite
npm run build               # Vite client + SSR
npm run gateway:build       # gateway tsc
```
