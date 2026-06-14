variable "vault_addr" {
  description = "Vault server URL (e.g. https://vault.example.com, or the HCP Vault Dedicated cluster URL)"
  type        = string
  default     = "http://127.0.0.1:8200"
}

variable "vault_namespace" {
  description = "Vault namespace for the mount + JWT auth backend. HCP Vault Dedicated / Enterprise: \"admin\" or a child like \"admin/gaips\". Leave blank for OSS Vault (no namespaces)."
  type        = string
  default     = ""
}

variable "gitlab_jwks_url" {
  description = "GitLab instance JWKS endpoint (e.g. https://gitlab.com/-/jwks)"
  type        = string
}

variable "gitlab_issuer" {
  description = "JWT issuer — must match iss claim in GitLab CI JWTs (e.g. https://gitlab.com)"
  type        = string
}

variable "gitlab_namespace" {
  description = "GitLab namespace path (group or user) to scope the CI role bound_claims"
  type        = string
}

variable "gitlab_project_path" {
  description = "Full project path (namespace/project) for bound_claims"
  type        = string
}
