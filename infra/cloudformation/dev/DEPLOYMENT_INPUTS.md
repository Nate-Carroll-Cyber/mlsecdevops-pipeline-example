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
