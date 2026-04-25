# Dev Deployment Inputs

Use this checklist once AWS credentials are available. The current target region is `us-east-1` and the environment is `dev`.

## Account And Region

| Input | Current Target | Notes |
| :--- | :--- | :--- |
| AWS account ID | TBD | Needed for CLI profile validation and ECR image verification. |
| AWS region | `us-east-1` | Keep ACM certificates for CloudFront and API Gateway here. |
| AWS CLI profile | TBD | Export as `AWS_PROFILE` before deployment. |
| Deployment principal | TBD | Should have CloudFormation, IAM, ECR, ECS, ELB, API Gateway, WAF, Cognito, Route53, S3, DynamoDB, CloudWatch Logs, and Bedrock permissions for dev. |

## DNS

| Input | Current Target | Notes |
| :--- | :--- | :--- |
| Registrar | Squarespace | Keep registrar there unless ownership changes. |
| Hosted zone domain | `cyber-spy.ai` | Created by `01-network-dns.yml`. |
| Frontend DNS | `app.cyber-spy.ai` | Points to CloudFront. |
| API DNS | `api.cyber-spy.ai` | Points to API Gateway custom domain. |
| Route53 name servers | Stack output | Add these NS records at Squarespace after `01-network-dns.yml` creates the hosted zone. |

## Auth

| Input | Current Target | Notes |
| :--- | :--- | :--- |
| Cognito User Pool | CloudFormation-managed | Created by `02-auth.yml`. |
| Google OAuth client ID | TBD | Optional at first, required for Google Workspace federation. |
| Google OAuth client secret | TBD | Pass via CloudFormation parameter; do not commit it. |
| Callback URL | `https://app.cyber-spy.ai` | Confirm exact Cognito hosted UI callback path before enabling federation. |
| User groups | `admin`, `analyst`, `machine` | Created by `02-auth.yml`. |

## Models

| Input | Current Target | Notes |
| :--- | :--- | :--- |
| Safeguards model | OpenAI-compatible safeguard judge | Confirm final provider, base URL, model ID, and secret source. |
| Responder model | OpenAI-compatible or Gemini downstream responder | Confirm final provider, base URL, model ID, and secret source. |
| Failure behavior | Fail secure | Backend must block on safeguards/model errors. |

## Backend API Surface

| Route | Current Local Runtime | Deployment Note |
| :--- | :--- | :--- |
| `GET /healthz` | Backend health check | Keep public or low-risk depending on environment policy. |
| `POST /v1/intercept` | Analyst Chat, Playground, Bulk Ingest safeguard gateway | Requires auth and model secret configuration. |
| `POST /v1/translate` | Manual Playground Lara translation | Add API Gateway route if hosted Playground translation is in scope. |
| `POST /v1/ctf/sam-spade/session` | Create CTF session | Add API Gateway route if hosted Sam Spade is in scope. |
| `GET /v1/ctf/sam-spade/session/:sessionId` | Resume CTF session | Add API Gateway route if hosted Sam Spade is in scope. |
| `POST /v1/ctf/sam-spade/message` | Governed CTF question turn | Add API Gateway route if hosted Sam Spade is in scope. |
| `POST /v1/ctf/sam-spade/solve` | Governed CTF solve attempt | Add API Gateway route if hosted Sam Spade is in scope. |

## Auth Alignment

The local UI can run with Firebase Auth or local-review mode. The dev CloudFormation API target uses Cognito JWT authorization for protected API routes. Before deployment, choose one hosted frontend identity flow and make sure the React app sends the matching `Authorization` header for protected backend calls.

## Backend Secrets

| Secret / Env | Required For | Notes |
| :--- | :--- | :--- |
| `SAFEGUARDS_API_BASE_URL` | Backend safeguard judge | Required for clean prompts to reach the judge. |
| `SAFEGUARDS_API_KEY` | Backend safeguard judge | Store in Secrets Manager or another approved secret source. |
| `SAFEGUARDS_MODEL_ID` | Backend safeguard judge | Defaults locally, but should be explicit in dev. |
| `RESPONDER_PROVIDER` | Downstream responder | `openai_compatible` or `gemini`. |
| `RESPONDER_API_BASE_URL` | Downstream responder | Provider API root. |
| `RESPONDER_API_KEY` | Downstream responder | Store in Secrets Manager or another approved secret source. |
| `RESPONDER_MODEL_ID` | Downstream responder | Confirm final model ID. |
| `LARA_ACCESS_KEY_ID` / `LARA_ACCESS_KEY_SECRET` | Playground translation | Needed only if hosted translation is enabled. |

## Stack Order

1. `01-network-dns.yml`
2. `02-auth.yml`
3. `06-security.yml`
4. `03-frontend.yml`
5. `05-data.yml`
6. `04-backend.yml`

The backend stack starts with `DesiredCount=0`, so it can create ECR and infrastructure before the first image is pushed.

## Pre-Deploy Local Checks

```bash
npm run lint
npm run test
npm run build
npm run backend:build
docker build -f backend/Dockerfile -t counter-spy-backend:dev .
```

## First Deployment Commands

These commands are intentionally left with explicit parameters. Fill in AWS profile and any non-default values when credentials are available.

```bash
export AWS_PROFILE=<dev-profile>
export AWS_REGION=us-east-1
```

```bash
aws sts get-caller-identity
```

Deploy the stacks in the stack order above with `aws cloudformation deploy`. After `04-backend.yml` creates the ECR repository, use `infra/cloudformation/scripts/deploy-backend.sh` to build and push the first image and set `DesiredCount=1`.
