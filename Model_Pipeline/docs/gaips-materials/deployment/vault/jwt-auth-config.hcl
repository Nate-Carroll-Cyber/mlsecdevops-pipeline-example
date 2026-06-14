# JWT auth backend — GitLab CI OIDC integration
#
# Terraform in terraform/ automates every step below.
# These are the equivalent manual Vault CLI commands for reference.
#
# ── 0. HCP Vault Dedicated / Vault Enterprise: select a namespace ────────────
#
# HCP Vault runs every mount/auth backend under a root namespace ("admin", or a
# child you create like "admin/gaips"). Set it once for the CLI commands below
# (Terraform reads var.vault_namespace; the CI jobs read VAULT_NAMESPACE):
#
#   export VAULT_ADDR="https://<cluster>.vault.<region>.hashicorp.cloud:8200"
#   export VAULT_NAMESPACE="admin"        # or "admin/gaips"
#
# To use a child namespace, create it first (from the parent), then point the
# provider / VAULT_NAMESPACE at the child:
#
#   VAULT_NAMESPACE="admin" vault namespace create gaips   # → "admin/gaips"
#
# Self-managed OSS Vault has no namespaces — leave VAULT_NAMESPACE unset.
# NOTE: HCP Vault must be able to reach the GitLab JWKS endpoint (step 2) to
# validate CI tokens, and your runners must be able to reach VAULT_ADDR (enable
# the public endpoint for GitLab.com SaaS runners, or peer via HVN privately).
#
# ── 1. Enable the JWT auth backend ──────────────────────────────────────────
#
#   vault auth enable -path=jwt jwt
#
# ── 2. Configure JWKS (replace <GITLAB_URL>) ────────────────────────────────
#
#   vault write auth/jwt/config \
#     jwks_url="https://<GITLAB_URL>/-/jwks" \
#     bound_issuer="https://<GITLAB_URL>"
#
# ── 3. Create the CI role ────────────────────────────────────────────────────
#
# token_ttl=900 (15 min) — token expires at job end; no stored credentials.
# bound_claims restrict issuance to a specific GitLab namespace + project.
#
#   vault write auth/jwt/role/gaips-ci \
#     role_type=jwt \
#     policies=gaips-ci \
#     token_ttl=900 \
#     token_max_ttl=900 \
#     user_claim=sub \
#     bound_claims='{"namespace_path":"<NAMESPACE>","project_path":"<NAMESPACE/PROJECT>"}'
#
# ── GitLab CI job side ───────────────────────────────────────────────────────
#
# In each CI job that authenticates to Vault, declare an id_token:
#
#   id_tokens:
#     VAULT_ID_TOKEN:
#       aud: "${CI_SERVER_URL}"
#
# This requires GitLab 15.7+. For older instances, CI_JOB_JWT_V2 is the
# fallback (deprecated as of GitLab 16.x).
#
# The python hvac call:
#   client.auth.jwt.jwt_login(role="gaips-ci", jwt=os.environ["VAULT_ID_TOKEN"])
#
# ── Token scope ──────────────────────────────────────────────────────────────
#
# Each job receives a distinct, short-lived Vault token valid only for the
# paths listed in gaips-policy.hcl. Tokens are never written to artifacts.
