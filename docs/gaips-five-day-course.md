# GAIPS Five-Day Course Curriculum

This curriculum covers the GIAC AI Platform Security (GAIPS) objectives through hands-on labs, security analysis, red teaming, evaluation, deployment review, and a capstone project. Each day includes lecture topics, practical labs, tools, and deliverables.

The concrete instructor materials package for these labs is defined in `docs/gaips-instructor-materials.md` and implemented under `docs/gaips-materials/`. Do not treat a tool, starter app, fixture, cloud review, or pre-staged artifact as available unless that package contains it or the instructor has replaced it with an approved live environment.

## Course Outcomes

By the end of the course, students will be able to:

- Explain LLM architecture, capabilities, limitations, and attack surfaces.
- Build and assess RAG and agentic AI systems.
- Evaluate GenAI application architecture and integration-layer risks.
- Secure local and managed AI infrastructure.
- Apply MLOps and MLSecOps controls across the AI lifecycle.
- Use AI security testing and evaluation tools.
- Create threat models, risk registers, and governance artifacts for AI systems.
- Produce a capstone security assessment for a GenAI application.

## Core Tooling

- Model platforms: AWS Bedrock, Amazon SageMaker Python SDK with the Hugging Face Estimator, Ollama, OpenAI API, Anthropic Claude API, Hugging Face Hub/Transformers/Inference Endpoints, PyTorch, Llama Guard 3, vLLM or llama.cpp, LiteLLM.
- Application frameworks and clients: LangGraph, OpenAI Agents SDK, Cline as an MCP client, LlamaIndex.
- Retrieval systems: Chroma, Qdrant, Weaviate, Pinecone, Weaviate `text2vec-transformers`, Weaviate `qna-transformers`, Weaviate gRPC, AWS EFS-backed Weaviate persistence, and AWS Bedrock Knowledge Bases.
- Red-team tools: PyRIT, garak, Promptfoo, Giskard open source framework for testing models.
- Evaluation tools: Ragas, Inspect AI, MLflow GenAI, Evidently, Llama Guard 3 classification results.
- Pipeline and supply-chain tools: Semgrep, Syft with CycloneDX and SPDX SBOM outputs, Grype, Trivy, Hugging Face Hub malware/pickle/secrets/Protect AI/JFrog scanners, Buttercup for automated vulnerability finding and patching, Cosign, Sigstore model-transparency/model-signing, DVC.
- Deployment tools: Docker, Kubernetes, kubectl, NetworkPolicy, admission/policy checks, HashiCorp Vault or equivalent secrets management, and cloud IAM.
- Governance frameworks: OWASP LLM Top 10, MITRE ATLAS, NIST AI RMF, NIST GenAI Profile, Google SAIF.

## Capstone Thread

Students work on one GenAI application throughout the week. The application should include:

- A local model path using Ollama or another local runtime.
- A managed model path using AWS Bedrock, OpenAI, Azure OpenAI, Vertex AI, or Anthropic.
- A RAG workflow with document ingestion, vector search, and retrieval controls using Chroma plus a production-style vector database path such as Weaviate, Qdrant, or Pinecone.
- If Pinecone is selected as the production-style path, the capstone should include managed index configuration, namespaces, metadata filters, deletion protection, and API-key/access review.
- A safety-classification path using Llama Guard 3 or a comparable guardrail classifier for prompt and response checks.
- A tool-using agent with explicit permissions and traceability.
- A Kubernetes or cloud deployment review.
- A repeatable red-team and evaluation suite.
- A final risk register and executive summary.

## Day 1: LLM Foundations and AI Attack Surfaces

### Objectives Covered

- AI and LLM Foundations
- AI Risk Management and Strategic Application

### Learning Goals

- Understand core LLM concepts: tokens, embeddings, transformers, context windows, sampling, prompts, and inference.
- Compare hosted, local, open-weight, and fine-tuned models.
- Identify major GenAI attack surfaces.
- Establish a baseline risk model for AI systems.

