# AWS Bedrock Knowledge Bases Design Review Fixture

Use this fixture when students do not have approved AWS access.

| Design Area | Fixture Configuration | Security Review Question |
| --- | --- | --- |
| Data source | S3 prefix `s3://gaips-fixture-kb/public-policy/` | Are private or regulated documents excluded? |
| Embedding model | Titan Text Embeddings fixture | Is the model approved for the data classification? |
| Vector store | OpenSearch Serverless fixture collection | Are network and IAM policies least privilege? |
| Sync job | Manual sync after document review | Is poisoning review required before ingestion? |
| Retrieval filter | `trusted_policy=true` metadata | Can users bypass tenant or trust filters? |
| Logging | CloudTrail and Bedrock invocation logs enabled | Are prompts and retrieved chunks redacted where needed? |

Expected student conclusion: Bedrock Knowledge Bases is a managed RAG path, not a replacement for document trust review, metadata filters, citation enforcement, and output validation.
