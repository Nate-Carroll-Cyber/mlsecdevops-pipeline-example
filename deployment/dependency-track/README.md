# Wiring Dependency-Track — Fix #34 runbook

The `dependency-track-upload` job ([`.gitlab-ci.yml`](../../../../.gitlab-ci.yml)) and
[`scripts/dependency_track_upload.py`](../../scripts/dependency_track_upload.py) are
**already complete** — they upload the SBOM + nested AI-BOM, poll for processing, pull
findings + policy violations, and **fail the gate on a blocking `violationState`**. They
**skip cleanly (`exit 0`) until `DT_API_URL` / `DT_API_KEY` are set**, so the pipeline
runs green today with DT inert. This is the last-mile infra to turn the gate on.

> **Pairing:** #34 is what gives **#29** (the AI-BOM `vulnerabilities[]`) teeth — DT
> ingests that structured vuln list and re-evaluates it against new CVEs + policy over
> time. DT also does its own CVE matching on the software purls, so it adds value even
> before #29. Land #29 first; #34 enforces it.

## Steps

1. **Stand up DT** (this dir):
   ```bash
   docker compose -f deployment/dependency-track/docker-compose.yml up -d
   ```
   Frontend → `http://localhost:8082`, API → `http://localhost:8081`. First boot takes a
   few minutes to build the vulnerability mirror. (Pin the image tags in the compose to
   the release you validate against.)

2. **Create a team + API key** (Administration → Access Management → Teams). Grant the key
   exactly these permissions — the script needs all four:
   - `BOM_UPLOAD` — POST the BOM
   - `PROJECT_CREATION_UPLOAD` — `autoCreate=true` makes the project + nested AI-BOM child
   - `VIEW_VULNERABILITY` — pull findings (`/api/v1/finding/project/{uuid}`)
   - `VIEW_POLICY_VIOLATION` — pull violations the gate reads (`/api/v1/violation/...`)

3. **Set the CI/CD variables** (project Settings → CI/CD → Variables, or via Vault paths
   `dt-api-url` / `dt-api-key` per [`ci/CI-VARIABLES.md`](../../ci/CI-VARIABLES.md) §4):
   | Variable | Masked | Value |
   | --- | --- | --- |
   | `DT_API_URL` | No | `http://<dt-host>:8081` (no trailing `/api`) |
   | `DT_API_KEY` | **Yes** | the key from step 2 |
   | `DT_FAIL_ON` | No | `FAIL` (default) — `violationState`(s) that block the gate |

4. **Define the gating policy** (Policy Management). The gate fails on any non-suppressed
   violation whose policy `violationState` is in `DT_FAIL_ON`. This is what enforces the
   AI-BOM's **model/data** components too — they get no CVE match, but policy conditions
   (severity threshold, license, outdated component, …) DO apply. Start with one severity
   policy (`Severity is at least High` → `violationState: FAIL`) and tighten from there.

5. **Validate end-to-end** — trigger one pipeline run (the same billable re-run already
   pending for the deferred legs). Confirm in order:
   - the job logs `uploaded …; token=…` for both the SBOM and the `-aibom` child;
   - the DT project hierarchy shows the app project with the AI-BOM nested under it;
   - `reports/dependency-track.json` carries `findings_total` / `violations_total` / a
     `dashboard_url`;
   - induce one violation (e.g. set the policy threshold low) and confirm the job **fails**
     — proving the gate has teeth — then restore the intended threshold.

## Notes
- `allow_failure: false` is already set on the job (hard gate) — but it short-circuits to
  `exit 0` whenever DT is unconfigured or no BOM was produced, so it never blocks a run
  that legitimately has nothing to upload.
- VEX-suppressed violations never gate (the script filters `suppressed=false`), so triage
  in DT (suppress with justification) flows back into the pipeline result automatically.
