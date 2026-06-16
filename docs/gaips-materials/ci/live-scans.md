# Live-Scan Pipeline — endpoint-dependent AI evaluations

The endpoint-dependent **live evals** were split out of the main GAIPS pipeline
([`README.md`](../README.md) / root `.gitlab-ci.yml`) into a standalone config:
[`ci/live-scans.gitlab-ci.yml`](live-scans.gitlab-ci.yml).

The main pipeline is **static** supply-chain + model-integrity + data-drift evidence —
it performs **no inference** and needs no model endpoint. These six jobs probe a **live
model endpoint**, so they live here, intended to run as the root `.gitlab-ci.yml` of a
**separate** GitLab project that actually has a model endpoint. Nothing in the main
pipeline runs them, and removing them is why the main run no longer pulls live-eval
tooling or requires `MODEL_ENDPOINT`.

> The model-drift chain (`model-drift-detection` → `model-baseline-commit` →
> `drift-gate`) and the MarkLLM jobs stayed in the **main** pipeline — see
> [`README.md`](../README.md). Drift detection in the main pipeline has no live-eval
> inputs there and seeds/skips; meaningful behaviour drift is computed from the eval
> metrics this pipeline produces.

## How to run it

1. Create a separate GitLab project that can reach a model endpoint.
2. Use `ci/live-scans.gitlab-ci.yml` as that project's root `.gitlab-ci.yml`.
3. Copy/submodule the materials these jobs call (see **Required files** below) so the
   referenced scripts and config resolve under `GAIPS_MATERIALS_DIR`.
4. Set the inputs (see **Required inputs**) in **Settings → CI/CD → Variables**.

Each job **skips cleanly** (writes a "skipped" report and exits 0) when
`MODEL_ENDPOINT` is unset, so a misconfigured run is safe.

## Stages

`ai-eval` (the five evals) and `guardrail` (`guardrail-regression`, which `needs:`
`promptfoo-eval` + `pyrit-scan`). Every job is `allow_failure: true` — this pipeline
gathers evidence, it does not enforce gates.

## Jobs

| Job | What it does |
| --- | --- |
| `promptfoo-eval` | Runs adversarial prompt evaluations defined in `evals/promptfoo.yaml` only when `MODEL_ENDPOINT` is configured; otherwise it writes a skipped `promptfoo-results.json` artifact. Advisory failures still upload `promptfoo-results.json`; if Promptfoo exits before writing a report, the job writes a minimal failure JSON for downstream evidence. Image: `node:20-slim`. |
| `garak-scan` | Probes the live model endpoint (from `MODEL_ENDPOINT`) with all Garak probe modules to test for jailbreaks, extraction, and unsafe outputs. Advisory (`allow_failure: true`); findings never fail the pipeline. Writes a skipped `garak-results.json` and exits 0 when `MODEL_ENDPOINT` is unset (no default), so an unconfigured run does nothing. |
| `giskard-scan` | Runs a real Giskard LLM scan, but against a **local deterministic stub** (a hardcoded `prediction_function`, not a live model — `MODEL_ENDPOINT` is not consulted). It exercises the Giskard tooling and produces an HTML/JSON report; it does not assess your actual model. Advisory (`allow_failure: true`). |
| `inspect-ai-eval` | Runs structured capability and safety evaluations using `inspect-ai` only when `MODEL_ENDPOINT` is configured (else writes a skipped artifact and exits 0). Uses project task files if present; otherwise runs MMLU (knowledge), TruthfulQA (honesty), WMDP bio/chem/cyber (hazard refusal), and GDM in-house CTF (agent safety). Advisory (`allow_failure: true`): it computes a pass/fail and even calls `sys.exit(1)` below `INSPECT_PASS_THRESHOLD`, but `allow_failure` means that never blocks the pipeline. |
| `pyrit-scan` | Advisory (`allow_failure: true`). Does **not** run PyRIT itself: it runs the shell command in `PYRIT_RUN_COMMAND` if that is set (failing on non-zero), else copies the static `fixtures/pyrit-results.json` if `GAIPS_USE_FIXTURES=true`, else writes a `not-configured`/`skipped` stub. Out of the box (neither variable set) it produces only the skipped stub — wire `PYRIT_RUN_COMMAND` to a real PyRIT invocation to actually probe a model. Command is parsed with `shlex.split` (no shell), so use `bash -c "…"` for shell pipelines. |
| `guardrail-regression` | Waits for `promptfoo-eval` and `pyrit-scan`. Compares current results against `guardrails/baseline.json` to detect regressions — catches cases where a previously-blocked attack now succeeds. |

## Required inputs (CI/CD variables in the separate project)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MODEL_ENDPOINT` | for real scans | _(unset)_ | OpenAI-compatible base URL of the target model. Drives `garak-scan`, `inspect-ai-eval`, `promptfoo-eval`. Unset → jobs skip cleanly. |
| `REST_API_KEY` | optional | _(unset)_ | Bearer token added to garak's REST calls when present. |
| `GARAK_REST_MODEL` | optional | `gaips` | `model` field sent in garak's REST request body. |
| `INSPECT_PASS_THRESHOLD` | optional | `0.60` | Accuracy floor below which an Inspect AI eval counts as a fail. |
| `PROMPTFOO_VERSION` | optional | `0.121.15` | `npm install -g promptfoo@…`. |
| `PYRIT_RUN_COMMAND` | optional | _(unset)_ | Approved target command for `pyrit-scan` (parsed without a shell). |

## Required files (copy alongside the YAML)

These jobs call materials that must exist under `GAIPS_MATERIALS_DIR` in the project:

- `scripts/pyrit_scan.py`, `scripts/collect_garak_report.py`,
  `scripts/collect_inspect_report.py`, `scripts/run_giskard_live.py`,
  `scripts/run_guardrail_regression.py`
- `evals/promptfoo.yaml` (+ any `tasks/*.py` for inspect-ai)
- `guardrails/baseline.json` (for `guardrail-regression`)

## Per-tool lab notes

[`evals/garak.md`](../evals/garak.md), [`evals/giskard.md`](../evals/giskard.md),
[`evals/pyrit.md`](../evals/pyrit.md), and
[`guardrails/guardrail-regression.md`](../guardrails/guardrail-regression.md) cover each
tool's lab exercise in detail.
