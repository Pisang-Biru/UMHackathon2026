import pytest
from app.memory import embedder


def test_embed_returns_correct_dim():
    vecs = embedder.embed(["hello world"])
    assert len(vecs) == 1
    assert len(vecs[0]) == 1024


def test_embed_is_deterministic():
    a = embedder.embed(["consistency test"])[0]
    b = embedder.embed(["consistency test"])[0]
    assert a == b


def test_embed_different_texts_differ():
    a = embedder.embed(["nasi lemak"])[0]
    b = embedder.embed(["quantum physics"])[0]
    sim = sum(x * y for x, y in zip(a, b))
    assert sim < 0.95


def test_embed_batch():
    vecs = embedder.embed(["a", "b", "c"])
    assert len(vecs) == 3
    assert all(len(v) == 1024 for v in vecs)