### Module 1: Generative AI System Fundamentals

Topics:

- Transformer and LLM basics.
- Tokens, embeddings, attention, context windows, and sampling.
- System prompts, user prompts, assistant messages, tools, and retrieved context.
- Hosted model APIs vs local model serving.
- Model cards, data provenance, limitations, and safety claims.

Lab:

- Configure a prompt playground that can call a local Ollama model and one hosted model.
- Compare outputs across temperature, system prompt, and context changes.

Tools:

- Ollama
- OpenAI API, Anthropic Claude API, or AWS Bedrock
- LiteLLM

Deliverable:

- Model comparison table covering behavior, cost, latency, control surface, and security considerations.

### Module 2: LLM Threats and Failure Modes

Topics:

- Prompt injection and jailbreaks.
- Data leakage and prompt leakage.
- Hallucination and overreliance.
- Unsafe completion and policy bypass.
- Denial of wallet and resource abuse.
- OWASP LLM Top 10 overview.

Lab:

- Run a baseline red-team suite against the prompt playground.
- Test hallucination, refusal, prompt injection, secret extraction attempts, and unsafe content requests.

Tools:

- garak
- Promptfoo
- Inspect AI
- OWASP LLM Top 10

Deliverable:

- Baseline model behavior and vulnerability report.

### Module 3: AI Risk Framing

Topics:

- AI system inventory.
- Business purpose and misuse cases.
- NIST AI RMF and NIST GenAI Profile.
- MITRE ATLAS overview.
- Risk register structure.

Lab:

- Create an initial AI system inventory and risk register for the capstone app.

Tools:

- NIST AI RMF
- MITRE ATLAS
- OWASP LLM Top 10

Deliverable:

- Initial AI system inventory and top-five risk list.

## Day 2: RAG, Knowledge Augmentation, and Retrieval Security

### Objectives Covered

- Knowledge Augmentation and Retrieval
- AI Application Architecture and Development Frameworks
- AI and LLM Foundations

### Learning Goals

- Build a working RAG pipeline.
- Understand vector search, embeddings, chunking, metadata, and retrieval quality.
- Evaluate RAG-specific risks.
- Implement retrieval controls and run RAG evaluations.

### Module 1: RAG Architecture

Topics:

- Document ingestion.
- Chunking and embedding.
- Vector databases and similarity search.
- Retrieval, reranking, grounding, and citations.
- Local RAG vs managed knowledge bases.

Lab:

- Build a RAG workflow using LlamaIndex, Chroma or Qdrant, and Ollama.
- Extend or compare the workflow with Weaviate for schema design, hybrid search, metadata filtering, and isolation controls.
- Extend or compare the workflow with Pinecone for managed/serverless indexes, namespaces, metadata filters, and API-key access patterns.
- Review Weaviate modules including `text2vec-transformers` for vectorization and `qna-transformers` for answer extraction.
- Review Weaviate REST and gRPC access paths, including gRPC exposure on port `50051` where applicable.
- Review AWS/Kubernetes Weaviate persistence using EFS, StorageClass, PersistentVolumes, PersistentVolumeClaims, mount targets, and distinct EFS access points per Weaviate replica.
- Ingest a small controlled document set.

Tools:

- LlamaIndex
- Ollama
- Chroma, Qdrant, or Weaviate
- Pinecone
- Weaviate `text2vec-transformers`
- Weaviate `qna-transformers`
- Weaviate REST/gRPC clients
- AWS EFS and Kubernetes CSI/PV/PVC concepts

Deliverable:

- RAG architecture diagram and data flow.

### Module 2: Retrieval Security

Topics:

