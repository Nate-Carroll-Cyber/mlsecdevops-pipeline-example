# GAIPS Study Plan

This study plan maps the GIAC AI Platform Security (GAIPS) exam objectives to practical learning tasks, tools, labs, and capstone deliverables. The goal is to build hands-on evidence that covers AI/LLM fundamentals, agentic systems, RAG, infrastructure, MLOps, risk management, and model customization.

Hands-on labs are backed by `docs/gaips-instructor-materials.md` and `docs/gaips-materials/`. Tool-stack entries that require cloud access, gated models, or unavailable installs must either use those fixtures or be explicitly marked as design-review-only by the instructor.

## Exam Objectives

1. Agentic Systems and AI Integrations
2. AI and LLM Foundations
3. AI Application Architecture and Development Frameworks
4. AI Infrastructure and Deployment Security
5. AI Risk Management and Strategic Application
6. Development Pipelines and MLOps Security
7. Knowledge Augmentation and Retrieval
8. Model Customization and Alignment

## Tool Stack

### Model and Runtime Platforms

- AWS Bedrock: managed foundation models, Bedrock Agents, Knowledge Bases, Guardrails, IAM, private networking, logging, and cloud governance.
- Ollama: local model serving for low-cost labs, offline testing, local red teaming, and repeatable experiments.
- OpenAI API and Agents SDK: hosted model workflows, agent tooling, guardrails, tracing, and evaluation.
- Anthropic Claude API: alternate hosted model behavior for prompt, safety, and application security comparisons.
- Amazon SageMaker Python SDK and Hugging Face Estimator: launching managed Hugging Face training jobs from Jupyter notebooks, reviewing IAM roles, S3 inputs/outputs, training scripts, metrics, and job-cost controls.
- Hugging Face Transformers, Inference Endpoints, and Hub: open-weight model loading, model cards, adapters, private repositories, fine-grained tokens, 2FA, SSH/GPG workflows, SSO, Resource Groups, and deployment comparisons.
- PyTorch: tensor/model fundamentals, local inference, fine-tuning mechanics, model artifact handling, and safety regression labs.
- Llama Guard 3: Meta safety classifier for prompt and response classification, MLCommons hazard taxonomy coverage, guardrail comparison, and false-positive/false-negative analysis.
- vLLM or llama.cpp: self-hosted inference, endpoint hardening, performance tradeoffs, and local deployment security.
- LiteLLM: model gateway, provider abstraction, usage logging, budget controls, routing, and policy enforcement.
- Azure AI Foundry / Azure OpenAI: enterprise model hosting, identity, private endpoints, logging, and policy controls. In the default course this is a managed-provider comparison/design-review path unless the instructor supplies approved Azure lab access.
- Google Vertex AI: managed GenAI deployment, grounding, evaluation, and cloud IAM practice. In the default course this is covered through Model Armor fixtures under `docs/gaips-materials/guardrails/` unless the instructor supplies approved Google Cloud lab access.

### Build Tools

- LangGraph: stateful agents, tool routing, and controlled agent workflows.
- OpenAI Agents SDK: agent workflows, tool use, handoffs, tracing, and guardrails.
- Cline: MCP client for practicing model-context-protocol tool integration, approval boundaries, and agent workflow review.
- LlamaIndex: RAG pipelines, document ingestion, retrieval, and vector DB integration.
- Chroma: simple local vector database for quick RAG labs.
- Qdrant: production-style vector search, metadata filtering, and retrieval security testing.
- Weaviate: production-style vector database, schema design, hybrid search, metadata filtering, multi-tenancy, module-backed vectorization, Q&A extraction, gRPC API review, and RAG isolation testing.
- Pinecone: managed/serverless vector database, indexes, namespaces, metadata filtering, hybrid retrieval, multitenancy design, deletion protection, API-key handling, and managed RAG security comparison.
- Kubernetes: container orchestration for AI applications, model services, vector databases, secrets, network policy, resource controls, and observability.
- HashiCorp Vault: secrets management for API keys, model-provider credentials, dynamic secrets, audit logging, and secret injection patterns.

### Security Testing and Red Teaming

- PyRIT: automated GenAI red-team campaigns, adversarial prompt orchestration, scoring, and target abstraction.
- garak: LLM vulnerability scanning for prompt injection, leakage, jailbreaks, hallucination, misinformation, and other failure modes.
- Promptfoo: prompt/application evaluation, adversarial test generation, agent red teaming, and regression suites.
- Giskard: open source framework for testing models, including LLM scans, RAG testing, business-logic failure testing, and continuous red-team workflows.

