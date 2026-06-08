# JWT auth backend — GitLab CI OIDC integration
#
# Terraform in terraform/ automates every step below.
# These are the equivalent manual Vault CLI commands for reference.
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
