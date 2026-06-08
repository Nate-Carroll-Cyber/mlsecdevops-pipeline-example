terraform {
  required_providers {
    vault = {
      source  = "hashicorp/vault"
      version = "~> 4.0"
    }
  }
  required_version = ">= 1.6"
}

provider "vault" {
  address = var.vault_addr
  # Credentials via VAULT_TOKEN environment variable (never hardcode)
}

# ── KV v2 secret engine ──────────────────────────────────────────────────────

resource "vault_mount" "kv" {
  path        = "secret"
  type        = "kv"
  options     = { version = "2" }
  description = "GAIPS KV v2 secret store"
}

# ── JWT auth backend ─────────────────────────────────────────────────────────

resource "vault_jwt_auth_backend" "gitlab" {
  path         = "jwt"
  type         = "jwt"
  jwks_url     = var.gitlab_jwks_url
  bound_issuer = var.gitlab_issuer
  description  = "GitLab CI OIDC — issues 15-min scoped tokens per job"
}

resource "vault_jwt_auth_backend_role" "gaips_ci" {
  backend   = vault_jwt_auth_backend.gitlab.path
  role_name = "gaips-ci"
  role_type = "jwt"

  token_policies = [vault_policy.gaips_ci.name]
  token_ttl      = 900  # 15 minutes — token expires when the CI job ends
  token_max_ttl  = 900

  # Restrict issuance to the specific GitLab namespace + project
  bound_claims = {
    namespace_path = var.gitlab_namespace
    project_path   = var.gitlab_project_path
  }

  # CI_SERVER_URL is used as the audience in id_tokens blocks in .gitlab-ci.yml
  bound_audiences = [var.gitlab_issuer]

  user_claim = "sub"
}

# ── Policy ───────────────────────────────────────────────────────────────────

resource "vault_policy" "gaips_ci" {
  name   = "gaips-ci"
  policy = file("${path.module}/../gaips-policy.hcl")
}

# ── CI secret stubs ──────────────────────────────────────────────────────────
# Fixture values only — replace with real secrets before production use.
# Managed here so `terraform plan` surfaces any drift from expected paths.

locals {
  ci_secrets = {
    "model-endpoint"       = "http://localhost:8080/v1"
    "model-signing-identity" = "ci-signer@example.invalid"
    "sigstore-oidc-issuer" = "https://oauth2.sigstore.dev/auth"
    "hf-token"             = "fixture-hf-token-not-real"
    "gemini-api-key"       = "fixture-gemini-key-not-real"
    "registry-token"       = "fixture-registry-token-not-real"
  }
}

resource "vault_kv_secret_v2" "ci" {
  for_each = local.ci_secrets

  mount     = vault_mount.kv.path
  name      = "gaips/ci/${each.key}"
  data_json = jsonencode({ value = each.value })

  lifecycle {
    # Prevent Terraform from overwriting real secrets on subsequent applies
    ignore_changes = [data_json]
  }
}

# ── Model provider token (existing fixture path) ─────────────────────────────

resource "vault_kv_secret_v2" "model_provider_fixture" {
  mount     = vault_mount.kv.path
  name      = "gaips/model-providers/fixture"
  data_json = jsonencode({ value = "fixture-token-not-real" })

  lifecycle {
    ignore_changes = [data_json]
  }
}

# ── Tamper baseline ───────────────────────────────────────────────────────────
# Written by the tamper-verification CI job on first run; not seeded here.
# Path pattern: secret/data/gaips/tamper-baseline/{CI_PROJECT_PATH_SLUG}
# Policy grants the CI role create + update on secret/data/gaips/tamper-baseline/*