### Evaluation and Observability

- Ragas: RAG and agent evaluation metrics, including context precision/recall, faithfulness, factual correctness, and custom metrics.
- Inspect AI: structured model and agent evaluations, datasets, solvers, scorers, tools, and sandboxed evals.
- MLflow GenAI: traces, eval runs, built-in scorers, retrieval groundedness, retrieval relevance, safety, and tool-call evaluation.
- Evidently: data drift, prediction drift, text drift, and quality monitoring.

### Pipeline, Supply Chain, and Governance

- Semgrep: SAST, secrets scanning, and dependency risk checks.
- Syft: SBOM generation for repositories, filesystems, and container images, with CycloneDX and SPDX output formats for interchange and downstream vulnerability review.
- Grype or Trivy: vulnerability scanning for SBOMs, filesystems, repositories, images, and IaC.
- Hugging Face Hub security scanners: malware scanning, pickle import analysis, TruffleHog secrets scanning, Protect AI Guardian, and JFrog model security scanning for model and dataset repositories.
- Buttercup: automated AI for finding and patching vulnerabilities, with generated patches reviewed before merge.
- Cosign / Sigstore: signing and verifying container images and software artifacts.
- Sigstore model-transparency/model-signing: signing ML model artifacts, generating verifiable model digests, producing DSSE/in-toto-backed signature bundles, verifying signer identity, and detecting post-approval model tampering.
- DVC: data and model versioning with Git-linked reproducibility.
- Open Policy Agent: policy-as-code for deployment, runtime, and tool authorization controls.
- OWASP LLM Top 10: LLM application risk taxonomy.
- MITRE ATLAS: adversarial AI tactics, techniques, and procedures.
- NIST AI RMF and NIST GenAI Profile: AI risk management and governance structure.
- Google SAIF: secure AI system design and organizational security guidance.

## Objective 1: Agentic Systems and AI Integrations

Outcome: Demonstrate the ability to design and assess agentic AI systems, including inter-agent communication, context management, and protocol-level security.

Tasks:

- Build a simple agent that can call at least three tools: search, file retrieval, and a harmless API action.
- Implement explicit tool allowlists, scoped credentials, rate limits, and human approval gates for sensitive actions.
- Trace agent execution from user request through planning, tool calls, intermediate outputs, and final response.
- Test excessive agency, unsafe tool invocation, context poisoning, indirect prompt injection, and insecure delegation.
- Compare one local agent workflow using Ollama with one hosted workflow using AWS Bedrock Agents or OpenAI Agents SDK.

Recommended tools:

- LangGraph
- OpenAI Agents SDK
- AWS Bedrock Agents
- Cline
- Ollama
- LiteLLM
- Promptfoo
- PyRIT
- MLflow GenAI
- Open Policy Agent

Deliverables:

- Agent architecture diagram.
- Tool permission matrix.
- Red-team test results for excessive agency and unsafe tool use.
- Trace review showing where controls are enforced.

## Objective 2: AI and LLM Foundations

Outcome: Demonstrate technical understanding of generative AI systems, including capabilities, limitations, and attack surfaces.

Tasks:

- Explain tokens, embeddings, transformers, context windows, sampling parameters, system prompts, and inference.
- Compare local, hosted, open-weight, and fine-tuned model deployment models.
- Build a prompt playground that can switch between Ollama, AWS Bedrock, OpenAI, and at least one other provider through LiteLLM.
- Run baseline behavior tests for hallucination, refusal, prompt injection, leakage, and unsafe completion.
- Record how model choice, temperature, context length, and prompt structure affect security behavior.

Recommended tools:

- Ollama
- AWS Bedrock
- OpenAI API
- Anthropic Claude API
- Hugging Face Transformers
- LiteLLM
- garak
- Promptfoo
- Inspect AI

Deliverables:

- LLM fundamentals notes.
- Model comparison table.
- Baseline vulnerability scan report.
- One-page attack surface map for LLM applications.

## Objective 3: AI Application Architecture and Development Frameworks

Outcome: Demonstrate the ability to evaluate and apply GenAI application architecture best practices and development frameworks, identifying supply-chain and integration-layer vulnerabilities.

Tasks:

