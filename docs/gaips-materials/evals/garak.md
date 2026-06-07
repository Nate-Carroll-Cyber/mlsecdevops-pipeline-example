# garak Lab

Live command when approved:

```bash
garak --model_type test.Blank --probes promptinject.HijackHateHumans --report_prefix reports/garak
```

Fixture mode:

```bash
cp docs/gaips-materials/fixtures/garak-results.json reports/garak-results.json
```

Student task: identify which probes represent direct prompt injection, which are irrelevant to the app, and which should become regression tests.
