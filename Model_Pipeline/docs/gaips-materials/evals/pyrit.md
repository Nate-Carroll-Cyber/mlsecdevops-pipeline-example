# PyRIT Lab

PyRIT target setup is environment-specific. Live CI must provide an approved target command through `PYRIT_RUN_COMMAND`:

```bash
python -m pip install pyrit
test -n "$PYRIT_RUN_COMMAND"
sh -c "$PYRIT_RUN_COMMAND"
```

The command must write `reports/pyrit-results.json` and must target only a lab-safe local service, fixture gateway, or instructor-approved endpoint.

Fixture mode is allowed only when live execution is not approved or no lab-safe PyRIT target has been configured:

```bash
GAIPS_USE_FIXTURES=true cp "$GAIPS_MATERIALS_DIR/fixtures/pyrit-results.json" reports/pyrit-results.json
```

Student task: classify each conversation as blocked, allowed, or needs human review, then decide which cases should be added to Promptfoo or Inspect AI regression tests. Do not describe copied fixture JSON as a live PyRIT campaign.