- Indirect prompt injection.
- Poisoned documents.
- Sensitive document retrieval.
- Weak metadata filtering and ACL bypass.
- Citation fabrication.
- Vector and embedding weaknesses.
- Weak schema design, tenant isolation mistakes, and metadata filtering bypasses in production-style vector databases.
- Weak Pinecone namespace or metadata-filter design, overbroad index access, unprotected API keys, and deletion-protection gaps.
- Overexposed Weaviate gRPC services.
- Misconfigured EFS persistence or shared replica data paths.
- Overconfident Q&A extraction from `qna-transformers`.

Lab:

- Add malicious and sensitive test documents.
- Attempt to retrieve unauthorized or poisoned content.
- Measure whether the model follows malicious instructions from retrieved documents.

Tools:

- Promptfoo
- Giskard
- OWASP LLM Top 10

Deliverable:

- RAG threat model (`evidence/day2/rag-threat-model.md`) and poisoned document test results.

### Module 3: RAG Evaluation and Controls

Topics:

- Context precision and recall.
- Faithfulness and groundedness.
- Answer relevance and factual correctness.
- Source attribution.
- Retrieval thresholds, filters, and reranking.
- Weaviate/Qdrant metadata filters, hybrid search settings, tenant isolation, and collection/schema governance.
- Weaviate module selection, field vectorization behavior, Q&A answer thresholds, and REST/gRPC query behavior.
- Pinecone index configuration, namespaces, metadata indexing/filtering, API-key handling, deletion protection, and tenant isolation.

Lab:

- Evaluate the RAG system before and after adding retrieval controls.
- Add document ACLs, metadata filters, source attribution, and relevance thresholds.

Tools:

- Ragas
- MLflow GenAI
- Giskard

Deliverable:

- RAG evaluation report comparing baseline and controlled retrieval behavior.

## Day 3: Agentic Systems and AI Application Architecture

### Objectives Covered

- Agentic Systems and AI Integrations
- AI Application Architecture and Development Frameworks
- AI Risk Management and Strategic Application

### Learning Goals

- Build and assess a tool-using agent.
- Identify trust boundaries in agentic workflows.
- Apply controls to tools, memory, context, and inter-agent communication.
- Review application architecture and supply-chain risk.

### Module 1: Agent Architecture and Tool Use

Topics:

- Agent loops, planners, tools, memory, and state.
- Tool calling and function calling.
- Multi-agent and delegated workflows.
- Context management and protocol-level risk.
- Human-in-the-loop control points.

Lab:

- Build a simple agent that can call at least three tools.
- Review an MCP-client workflow with Cline or an equivalent MCP client where available.
- Add tool allowlists, scoped credentials, and approval gates.

Tools:

- LangGraph or OpenAI Agents SDK
- Cline or another MCP client
- AWS Bedrock Agents
- LiteLLM

Deliverable:

- Agent architecture diagram and tool permission matrix.

### Module 2: Agent Red Teaming

Topics:

- Excessive agency.
- Unsafe tool invocation.
- Context poisoning.
- Insecure delegation.
- Prompt injection through tools and retrieved content.
- Audit logs and trace review.

Lab:

- Run adversarial tests against the agent.
- Verify whether the agent can be tricked into unauthorized tool use or policy bypass.

Tools:

- PyRIT
- Promptfoo
- MLflow GenAI traces
- Inspect AI

Deliverable:

- Agent red-team report with trace evidence and recommended controls.

### Module 3: Application Architecture and Supply Chain

Topics:

- GenAI app trust boundaries.
- Prompt templates as application logic.
- Third-party plugins and integrations.
- Secrets, logs, and model provider boundaries.
- SBOMs, CycloneDX, SPDX, and dependency scanning.
- Hugging Face Hub private repositories, fine-grained tokens, 2FA, SSO, Resource Groups, SSH/GPG workflows, and model-artifact scan results.

Lab:

- Review the capstone application architecture.
- Run SAST, dependency, CycloneDX/SPDX SBOM, vulnerability scans, Hugging Face Hub model-artifact scan review, and approved automated patch review.

Tools:

- Semgrep
- Syft
- CycloneDX
- SPDX
- Grype or Trivy
- Hugging Face Hub security scanners
- Buttercup
- OWASP LLM Top 10

