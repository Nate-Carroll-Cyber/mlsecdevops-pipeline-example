# Vault Fixture Secret Map

No real credentials are included in this fixture. Terraform in `terraform/` seeds
all paths with placeholder values. Replace before any production use.

## CI Secrets — `secret/data/gaips/ci/*`

Fetched once per pipeline run by the `vault-secrets` job and injected as CI
variables via a `reports: dotenv` artifact.

| Secret Path | CI Variable | Lab Value | Access |
| --- | --- | --- | --- |
| `secret/data/gaips/ci/model-endpoint` | `MODEL_ENDPOINT` | `http://localhost:8080/v1` | Read by CI role |
| `secret/data/gaips/ci/model-signing-identity` | `MODEL_SIGNING_IDENTITY` | `ci-signer@example.invalid` | Read by CI role |
| `secret/data/gaips/ci/sigstore-oidc-issuer` | `SIGSTORE_OIDC_ISSUER` | `https://oauth2.sigstore.dev/auth` | Read by CI role |
| `secret/data/gaips/ci/hf-token` | `HF_TOKEN` | `fixture-hf-token-not-real` | Read by CI role |
| `secret/data/gaips/ci/gemini-api-key` | `GEMINI_API_KEY` | `fixture-gemini-key-not-real` | Read by CI role |
| `secret/data/gaips/ci/registry-token` | `CI_REGISTRY_TOKEN` | `fixture-registry-token-not-real` | Read by CI role |
| `secret/data/gaips/ci/dt-api-url` | `DT_API_URL` | `https://dtrack.example.invalid` | Read by CI role |
| `secret/data/gaips/ci/dt-api-key` | `DT_API_KEY` | `fixture-dt-key-not-real` | Read by CI role |

## Model Provider Tokens — `secret/data/gaips/model-providers/*`

| Secret Path | Purpose | Lab Value | Access |
| --- | --- | --- | --- |
| `secret/data/gaips/model-providers/fixture` | Fake model provider token | `fixture-token-not-real` | Read by app service account |

## Tamper Baseline — `secret/data/gaips/tamper-baseline/*`

Written by the `tamper-verification` CI job on first run. No seed value — CI owns
this path. Keyed by `CI_PROJECT_PATH_SLUG` so each project has its own baseline.

| Secret Path | Purpose | Access |
| --- | --- | --- |
| `secret/data/gaips/tamper-baseline/{project-slug}` | Model digest baseline | Read + write by CI role |

Storing the baseline in Vault (rather than as a GitLab artifact) removes the
90-day expiry window that could silently reset tamper detection.

## Future Auth0 Paths — `secret/data/gaips/auth0/*`

Not yet provisioned. Policy grants read access; paths will be added when Auth0
integration is implemented.

## Admin — `secret/data/gaips/admin/*`

| Secret Path | Purpose | Lab Value | Access |
| --- | --- | --- | --- |
| `secret/data/gaips/admin/break-glass` | Administrative placeholder | Not provided | Denied to CI role |
