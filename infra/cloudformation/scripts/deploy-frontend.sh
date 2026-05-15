#!/usr/bin/env bash
# STALE — Phase 4 architecture mismatch. The analyst console is server-rendered
# by the gateway now (services/gateway/), not a static SPA. `npm run build`
# emits dist/client/ + dist/server/; only the client half belongs on S3, and
# the analyst console isn't served from S3 at all. Don't run this against
# the current 03-frontend.yml stack until the open decision in
# infra/cloudformation/dev/README.md lands.
set -euo pipefail

STACK_NAME="${STACK_NAME:-counter-spy-frontend-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
BUILD_DIR="${BUILD_DIR:-dist/client}"

echo "WARN: deploy-frontend.sh is STALE post-Phase-4. See infra/cloudformation/dev/README.md." >&2

aws_args=(--region "$AWS_REGION")

npm run build

bucket="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  "${aws_args[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)"

distribution_id="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  "${aws_args[@]}" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendDistributionId'].OutputValue" \
  --output text)"

aws s3 sync "$BUILD_DIR/" "s3://$bucket/" "${aws_args[@]}" \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"

aws s3 cp "$BUILD_DIR/index.html" "s3://$bucket/index.html" "${aws_args[@]}" \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html"

aws cloudfront create-invalidation \
  --distribution-id "$distribution_id" \
  --paths "/*" \
  "${aws_args[@]}"