Deliverable:

- Secure GenAI architecture checklist and supply-chain review.

## Day 4: Infrastructure, Deployment Security, and MLOps

### Objectives Covered

- AI Infrastructure and Deployment Security
- Development Pipelines and MLOps Security
- Model Customization and Alignment

### Learning Goals

- Secure local and managed model deployments.
- Review IAM, networking, secrets, logging, and endpoint exposure.
- Apply pipeline and artifact security controls.
- Understand model customization tradeoffs and alignment controls.

### Module 1: AI Infrastructure and Deployment Security

Topics:

- Local model endpoints with Ollama, vLLM, or llama.cpp.
- Managed platforms such as AWS Bedrock, Azure OpenAI, and Vertex AI.
- Hugging Face Hub and Inference Endpoint access controls for private model, dataset, and Space repositories.
- Kubernetes deployment patterns for AI apps, model gateways, vector databases, observability, and policy enforcement.
- IAM, private networking, authentication, rate limits, secrets management, and logging.
- Kubernetes Secrets, namespaces, NetworkPolicies, resource requests/limits, probes, ingress, and admission controls.
- HashiCorp Vault policies, secret paths, audit logs, rotation, and runtime secret injection patterns.
- Hugging Face fine-grained access tokens, 2FA, SSO, Resource Groups, Git over SSH, and GPG-signed commits.
- Denial of wallet and quota controls.
- Sensitive prompt and response logging risks.

Lab:

- Review or deploy a model endpoint.
- Harden it with authentication, network restrictions, logging controls, resource limits, and rate limits.
- Review or deploy the lab stack on Kubernetes, then verify secrets, network policy, service exposure, and resource controls.
- Review HashiCorp Vault or an equivalent secrets manager when configured for model-provider, vector-database, or tool credentials.
- Review Hugging Face Hub repository visibility, token scopes, org controls, signed commits, and scan results when Hugging Face is used.

Tools:

- AWS Bedrock
- Hugging Face Hub
- Ollama
- Docker
- Kubernetes
- kubectl
- HashiCorp Vault
- Open Policy Agent

Deliverable:

- Deployment security review and IAM/network checklist.

### Module 2: MLOps and MLSecOps

Topics:

- Data, prompt, model, and artifact lifecycle.
- Dataset and model provenance.
- SageMaker notebook-driven training jobs using the Hugging Face Estimator.
- IAM role, S3 input/output, training script, dependency, metric, and cost-control review for managed training.
- CI/CD risks.
- Data poisoning and artifact tampering.
- Drift and safety monitoring.
- Rollback and incident response.

Lab:

- Add pipeline controls to the capstone project.
- Sign or verify a lab-safe model artifact and document whether the deployment gate should allow it.
- Version data or eval sets, track evaluation runs, scan artifacts, and review an Amazon SageMaker Hugging Face Estimator notebook workflow.

Tools:

- DVC
- Amazon SageMaker Python SDK
- Hugging Face Estimator
- MLflow
- Evidently
- Semgrep
- Syft
- Grype or Trivy
- Cosign
- Sigstore model-transparency/model-signing

Deliverable:

- MLSecOps pipeline diagram, CI security checklist, SageMaker Hugging Face training-job review, and model-signature verification gate when model artifacts are used.

### Module 3: Model Customization and Guardrails

Topics:

- Prompt engineering vs RAG vs fine-tuning.
- PyTorch fundamentals for tensors, model loading, inference, and artifact handling.
- Llama Guard 3 as an input/output safety classifier and guardrail component.
- LoRA and adapters.
- Moderation and guardrails.
- Safety regression testing.
- Overfitting, memorization, and alignment risk.

Lab:

