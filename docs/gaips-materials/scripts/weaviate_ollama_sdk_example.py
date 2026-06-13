from __future__ import annotations

import argparse

import weaviate
from weaviate.classes.config import Configure, DataType, Property


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Weaviate collection using an Ollama-hosted embedding model.")
    parser.add_argument("--ollama-endpoint", default="http://ollama:11434")
    parser.add_argument("--embedding-model", default="nomic-embed-text")
    parser.add_argument("--collection", default="DocumentChunk")
    args = parser.parse_args()

    client = weaviate.connect_to_local()
    try:
        if client.collections.exists(args.collection):
            print(f"collection exists: {args.collection}")
            return

        client.collections.create(
            name=args.collection,
            vector_config=Configure.Vectors.text2vec_ollama(
                api_endpoint=args.ollama_endpoint,
                model=args.embedding_model,
            ),
            properties=[
                Property(name="text", data_type=DataType.TEXT),
                Property(name="source", data_type=DataType.TEXT),
                Property(name="tenant_id", data_type=DataType.TEXT),
                Property(name="sensitivity", data_type=DataType.TEXT),
                Property(name="trusted_policy", data_type=DataType.BOOL),
            ],
        )
        print(
            {
                "collection": args.collection,
                "vectorizer": "text2vec_ollama",
                "ollama_endpoint": args.ollama_endpoint,
                "embedding_model": args.embedding_model,
            }
        )
    finally:
        client.close()


if __name__ == "__main__":
    main()