- Map common GenAI application patterns: chatbot, RAG app, tool-using agent, workflow assistant, and code assistant.
- Build a minimal GenAI application with a frontend, backend, model provider, logging, and one integration.
- Identify trust boundaries between user input, application code, prompts, tools, retrieved context, model responses, and downstream systems.
- Run dependency, secret, SBOM, and container scans against the application.
- Review Hugging Face Hub model, dataset, and Space repositories for private visibility, token scope, 2FA/SSO, Resource Groups, SSH/GPG usage, and model-artifact scan results.
- Review risks from model providers, third-party plugins, prompt templates, vector stores, and API integrations.

Recommended tools:

- LlamaIndex
- LangGraph
- OpenAI Agents SDK
- AWS Bedrock
- Hugging Face Hub
- Semgrep
- Syft
- Grype or Trivy
- Cosign
- OWASP LLM Top 10

Deliverables:

- Secure GenAI architecture checklist.
- Data flow diagram.
- Supply-chain review.
- Hugging Face Hub security review.
- SBOM and vulnerability scan summary.

## Objective 4: AI Infrastructure and Deployment Security

Outcome: Demonstrate the ability to assess security risks associated with hosting GenAI applications and models across cloud and other infrastructure environments, and identify appropriate security controls.

Tasks:

- Deploy one local model endpoint with Ollama, vLLM, or llama.cpp.
- Deploy or review one managed model workflow using AWS Bedrock.
- Deploy or review one AI application stack on Kubernetes, including model gateway, backend API, vector database, and observability components.
- Harden model endpoints with authentication, TLS, rate limits, network restrictions, logging, and least-privilege access.
- Apply Kubernetes controls such as namespaces, Secrets, NetworkPolicies, resource requests/limits, health checks, and admission or policy checks.
- Review cloud IAM for model invocation, knowledge base access, log access, and deployment changes.
- Review Hugging Face Hub access controls for private model/dataset/Space repositories, fine-grained user access tokens, 2FA, SSO, Resource Groups, Git over SSH, and GPG-signed commits.
- Review HashiCorp Vault or an equivalent secrets manager for storage, access policy, audit logging, rotation, and runtime injection of model-provider and vector-database credentials.
- Generate an SBOM, scan the image or filesystem, and sign the deployment artifact.
- Evaluate abuse cases such as denial of wallet, unbounded context use, exposed model endpoints, and logging sensitive prompts.

Recommended tools:

- AWS Bedrock
- Hugging Face Hub
- Ollama
- vLLM or llama.cpp
- Docker
- Kubernetes
- Trivy
- Syft
- Grype
- Cosign
- Open Policy Agent
- HashiCorp Vault
- Cloud IAM tooling

Deliverables:

- Deployment security review.
- IAM and network control checklist.
- Hugging Face Hub access-control checklist.
- Signed artifact or image verification record.
- Abuse-case test results.

## Objective 5: AI Risk Management and Strategic Application

Outcome: Demonstrate understanding of applying structured threat modeling methodologies and long-term security planning to AI systems to support responsible AI use while maintaining business agility.

Tasks:

- Create an AI system inventory with owner, purpose, model/provider, data types, integrations, users, and risk rating.
- Apply OWASP LLM Top 10, MITRE ATLAS, and NIST AI RMF to one AI application.
- Build a risk register with likelihood, impact, controls, control owner, residual risk, and review cadence.
- Define acceptable use, model selection, data handling, human review, logging, and incident response policies.
- Map business benefits against security, privacy, compliance, cost, and operational risks.

Recommended tools and frameworks:

- NIST AI RMF
- NIST GenAI Profile
- OWASP LLM Top 10
- MITRE ATLAS
- Google SAIF
- Open Policy Agent
- Internal risk register

Deliverables:

- AI system inventory.
- Threat model.
- Risk register.
- Governance checklist.
- Policy recommendations.

## Objective 6: Development Pipelines and MLOps Security

Outcome: Demonstrate knowledge of securing data workflows, training pipelines, and model lifecycle operations using MLOps and MLSecOps practices.

Tasks:

- Diagram the lifecycle for data collection, labeling, preprocessing, training or fine-tuning, evaluation, deployment, monitoring, and rollback.
- Version datasets, prompts, eval sets, model artifacts, and configuration.
- Add CI checks for SAST, secrets, dependency vulnerabilities, CycloneDX/SPDX SBOM generation, model training-job review, and artifact signing.
- Track model/application evaluation runs and compare regressions across model, prompt, retrieval, and guardrail changes.
- Monitor drift, abuse, data quality, latency, cost, and safety failures.
- Test risks from poisoned data, insecure artifacts, exposed secrets, untrusted notebooks, and compromised CI/CD.

Recommended tools:

