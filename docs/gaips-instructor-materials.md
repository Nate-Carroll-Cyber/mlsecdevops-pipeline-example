# GAIPS Instructor Materials Package

This package closes the fixture and starter-artifact gaps in the GAIPS course docs. Every lab reference to an instructor-provided app, fixture, output, config, or pre-staged artifact should resolve to a file under `docs/gaips-materials/` unless an instructor intentionally replaces it with a live class environment.

## How To Use This Package

Use the package in one of two modes:

| Mode | When to use | Required action |
| --- | --- | --- |
| Live lab | Students have approved local tools, lab cloud accounts, and disposable lab repos | Run the commands in the walkthrough and compare outputs against the fixture examples. |
| Fixture lab | Tools, cloud accounts, gated models, or external services are unavailable | Use the fixture outputs in `docs/gaips-materials/fixtures/` and require students to interpret the security result and control decision. |

Do not describe a fixture as available unless the corresponding file is listed below.

## Material Manifest

| Gap Closed | Material | Required For |
| --- | --- | --- |
| Starter capstone RAG app | `docs/gaips-materials/starter-rag-app/` | Day 2 RAG, poisoning, citations, capstone thread |
| Shared model gateway | `docs/gaips-materials/model-gateway/model_gateway.py` | Day 1 model calls, Day 2 RAG generation, Day 5 evidence |
| Safe document corpus | `docs/gaips-materials/data/docs/` | RAG ingestion and baseline retrieval |
| Malicious test document | `docs/gaips-materials/data/malicious/test-prompt-injection.md` | RAG poisoning and indirect prompt injection |
| Promptfoo config | `docs/gaips-materials/evals/promptfoo.yaml` | Prompt and RAG regression |
| garak runbook and fixture | `docs/gaips-materials/evals/garak.md`, `docs/gaips-materials/fixtures/garak-results.json` | LLM red-team interpretation |
| Giskard runbook and fixture | `docs/gaips-materials/evals/giskard.md`, `docs/gaips-materials/fixtures/giskard-results.json` | RAG/business logic testing |
| Inspect AI eval and fixture | `docs/gaips-materials/evals/inspect_eval.py`, `docs/gaips-materials/fixtures/inspect-ai-results.json` | Structured model and agent evals |
| PyRIT runbook and fixture | `docs/gaips-materials/evals/pyrit.md`, `docs/gaips-materials/fixtures/pyrit-results.json` | Automated red-team fallback |
| HackAgent fixture | `docs/gaips-materials/fixtures/hackagent-results.json` | Agent security fallback |
| Prompt Guard fixture | `docs/gaips-materials/guardrails/prompt-guard-results.json` | Day 4 local classifier interpretation |
| Llama Guard 3 fixture | `docs/gaips-materials/guardrails/llama-guard-3-results.json` | Day 4 safety taxonomy interpretation |
| Model Armor fixture | `docs/gaips-materials/guardrails/model-armor-results.json` | Day 4 managed screening interpretation |
| Guardrail regression summary | `docs/gaips-materials/guardrails/guardrail-regression.md` | Day 4 and Day 5 final regression evidence |
| Cline MCP safe config | `docs/gaips-materials/mcp/cline_mcp_settings.json` | MCP-client review without production tools |
| Lab-safe agent fixture | `docs/gaips-materials/agent/lab-agent-fixture.md` | Agent and HackAgent labs without production tools |
| Buttercup findings fixture | `docs/gaips-materials/buttercup/` | Automated vulnerability finding and patch review |
| GitLab CI sample | `docs/gaips-materials/ci/.gitlab-ci.yml` | AI/ML security pipeline with SAST, SBOM, vulnerability scanning, model-integrity gates, AI evals, guardrail regression, and evidence artifacts |
| Explicit fixture eval runner | `docs/gaips-materials/scripts/run_fixture_evals.py --allow-fixtures` | Fixture-only class sessions; not used by live CI jobs |
| Hugging Face Hub review fixture | `docs/gaips-materials/hugging-face-hub/` | Hub security review without lab account access |
| Kubernetes manifests | `docs/gaips-materials/deployment/kubernetes/` | Deployment review lab |
| Vault dev policy fixture | `docs/gaips-materials/deployment/vault/` | Secrets-management review lab |
| Model-signing fixture | `docs/gaips-materials/model-signing/` | Day 4 signing/verification fallback |
| SageMaker fixture | `docs/gaips-materials/sagemaker/` | Hugging Face Estimator review without AWS job launch |
| Bedrock Knowledge Bases fixture | `docs/gaips-materials/bedrock-knowledge-bases/` | Managed vector/RAG design review |
| Lab 12 completed matrix | `docs/gaips-materials/model-customization/lab12-completed-matrix.md` | Day 4 customization deliverable |

## Instructor Readiness Gate

Before class, verify these checks:

| Check | Pass Criteria |
| --- | --- |
| Materials package present | `docs/gaips-materials/README.md` and this manifest exist. |
| Starter app path present | `docs/gaips-materials/starter-rag-app/app.py` exists. |
| Gateway path present | `docs/gaips-materials/model-gateway/model_gateway.py` exists. |
| Fixtures present | `fixtures/*.json` and `guardrails/*.json` exist. |
| CI sample present | `docs/gaips-materials/ci/.gitlab-ci.yml` exists and defines setup, sast, sbom, vuln-scan, model-integrity, ai-eval, guardrail, and evidence stages. |
| Optional cloud labs bounded | Bedrock, Vertex/Model Armor, Azure, SageMaker, Kubernetes, and Vault have design-review or fixture alternatives. |

If a live tool is substituted for a fixture, students must record the tool version, command, target, and output artifact path in `evidence/tooling-inventory.md`.

### CI Gate Requirement

The GitLab CI material is an AI/ML security pipeline, not a fixture-copy pipeline. It runs the stages `setup`, `sast`, `sbom`, `vuln-scan`, `model-integrity`, `ai-eval`, `guardrail`, and `evidence`.

The supply-chain and package-integrity path includes Semgrep, `pip-audit`, package hash/integrity checks, optional conda environment verification, Syft CycloneDX/SPDX SBOM generation, Grype, and Trivy. The model-integrity path includes model digest generation, signature verification, tamper verification, ModelScan, Hugging Face artifact scanning, and an artifact-signing gate before AI evaluation jobs run. The AI evaluation path includes RAG smoke evaluation, Promptfoo, garak, Giskard, Inspect AI, and PyRIT. The evidence path writes summary evidence and a model-signing evidence bundle, with bundle signing when `cosign` is available.

Before using the CI sample in a student repository, instructors must verify that required project files exist, including `requirements.txt`, `models/`, `promptfooconfig.yaml`, `guardrails/baseline.json`, and the project scripts referenced by CI: `scripts/rag_smoke_eval.py`, `scripts/pyrit_scan.py`, `scripts/guardrail_regression.py`, and `scripts/evidence_summary.py`.
