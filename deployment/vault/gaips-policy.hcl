# CI job credentials — read-only, fetched once per job by vault-secrets
path "secret/data/gaips/ci/*" {
  capabilities = ["read"]
}

# Model provider tokens
path "secret/data/gaips/model-providers/*" {
  capabilities = ["read"]
}

# Tamper baseline — CI writes on first run, reads on subsequent runs
# Replaces the 90-day GitLab artifact expiry with durable Vault storage
path "secret/data/gaips/tamper-baseline/*" {
  capabilities = ["read", "create", "update"]
}

# Future Auth0 credentials — read-only, path reserved
path "secret/data/gaips/auth0/*" {
  capabilities = ["read"]
}

# Admin break-glass — always denied to CI role
path "secret/data/gaips/admin/*" {
  capabilities = []
}