- DVC
- MLflow
- Evidently
- Semgrep
- Syft
- Grype or Trivy
- Cosign
- Ragas
- Inspect AI

Deliverables:

- MLOps/MLSecOps pipeline diagram.
- Reproducibility checklist.
- CI security checklist.
- Evaluation tracking report.
- Drift and monitoring plan.

## Objective 7: Knowledge Augmentation and Retrieval

Outcome: Demonstrate understanding of retrieval-augmented architectures and evaluate security risks associated with vector databases and external knowledge sources.

Tasks:

- Build a RAG pipeline with document ingestion, chunking, embeddings, vector storage, retrieval, and grounded generation.
- Compare a local RAG stack using Ollama, LlamaIndex, and Chroma with a production-style stack using AWS Bedrock Knowledge Bases, Qdrant, Weaviate, or Pinecone.
- Configure or review Weaviate with `text2vec-transformers`, `qna-transformers`, REST, gRPC, and collection/schema controls.
- Review Weaviate on AWS with Kubernetes, EFS-backed persistence, distinct EFS access points per replica, mount targets, security groups, StorageClass, PersistentVolumes, and PersistentVolumeClaims.
- Configure or review Pinecone serverless indexes, namespaces, metadata indexing/filtering, API keys, deletion protection, and tenant/data isolation patterns.
- Test poisoned documents, malicious instructions in retrieved content, weak ACLs, stale embeddings, bad chunking, overbroad retrieval, and citation fabrication.
- Implement schema design, metadata filtering, tenant or user isolation, document ACLs, source attribution, relevance thresholds, query logging, and retrieval evals.
- Compare retrieval quality under vector-only, keyword, hybrid, and reranked retrieval.

Recommended tools:

- LlamaIndex
- AWS Bedrock Knowledge Bases using the design-review fixture in `docs/gaips-materials/bedrock-knowledge-bases/` unless approved AWS lab access is available
- Chroma
- Qdrant
- Weaviate
- Pinecone
- Ollama
- Ragas
- Giskard
- MLflow GenAI retrieval scorers
- Promptfoo

Recommended reference:

- OWASP LLM08: Vector and Embedding Weaknesses

Deliverables:

- RAG threat model: `evidence/day2/rag-threat-model.md`.
- Weaviate AWS deployment and API exposure review.
- Pinecone index, namespace, and metadata filtering review.
- Retrieval evaluation report.
- Poisoned document test results.
- ACL and metadata filtering checklist.
- Mitigation plan for retrieval-specific risks.

## Objective 8: Model Customization and Alignment

Outcome: Demonstrate understanding of methods for adapting and aligning foundation models through fine-tuning and moderation controls, including associated security implications.

Tasks:

- Compare prompt engineering, system prompts, RAG, fine-tuning, LoRA/adapters, moderation, Llama Guard 3, and guardrails.
- Use PyTorch to inspect tensors/model artifacts and fine-tune or adapter-tune a small open-weight model in a controlled lab, or document the process if hardware is insufficient.
- Evaluate when RAG is safer than fine-tuning and when model customization is justified.
- Test jailbreaks, policy bypasses, sensitive output, overfitting, memorization, and safety regression.
- Add input and output guardrails, including a Llama Guard 3 classifier path where feasible, then measure both security improvement and usability impact.
- Create a regression test set that runs before and after customization.

Recommended tools:

- Hugging Face PEFT
- Hugging Face TRL
- PyTorch
- Llama Guard 3
- Ollama
- OpenAI Guardrails
- NVIDIA NeMo Guardrails
- Promptfoo
- PyRIT
- Inspect AI
- garak

Deliverables:

- Model customization decision matrix.
- Fine-tuning or adapter lab notes: `evidence/day4/fine-tuning-adapter-notes.md`.
- Guardrail design and test results.
- Safety regression report: `evidence/day4/safety-regression-report.md`.

## Capstone Project

Build or assess one small GenAI application that includes both RAG and agentic tool use.

Minimum requirements:

- One local model path using Ollama or another local runtime.
- One managed model path using AWS Bedrock, OpenAI, Azure OpenAI, Vertex AI, or Anthropic.
- One RAG workflow with document ingestion, vector search, retrieval controls, and citations.
- One production-style vector database path using Weaviate, Qdrant, or Pinecone, with schema or namespace design, metadata filtering, and isolation controls.
- If Pinecone is selected, include managed index configuration, namespaces, metadata filters, deletion protection, and API-key/access review.
- One tool-using agent with explicit permissions and traceability.
- One Kubernetes or cloud deployment review with IAM, network, logging, rate limit, resource, and secret-handling controls.
- If HashiCorp Vault or another secrets manager is used, review secret paths, policies, audit logs, rotation approach, and runtime injection pattern.
- One CI or pipeline workflow with dependency scanning, SBOM generation, and evaluation checks.
- One red-team and evaluation suite that can be rerun after changes.