- Compare RAG, prompt-only, and guardrail-controlled responses against the same red-team test set.
- Optional: adapter-tune a small open-weight model or document the fine-tuning workflow and security checkpoints.
- Inspect a simple PyTorch inference or fine-tuning workflow and identify where data, model artifacts, and evaluation gates should be controlled.
- Classify a small prompt/response set with Llama Guard 3 or review classifier output, then compare false positives, false negatives, and policy coverage against the app's guardrails.

Tools:

- Hugging Face PEFT
- Hugging Face TRL
- PyTorch
- Llama Guard 3
- NVIDIA NeMo Guardrails
- OpenAI Guardrails
- Promptfoo
- Inspect AI

Deliverable:

- Model customization decision matrix, fine-tuning or adapter notes when applicable, and safety regression report (`evidence/day4/safety-regression-report.md`).

## Day 5: Governance, Integrated Assessment, and Capstone

### Objectives Covered

- All GAIPS objectives

### Learning Goals

- Integrate architecture, testing, deployment, MLOps, and governance into one assessment.
- Produce defensible security artifacts.
- Communicate AI risk and residual exposure clearly.
- Present technical findings and recommended next steps.

### Module 1: Integrated Threat Modeling

Topics:

- Combining STRIDE, OWASP LLM Top 10, MITRE ATLAS, and NIST AI RMF.
- Source-to-sink thinking for AI systems.
- Control mapping and residual risk.
- Risk acceptance and remediation planning.

Lab:

- Complete the capstone threat model.
- Map top findings to controls, owners, and residual risk.

Tools:

- OWASP LLM Top 10
- MITRE ATLAS
- NIST AI RMF
- Google SAIF

Deliverable:

- Final threat model and AI risk register.

### Module 2: Full Red-Team and Evaluation Run

Topics:

- Building repeatable test suites.
- Regression testing after controls are added.
- Comparing baseline and hardened results.
- Evidence collection and reporting.

Lab:

- Run the final red-team and evaluation suite against the capstone application.
- Compare results against Day 1 through Day 4 baselines.

Tools:

- PyRIT
- garak
- Promptfoo
- Giskard
- Ragas
- Inspect AI
- MLflow GenAI

Deliverable:

- Final red-team and evaluation report.

### Module 3: Capstone Presentation and Review

Topics:

- Executive summaries for AI security.
- Technical appendix structure.
- Clear residual risk communication.
- Prioritized remediation.
- Operational next steps.

Lab:

- Assemble and present capstone findings.

Required capstone artifacts:

- Architecture diagram.
- Data flow diagram.
- Agent tool permission matrix.
- RAG threat model (`evidence/day2/rag-threat-model.md`) and evaluation results.
- Deployment security review.
- SBOM and vulnerability scan summary.
- MLOps/MLSecOps pipeline checklist.
- Red-team report.
- Risk register.
- Executive summary.

Deliverable:

- Final capstone package.

## Daily Schedule Template

- 09:00-09:20: Review, objectives, and prerequisite checks.
- 09:20-10:15: Module 1 lecture and demonstration.
- 10:15-10:30: Break.
- 10:30-11:20: Module 1 lab.
- 11:20-12:00: Module 2 lecture and demonstration.
- 12:00-13:00: Lunch.
- 13:00-13:50: Module 2 lab.
- 13:50-14:35: Module 3 lecture and demonstration.
- 14:35-14:50: Break.
- 14:50-15:40: Module 3 lab or guided review.
- 15:40-17:00: Capstone work, evidence cleanup, and daily deliverable checkpoint.

For days with heavier optional labs, instructors should preselect the vector database, cloud, MCP-client, or guardrail path before class rather than attempting every optional branch.

## Pre-Course Setup

Students should have:

