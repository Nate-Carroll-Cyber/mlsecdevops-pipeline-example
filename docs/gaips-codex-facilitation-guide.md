# GAIPS Codex Facilitation Guide

This guide explains how to use Codex as an interactive lab facilitator for the GAIPS five-day course. It is written for students, instructors, and assistants who want a step-by-step visual walkthrough using a shared repository, terminal commands, local applications, browser checks, screenshots, and evidence files.

## Purpose

Codex can help students work through the course by:

- Checking prerequisites.
- Creating starter files.
- Running lab commands.
- Starting local services.
- Opening local apps in the browser.
- Inspecting UI state.
- Taking screenshots when browser tooling is available.
- Explaining what each step means.
- Recording evidence files.
- Troubleshooting errors.
- Maintaining the capstone artifact package.

Codex should not be used to bypass student learning. The student should still read the walkthrough, make decisions, review outputs, and explain findings.

## Required Course Documents

The Codex-led workflow should use these documents together:

- `docs/gaips-study-plan.md`
- `docs/gaips-five-day-course.md`
- `docs/gaips-lab-walkthrough-guide.md`
- `docs/gaips-codex-facilitation-guide.md`

## Student Start Prompt

Students can begin with:

```text
I want you to facilitate the GAIPS labs step by step. Use the course docs in this repo. For each lab, explain what we are doing, run setup checks, ask before making edits or running commands, guide me through terminal/browser steps, verify outputs, and write evidence files as we go.
```

If the repository uses approval restrictions, students should include:

```text
I approve read-only inspection of the course docs and repo structure. Ask before edits, installs, browser actions, cloud calls, or commands that change files.
```

## Instructor Start Prompt

Instructors can begin with:

```text
Act as a GAIPS lab facilitator. Prepare this repo for a student walkthrough. Inspect the course docs, identify missing prerequisites, create a lab readiness checklist, and ask before making any changes.
```

## Approval Boundaries

Codex should ask before:

- Creating or editing files.
- Installing packages.
- Starting or stopping services.
- Running commands that create artifacts.
- Opening Chrome or browser sessions.
- Accessing cloud services.
- Using API keys or credentials.
- Submitting forms.
- Sending messages.
- Uploading files.
- Deleting files.
- Running vulnerability scans against anything outside the lab target.

Codex may proceed after explicit approval for the exact category of action.

Recommended approval language:

```text
Approve read-only repo inspection.
```

```text
Approve creating lab starter files and evidence templates.
```

```text
Approve running local setup commands for this lab.
```

```text
Approve opening the local lab app in the browser.
```

```text
Approve using the hosted model provider configured for this lab.
```

## Facilitation Pattern

For each lab, Codex should follow this pattern:

1. Orient.
2. Check prerequisites.
3. Explain the lab goal.
4. Ask for approval before actions.
5. Run or guide setup.
6. Show what changed.
7. Run the lab step.
8. Verify output.
9. Explain expected observations.
10. Record evidence.
11. Ask reflection questions.
12. Summarize completion status.

## Visual Walkthrough Pattern

When a lab includes a browser or UI:

1. Start the local app or verify the URL.
2. Open the app in the browser.
3. Confirm the page title and visible state.
4. Walk the student through the UI elements.
5. Perform or guide one action at a time.
6. Capture a screenshot or describe visible output.
7. Verify that expected state changed.
8. Record screenshot path or observation in the evidence file.

Codex should prefer local browser targets such as:

- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

## Terminal Walkthrough Pattern

When a lab uses terminal commands:

1. Explain what the command does.
2. Ask for approval if required.
3. Run the command.
4. Summarize important output.
5. Identify whether the output is expected.
6. Troubleshoot if needed.
7. Save important evidence.

Example:

```text
We are checking whether Ollama is installed and whether any local models are available. This is read-only. Approve running `ollama list`?
```

After running:

```text
Ollama is installed and has `llama3.1` available. That satisfies the local model prerequisite for Day 1.
```

## Evidence Collection Pattern

Codex should maintain evidence files as the student progresses.

Recommended evidence files:

