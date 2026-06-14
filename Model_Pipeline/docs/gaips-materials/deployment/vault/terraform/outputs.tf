output "jwt_auth_path" {
  description = "Mount path for the JWT auth backend"
  value       = vault_jwt_auth_backend.gitlab.path
}

output "ci_role_name" {
  description = "Vault role name used in hvac jwt_login calls"
  value       = vault_jwt_auth_backend_role.gaips_ci.role_name
}

output "policy_name" {
  description = "Vault policy applied to CI job tokens"
  value       = vault_policy.gaips_ci.name
}

output "kv_mount" {
  description = "KV v2 mount path for all GAIPS secrets"
  value       = vault_mount.kv.path
}

output "ci_secret_paths" {
  description = "KV paths for the six CI secrets"
  value       = [for k, _ in local.ci_secrets : "secret/data/gaips/ci/${k}"]
}
