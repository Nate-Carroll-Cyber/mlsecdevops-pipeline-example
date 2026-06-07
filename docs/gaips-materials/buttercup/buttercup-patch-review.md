# Buttercup Patch Review Fixture

| Finding | Proposed Patch | Instructor Expected Review | Merge Decision |
| --- | --- | --- | --- |
| BC-001 tool allowlist bypass | Add static allowlist validation before dispatch | Correct direction; require tests for unknown tool, case variation, and nested tool name | Do not auto-merge; approve after test evidence |
| BC-002 prompt logs may contain secrets | Add redaction before log write | Correct direction; verify redaction covers API keys, tokens, and passwords without destroying audit value | Approve after regression test |

Students must explain why automated patches are advisory and why the lab never runs Buttercup against production repositories.