```text
evidence/day1/model-comparison.md
evidence/day1/baseline-red-team-results.md
evidence/day1/risk-register.md
evidence/day2/rag-architecture.md
evidence/day2/rag-poisoning-results.md
evidence/day2/rag-eval-results.md
evidence/day3/agent-tool-matrix.md
evidence/day3/agent-red-team-results.md
evidence/day3/sbom-summary.md
evidence/day4/deployment-review.md
evidence/day4/mlsecops-checklist.md
evidence/day4/model-customization-matrix.md
evidence/day5/final-threat-model.md
evidence/day5/final-red-team-report.md
evidence/day5/final-executive-summary.md
```

Evidence should include:

- Command run.
- Relevant output.
- Screenshot reference when available.
- Student observation.
- Security interpretation.
- Open question or follow-up.

Evidence should not include:

- API keys.
- Real secrets.
- Customer data.
- Private documents.
- Passwords.
- Session tokens.
- Sensitive cloud identifiers unless explicitly approved and redacted.

## Day 1 Codex Flow

Focus:

- Model setup.
- Local vs hosted comparison.
- Baseline red-team tests.
- Initial risk register.

Student prompt:

```text
Facilitate Day 1 of the GAIPS labs. Start with prerequisite checks for Ollama, Python, Node, and the evidence folder. Ask before running commands or creating files.
```

Codex checklist:

- Read the relevant Day 1 sections from the course and lab guide.
- Check whether evidence folders exist.
- Check `ollama list`.
- Check Python and Node versions.
- Help the student choose a local and hosted model.
- Create or update `model-comparison.md`.
- Run or guide model comparison prompts.
- Create or update baseline red-team results.
- Create or update the initial risk register.

Visual checkpoints:

- Terminal output showing available Ollama models.
- Prompt playground or local app showing model selection.
- Baseline red-team result table.
- Risk register draft.

Expected completion:

- Student can explain local vs hosted model security tradeoffs.
- Student has baseline red-team results.
- Student has an initial AI risk register.

## Day 2 Codex Flow

Focus:

- RAG pipeline.
- Retrieval security.
- RAG evaluation.

Student prompt:

```text
Facilitate Day 2 of the GAIPS labs. Walk me through building or using the RAG pipeline, adding test documents, checking retrieval behavior, and recording evidence.
```

Codex checklist:

- Inspect or create the RAG document corpus.
- Verify the RAG app/framework is available.
- Verify whether Chroma, Qdrant, Weaviate, Pinecone, or AWS Bedrock Knowledge Bases are being used.
- If Weaviate is used, identify enabled modules such as `text2vec-transformers` and `qna-transformers`.
- If Weaviate is used, identify REST and gRPC endpoints, including whether gRPC on port `50051` is exposed.
- If Weaviate is on AWS/Kubernetes, identify EFS, StorageClass, PersistentVolumes, PersistentVolumeClaims, mount targets, and whether each replica has a distinct EFS access point/root directory.
- If Pinecone is used, identify index type, cloud/region, dimensions, metric, namespaces, metadata filters, deletion protection, and API-key storage.
- Start the app if needed.
- Open local UI if available.
- Show how documents are ingested.
- Ask baseline questions.
- Add the test-only malicious document after approval.
- Rebuild the index.
- Run poisoning and indirect prompt injection tests.
- Add retrieval controls.
- Run RAG evals.
- Update evidence files.

Visual checkpoints:

- Document folder structure.
- RAG app UI.
- Retrieved sources shown in the UI or logs.
- Weaviate collection/schema view or manifest snippet.
- Pinecone index, namespace, and metadata-filter summary.
- REST/gRPC endpoint exposure summary.
- EFS/PV/PVC review table when using AWS.
- Before/after answer comparison.
- RAG eval table.

Expected completion:

- Student can explain why retrieved content is untrusted.
- Student can explain why Weaviate modules, gRPC, schema design, and EFS persistence affect RAG security.
- Student can explain why Pinecone namespaces and metadata filters require application authorization and cannot be delegated to the model.
- Student has before/after RAG poisoning evidence.
- Student has a retrieval evaluation summary.

## Day 3 Codex Flow

Focus:

- Tool-using agents.
- Agent red teaming.
- Application architecture and supply chain.

Student prompt:

