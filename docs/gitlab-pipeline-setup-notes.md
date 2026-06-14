# GitLab Pipeline Setup Notes

These notes describe how to publish and run the standalone model security pipeline in GitLab.
They intentionally avoid references to any application repository; this project should contain
only the pipeline definition, CI helper scripts, fixtures, and pipeline-specific docs.

## Repository Layout

The pipeline expects this layout at the repository root:

```text
.gitlab-ci.yml
docs/gaips-materials/ci/
docs/gaips-materials/deployment/
docs/gaips-materials/evals/
docs/gaips-materials/fixtures/
docs/gaips-materials/guardrails/
docs/gaips-materials/hugging-face-hub/
docs/gaips-materials/model-signing/
docs/gaips-materials/scripts/
```

The CI variable `GAIPS_MATERIALS_DIR` defaults to:

```text
${CI_PROJECT_DIR}/docs/gaips-materials
```

Keep that variable aligned with the repository layout if files are moved later.

## Initial GitLab Setup

1. Create or choose a GitLab project for the standalone model pipeline.
2. Add this repository as the GitLab remote.
3. Push the pipeline contents to the default branch.
4. Configure the required and optional CI/CD variables documented in:

```text
docs/gaips-materials/ci/CI-VARIABLES.md
```

5. Run a pipeline from the default branch and review the setup, SAST, SBOM,
   vulnerability scan, model-integrity, evaluation, evidence, AI BOM, and deploy-prep stages.

## Required Project Variables

The pipeline can run in fixture mode with many integrations unset, but production-style model
signing and verification should configure these project variables:

```text
MODEL_SIGNING_IDENTITY
SIGSTORE_OIDC_ISSUER
```

Additional optional variables for model, dataset, registry, Vault, Dependency-Track, and image
signing workflows are documented in `docs/gaips-materials/ci/CI-VARIABLES.md` and in the
comments at the top of `.gitlab-ci.yml`.

## Operational Notes

- A push to the default branch starts the pipeline.
- Use commit message marker `[sigstore-discovery]` only when running the discovery-only workflow.
- Keep secrets in GitLab CI/CD variables or an approved secret manager; do not commit tokens.
- The pipeline publishes reports and evidence as GitLab job artifacts.
- Review `docs/gaips-materials/ci/SBOM.md` for the intended SBOM and vulnerability scanning flow.
