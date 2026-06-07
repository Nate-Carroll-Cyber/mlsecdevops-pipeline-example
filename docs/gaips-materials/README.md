# GAIPS Materials

This directory contains the concrete starter artifacts and fixtures used by the GAIPS course docs. It is intentionally self-contained so a class can run without production accounts, private credentials, gated models, or undefined instructor assets.

## Directory Map

| Directory | Purpose |
| --- | --- |
| `starter-rag-app/` | Minimal capstone RAG app used when no class app exists. |
| `model-gateway/` | Reference provider wrapper and model-call evidence logging contract. |
| `data/` | Approved documents plus a benign malicious test document. |
| `evals/` | Promptfoo, garak, Giskard, Inspect AI, and PyRIT lab instructions/config. |
| `fixtures/` | Static red-team and eval outputs for fixture-mode labs. |
| `guardrails/` | Prompt Guard, Llama Guard 3, Model Armor, and regression fixtures. |
| `mcp/` | Lab-safe Cline MCP configuration. |
| `agent/` | Lab-safe agent fixture for tool permission and HackAgent review. |
| `buttercup/` | Automated vulnerability finding and patch-review fixture. |
| `ci/` | GitLab CI sample that runs available checks or copies fixture outputs. |
| `hugging-face-hub/` | Hub scanner and repository-settings review fixture. |
| `deployment/` | Kubernetes and Vault review fixtures. |
| `model-signing/` | Signed, unsigned, and tampered artifact review fixture. |
| `sagemaker/` | Sanitized Hugging Face Estimator notebook and training-script fixture. |
| `bedrock-knowledge-bases/` | Bedrock Knowledge Bases design-review fixture. |
| `model-customization/` | Completed Lab 12 customization matrix. |

## Student Copy Pattern

For a standalone lab repository, copy the needed subdirectories into the lab root:

```bash
mkdir -p gaips-labs
cp -R docs/gaips-materials/starter-rag-app gaips-labs/app
cp -R docs/gaips-materials/data gaips-labs/data
cp -R docs/gaips-materials/evals gaips-labs/evals
cp -R docs/gaips-materials/fixtures gaips-labs/fixtures
cp -R docs/gaips-materials/guardrails gaips-labs/guardrails
cp docs/gaips-materials/ci/.gitlab-ci.yml gaips-labs/.gitlab-ci.yml
```

Students should still explain each result. Fixture mode replaces unavailable execution, not analysis.