Capstone deliverables:

- Architecture diagram.
- Data flow diagram.
- Threat model.
- CycloneDX and SPDX SBOMs.
- Vulnerability scan summary.
- Agent tool permission matrix.
- RAG evaluation report.
- Red-team report.
- MLflow, Inspect AI, Ragas, or Promptfoo evaluation results.
- AI risk register.
- Final executive summary with residual risks and recommended next steps.

## Suggested Learning Sequence

1. Foundations: Ollama, hosted APIs, prompt playground, and baseline model behavior tests.
2. RAG: LlamaIndex, Chroma/Qdrant/Weaviate/Pinecone, Ragas, and poisoned document testing.
3. Agents: LangGraph or OpenAI Agents SDK, tool permissions, tracing, and excessive agency testing.
4. Security testing: garak, PyRIT, Promptfoo, and Giskard against the same app.
5. Deployment: AWS Bedrock, local runtime hardening, Kubernetes, IAM, logging, SBOMs, scanning, and signing.
6. MLOps: DVC, MLflow, Evidently, reproducibility, drift, and regression evaluation.
7. Governance: OWASP LLM Top 10, MITRE ATLAS, NIST AI RMF, and risk register.
8. Capstone: combine the pieces into one defensible portfolio artifact.

## Reference Links

- GIAC GAIPS: https://www.giac.org/certifications/ai-security-platform-security-gaips
- AWS Bedrock: https://aws.amazon.com/bedrock/
- Ollama: https://ollama.com/
- PyTorch: https://pytorch.org/
- Kubernetes: https://kubernetes.io/
- Weaviate: https://weaviate.io/developers/weaviate
- Pinecone: https://docs.pinecone.io/
- Hugging Face Hub security: https://huggingface.co/docs/hub/security
- Meta Llama Guard 3 model card: https://github.com/meta-llama/PurpleLlama/blob/main/Llama-Guard3/1B/MODEL_CARD.md
- OWASP GenAI Security Project: https://genai.owasp.org/
- OWASP LLM Top 10: https://genai.owasp.org/llm-top-10/
- MITRE ATLAS: https://atlas.mitre.org/
- NIST AI RMF: https://www.nist.gov/itl/ai-risk-management-framework
- Google SAIF: https://saif.google/
- HashiCorp Vault: https://developer.hashicorp.com/vault/docs
- Microsoft PyRIT: https://github.com/microsoft/PyRIT
- NVIDIA garak: https://github.com/NVIDIA/garak
- Promptfoo: https://www.promptfoo.dev/docs/guides/llm-redteaming/
- Giskard: https://docs.giskard.ai/
- Ragas: https://docs.ragas.io/
- Inspect AI: https://inspect.aisi.org.uk/
- MLflow GenAI: https://mlflow.org/docs/latest/genai/
- Semgrep: https://semgrep.dev/docs/
- Syft: https://github.com/anchore/syft
- CycloneDX: https://cyclonedx.org/
- SPDX: https://spdx.dev/
- Amazon SageMaker Hugging Face: https://docs.aws.amazon.com/sagemaker/latest/dg/hugging-face.html
- SageMaker Python SDK HuggingFace Estimator: https://sagemaker.readthedocs.io/en/stable/frameworks/huggingface/sagemaker.huggingface.html
- Grype: https://github.com/anchore/grype
- Trivy: https://trivy.dev/
- Cosign / Sigstore: https://docs.sigstore.dev/cosign/
- Sigstore model-transparency: https://github.com/sigstore/model-transparency
- DVC: https://dvc.org/doc
- Evidently: https://docs.evidentlyai.com/
- Open Policy Agent: https://www.openpolicyagent.org/docs/latest/
- LlamaIndex: https://docs.llamaindex.ai/
- LangGraph: https://docs.langchain.com/langgraph/
- OpenAI Agents SDK: https://openai.github.io/openai-agents-python/
- Hugging Face PEFT: https://huggingface.co/docs/peft
- Hugging Face TRL: https://huggingface.co/docs/trl
- NVIDIA NeMo Guardrails: https://docs.nvidia.com/nemo-guardrails/