- A laptop capable of running Docker.
- Optional but recommended: local Kubernetes through Docker Desktop Kubernetes, kind, minikube, or another instructor-approved cluster.
- Python 3.11 or later.
- Node.js LTS.
- Git.
- Ollama installed with at least one local model.
- Hugging Face account access, 2FA enabled, and lab-safe fine-grained token if Hugging Face Hub labs are enabled.
- Git over SSH and GPG signing configured if signed Hub commit review is enabled.
- Giskard available in the Python environment, or `docs/gaips-materials/fixtures/giskard-results.json` for fixture-mode review.
- Cline installed as an MCP client in the approved editor if MCP-client labs are enabled.
- Buttercup available only in lab repositories where automated vulnerability finding and patching has been approved.
- Access to one managed model platform such as AWS Bedrock, OpenAI, Anthropic, Azure OpenAI, or Vertex AI.
- API keys or cloud credentials configured using least privilege.
- A code editor.
- kubectl configured for the lab cluster if Kubernetes labs are used.
- HashiCorp Vault CLI or UI access to a lab-safe Vault instance if Vault labs are enabled.

Recommended preloaded models:

- llama3.1 or llama3.2 through Ollama.
- mistral or qwen through Ollama.
- One hosted model through AWS Bedrock or another provider.

Recommended repositories or lab folders:

- Starter GenAI app: `docs/gaips-materials/starter-rag-app/`.
- Small document corpus for RAG: `docs/gaips-materials/data/docs/`.
- Benign malicious-document test set: `docs/gaips-materials/data/malicious/`.
- Prompt and red-team test set: `docs/gaips-materials/evals/` and `docs/gaips-materials/fixtures/`.

## Instructor Preparation

- Verify all local and hosted model paths.
- Prepare fallback hosted model credentials in case a provider is unavailable.
- Pre-stage Docker images and Python dependencies where possible.
- Pre-stage lab-safe Hugging Face private model, dataset, or Space repositories with scan results and no real secrets.
- Pre-stage Hugging Face org access examples for fine-grained tokens, SSO, Resource Groups, SSH, and GPG-signed commits where available.
- Pre-stage Kubernetes manifests or Helm charts for the lab app when using Kubernetes.
- Pre-stage a lab-safe HashiCorp Vault dev/test instance, sample policies, and fake model-provider secrets if Vault labs are enabled.
- Pre-stage Weaviate or Qdrant vector database deployment options.
- Pre-stage Pinecone account/index instructions or a design-review fallback if students do not have managed vector DB access.
- Pre-stage PyTorch examples that can run on CPU for students without GPU access.
- Use `docs/gaips-materials/fixtures/giskard-results.json` and `docs/gaips-materials/evals/giskard.md` for model, RAG, or business-logic testing fallback.
- Use `docs/gaips-materials/mcp/cline_mcp_settings.json` for Cline MCP client configuration that points only to lab-safe MCP servers and tools.
- Use `docs/gaips-materials/buttercup/` for automated vulnerability finding and patch-review fixtures without touching production repositories.
- Use `docs/gaips-materials/guardrails/llama-guard-3-results.json` for environments that cannot run the model locally.
- Use `docs/gaips-materials/model-signing/model-signing-fixture.json` for signed, unsigned, and tampered model-artifact verification.
- Use `docs/gaips-materials/sagemaker/` for the Hugging Face Estimator notebook fixture, sanitized training script, least-privilege IAM role example, S3 input/output paths, metric definitions, and expected training-job output.
- Prepare sanitized documents for RAG labs.
- Prepare safe adversarial prompts that do not require illegal or harmful real-world exploitation.
- Prepare answer keys for expected failure modes and controls.
- Confirm that all labs can be completed without transmitting sensitive student data.

## Assessment Rubric

- Foundations: clearly explains LLM concepts, limitations, and attack surfaces.
- RAG security: identifies retrieval risks and implements practical controls.
- Agent security: documents tool risks, permission boundaries, and trace evidence.
- Architecture: maps trust boundaries and supply-chain dependencies.
- Infrastructure: applies IAM, network, logging, rate limit, and artifact controls.
- MLOps: versions data/evals, tracks changes, and monitors quality or drift.
- Governance: uses accepted frameworks to produce a practical risk register.
- Capstone: integrates findings into a coherent, evidence-backed security assessment.
