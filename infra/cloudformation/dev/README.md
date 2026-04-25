# Counter-Spy.ai Dev CloudFormation

This folder contains the first AWS dev target for Counter-Spy.ai in `us-east-1`.

See [DEPLOYMENT_INPUTS.md](./DEPLOYMENT_INPUTS.md) for the values to collect once AWS credentials are available.

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

The local Docker/demo runtime currently exposes more backend application routes than the first dev CloudFormation target:

- `/v1/intercept`
- `/v1/translate`
- `/v1/ctf/sam-spade/session`
- `/v1/ctf/sam-spade/session/:sessionId`
- `/v1/ctf/sam-spade/message`
- `/v1/ctf/sam-spade/solve`

Before promoting the dev API Gateway stack for an end-to-end hosted demo, update `04-backend.yml` so every intended backend route is reachable through API Gateway and confirm the frontend auth token source matches the API authorizer. The local app can run in Firebase/local-review mode, while the CloudFormation target uses a Cognito JWT authorizer for protected routes.

The backend task must also receive safeguard and responder provider configuration through environment variables or secrets:

- `SAFEGUARDS_API_BASE_URL`
- `SAFEGUARDS_API_KEY`
- `SAFEGUARDS_MODEL_ID`
- `RESPONDER_PROVIDER`
- `RESPONDER_API_BASE_URL`
- `RESPONDER_API_KEY`
- `RESPONDER_MODEL_ID`

Without those values, clean prompts should fail closed rather than bypassing the safeguard/responder path.

## Local Checks

```bash
npm run lint
npm run test
npm run backend:build
```
