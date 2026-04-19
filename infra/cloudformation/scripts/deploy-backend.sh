#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-counter-spy-backend-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
TEMPLATE_PATH="${TEMPLATE_PATH:-infra/cloudformation/dev/04-backend.yml}"
IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"
DESIRED_COUNT="${DESIRED_COUNT:-1}"

aws_args=(--region "$AWS_REGION")

repository_uri="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  "${aws_args[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='BackendRepositoryUri'].OutputValue" \
  --output text)"

registry="${repository_uri%%/*}"

aws ecr get-login-password "${aws_args[@]}" \
  | docker login --username AWS --password-stdin "$registry"

image_uri="${repository_uri}:${IMAGE_TAG}"
docker build -f backend/Dockerfile -t "$image_uri" .
docker push "$image_uri"

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE_PATH" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    ContainerImageTag="$IMAGE_TAG" \
    DesiredCount="$DESIRED_COUNT" \
  "${aws_args[@]}"
