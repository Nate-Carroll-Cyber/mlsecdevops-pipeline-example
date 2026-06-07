# Hugging Face Hub Security Review Fixture

Use this fixture when a lab-safe Hugging Face organization or private repository is unavailable.

Review:

- Private repository setting.
- 2FA and fine-grained token requirement.
- SSO or Resource Group boundary where available.
- SSH/GPG signed commit evidence where available.
- Malware, pickle/import, secrets, Protect AI Guardian, and JFrog scan results in `hf-security-scan-fixture.json`.

Expected conclusion: a passed scanner result does not prove a model is safe to load. Students must still review provenance, artifact format, license, model card, and deployment sandboxing.