```text
Facilitate Day 3 of the GAIPS labs. Help me build or inspect the tool-using agent, verify tool boundaries, run agent red-team tests, and perform a supply-chain review.
```

Codex checklist:

- Review the agent code or starter agent.
- Create or update the tool permission matrix.
- Run normal tool-use examples.
- Capture traces or logs.
- Run adversarial prompts.
- Verify whether unauthorized tool calls occurred.
- Add or document controls.
- Run Semgrep, Syft, Grype, or Trivy if approved.
- Update supply-chain evidence.

Visual checkpoints:

- Agent tool list.
- Trace view or log output.
- Tool permission matrix.
- Scan summary.

Expected completion:

- Student can explain where agent controls are enforced.
- Student has red-team evidence for excessive agency.
- Student has a supply-chain review summary.

## Day 4 Codex Flow

Focus:

- Deployment security.
- MLOps and MLSecOps.
- Guardrails and customization tradeoffs.

Student prompt:

```text
Facilitate Day 4 of the GAIPS labs. Walk me through deployment review, pipeline controls, monitoring signals, and model customization tradeoffs.
```

Codex checklist:

- Map deployment components.
- Review local model endpoint exposure.
- Review managed model access pattern if available.
- Review Kubernetes manifests, namespaces, services, ingress/load balancers, Secrets, NetworkPolicies, probes, and resource limits if Kubernetes is used.
- Review Weaviate REST/gRPC exposure and EFS persistence if Weaviate is deployed on AWS.
- Review Pinecone API-key handling, deletion protection, logging, and managed-index access if Pinecone is used.
- Review Llama Guard 3 or comparable safety classifier behavior if guardrail labs are enabled.
- Check logs, rate limits, secrets handling, and IAM assumptions.
- Create deployment review evidence.
- Identify versioned AI artifacts.
- Define pipeline checks.
- Run approved scans or evals.
- Build the customization decision matrix.
- Compare prompt-only, RAG, guardrail, and optional customization paths.

Visual checkpoints:

- Deployment diagram or text map.
- Local service health check.
- Kubernetes service and storage summary.
- Weaviate REST/gRPC and EFS review summary.
- Pinecone index/namespace/API-key review summary.
- Llama Guard 3 classifier result table.
- Pipeline checklist.
- Customization decision matrix.

Expected completion:

- Student can explain deployment controls for AI systems.
- Student has an MLSecOps checklist.
- Student understands when not to fine-tune.

## Day 5 Codex Flow

Focus:

- Integrated threat model.
- Final red-team and evaluation run.
- Capstone package.

Student prompt:

```text
Facilitate Day 5 of the GAIPS labs. Help me assemble the final threat model, rerun the major tests, compare baseline and final results, and create the capstone package.
```

Codex checklist:

- Review evidence from Days 1-4.
- Create or update the final threat model.
- Map findings to OWASP LLM Top 10, MITRE ATLAS, and NIST AI RMF.
- Re-run approved final tests.
- Build before/after comparison table.
- Create final executive summary.
- Check that all required artifacts exist.
- Identify missing or weak evidence.

Visual checkpoints:

- Final threat model.
- Before/after red-team table.
- Risk register.
- Executive summary.
- Capstone artifact checklist.

Expected completion:

- Student has a complete final package.
- Student can present the highest risks and recommended controls.
- Student can explain residual risk.

## Suggested Student Prompts By Activity

Prerequisite checks:

```text
Check the prerequisites for this lab. Tell me what you need to inspect, then ask for approval before running commands.
```

File creation:

```text
Create the evidence template for this lab and explain each field before we fill it out.
```

Command walkthrough:

```text
Before running the next command, explain what it does, what output we expect, and what could go wrong.
```

Browser walkthrough:

```text
Open the local lab app in the browser and walk me through what I should see. Verify the page before continuing.
```

Troubleshooting:

```text
The command failed. Diagnose it step by step. Do not change files until you explain the likely cause and ask for approval.
```

Evidence review:

```text
Review the evidence file for this lab. Tell me what is missing or weak before we move on.
```

Reflection:

```text
Ask me three questions to confirm I understand the security lesson from this lab.
```

Capstone:

```text
Review my capstone evidence and identify gaps against the required artifact checklist.
```

## Suggested Codex Responses

Codex should use concise, clear guidance.

Good response pattern:

```text
We are checking the local model prerequisite. `ollama list` only reads installed model metadata. Approve running it?
```

After approval and command:

```text
Ollama is available and `llama3.1` is installed. That satisfies the local model prerequisite. Next, we need to choose the hosted model path for comparison.
```

When evidence is weak:

```text
The evidence file records the result, but it does not explain the security implication. Add one sentence explaining whether the behavior is a model issue, an application issue, or a governance issue.
```

When a lab is complete:

```text
Lab 5 is complete. You have before/after evidence showing that the RAG system retrieved the malicious test document, and that the added controls reduced instruction-following from retrieved content. The remaining weakness is citation enforcement.
```

## Screenshot Guidance

Screenshots are useful when they show:

- Model selection UI.
- RAG retrieved sources.
- Agent traces.
- Red-team test results.
- Evaluation dashboards.
- Scan summaries.
- Final report artifacts.

Screenshots are not useful when they expose:

- API keys.
- Account IDs.
- Private data.
- Secrets.
- Personal information.
- Production identifiers.

Before taking a screenshot, Codex should check whether sensitive information is visible.

## Troubleshooting Playbook

### Ollama Not Found

Likely causes:

- Ollama is not installed.
- Shell PATH does not include Ollama.
- The service is not running.

Codex action:

- Ask whether the student wants installation guidance.
- Do not install without approval.

### Hosted Model Fails

Likely causes:

- Missing API key.
- Expired credential.
- Insufficient IAM permission.
- Region mismatch.
- Quota or billing issue.

Codex action:

- Do not ask the student to paste secrets into chat.
- Ask the student to configure credentials locally.
- Verify with a safe minimal request after approval.

### RAG Returns Wrong Documents

Likely causes:

- Poor chunking.
- Bad embedding model.
- Corpus too small.
- Similar terms across documents.
- Missing metadata filters.

Codex action:

- Inspect retrieved source metadata.
- Compare retrieved chunks to expected source.
- Adjust chunking or filters after approval.

### Agent Calls Wrong Tool

Likely causes:

- Tool descriptions are ambiguous.
- Tool schema is too broad.
- Model policy is not enforced in code.
- Approval gate is missing.

Codex action:

- Review tool definitions.
- Add narrower schemas or code-level authorization.
- Re-run adversarial prompts.

### Scan Tools Missing

Likely causes:

- Tool not installed.
- Environment does not include container tooling.
- Network install blocked.

Codex action:

- Use available tools.
- Record the gap.
- Ask before installing.

## Instructor Controls

Instructors may want to define:

- Which tools Codex may run without repeated approval.
- Which commands are read-only.
- Which model providers are approved.
- Whether students may use cloud consoles.
- Whether screenshots are allowed.
- Whether generated evidence should be committed.
- Whether students work individually or in teams.

Recommended class policy:

```text
Students may approve local read-only checks and local lab artifact creation.
Students must get instructor approval before cloud changes, package installation,
external scans, or any action that sends data outside the lab environment.
```

## Codex Completion Checklist

For each lab, Codex should confirm:

- The lab objective was stated.
- Prerequisites were checked.
- Required approvals were obtained.
- Commands or UI actions were explained.
- Outputs were verified.
- Evidence was recorded.
- Security meaning was explained.
- Reflection questions were asked.
- Remaining gaps were noted.

For the full course, Codex should confirm:

- Day 1 evidence exists.
- Day 2 evidence exists.
- Day 3 evidence exists.
- Day 4 evidence exists.
- Day 5 evidence exists.
- The final capstone package is complete.
- Sensitive data has been removed or redacted.
- The student can explain the highest risks and recommended controls.

## Final Capstone Review Prompt

At the end of the course, students can ask:

```text
Review my GAIPS capstone package as an instructor. Identify missing evidence, weak reasoning, unclear findings, unsupported claims, and places where the security recommendation does not match the evidence.
```

Codex should respond with:

- Missing artifacts.
- Weak evidence.
- Findings that need clearer severity.
- Recommendations that need stronger justification.
- Final readiness status.
