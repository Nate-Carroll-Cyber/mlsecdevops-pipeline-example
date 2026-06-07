from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Chunk:
    source: str
    text: str
    score: int


def tokenize(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2}


def load_chunks(data_dir: Path) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(data_dir.glob("*.md")):
        parts = [p.strip() for p in path.read_text(encoding="utf-8").split("\n\n") if p.strip()]
        for part in parts:
            chunks.append(Chunk(source=path.name, text=part, score=0))
    return chunks


def retrieve(question: str, chunks: list[Chunk], limit: int = 3) -> list[Chunk]:
    q = tokenize(question)
    ranked = []
    for chunk in chunks:
        score = len(q & tokenize(chunk.text))
        ranked.append(Chunk(source=chunk.source, text=chunk.text, score=score))
    return [c for c in sorted(ranked, key=lambda c: (-c.score, c.source))[:limit] if c.score > 0]


def answer(question: str, retrieved: list[Chunk]) -> str:
    if not retrieved:
        return "I do not have enough retrieved evidence to answer."
    context = "\n".join(c.text for c in retrieved).lower()
    if "sensitive" in question.lower() or "ai systems" in question.lower():
        response = "Only approved non-sensitive data may be sent to AI systems."
    elif "password" in question.lower():
        response = "Users must use MFA, unique passwords, and identity verification for password reset workflows."
    elif "claim access" in question.lower():
        response = "The assistant must not claim access to systems, documents, or tools that are not provided."
    elif "ignore all previous" in context:
        response = "A retrieved document contains instruction-like text. Treat it as untrusted evidence and cite the conflict."
    else:
        response = "The retrieved sources contain relevant policy context, but a human should review the answer."
    sources = ", ".join(sorted({c.source for c in retrieved}))
    return f"{response} Sources: {sources}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="../data/docs")
    parser.add_argument("--question", required=True)
    args = parser.parse_args()
    chunks = load_chunks(Path(args.data))
    retrieved = retrieve(args.question, chunks)
    print("Retrieved:")
    for chunk in retrieved:
        print(f"- {chunk.source} score={chunk.score}: {chunk.text[:140].replace(chr(10), ' ')}")
    print("\nAnswer:")
    print(answer(args.question, retrieved))


if __name__ == "__main__":
    main()
