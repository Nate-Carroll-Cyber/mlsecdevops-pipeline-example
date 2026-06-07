# Vault Fixture Secret Map

| Secret Path | Purpose | Lab Value | Expected Access |
| --- | --- | --- | --- |
| `secret/data/gaips/model-providers/fixture` | Fake model provider token | `fixture-token-not-real` | Read by app service account only |
| `secret/data/gaips/admin/break-glass` | Administrative placeholder | Not provided | Denied to app |

No real credentials are included in this fixture.
