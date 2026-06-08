# Starter RAG App

This is the minimum capstone RAG app referenced by the GAIPS labs. It is deliberately small and suitable for live local CI smoke tests without hosted model credentials.

## Run In Fixture Mode

```bash
cd docs/gaips-materials/starter-rag-app
python3 app.py --data ../data/docs --question "What data is allowed to be sent to AI systems?"
```

Expected behavior:

- Reads Markdown files from `../data/docs`.
- Splits documents into paragraph chunks.
- Retrieves chunks with deterministic keyword scoring.
- Uses the fixture model gateway response shape.
- Returns cited sources.

## Live Extension Points

In a live class, students can replace deterministic retrieval with Chroma/Qdrant and replace the fixture answer with Ollama, LiteLLM, or an approved hosted provider. The security control remains the same: retrieved text is untrusted evidence, not instructions.
