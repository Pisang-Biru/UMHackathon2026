from app.memory.chunker import chunk_text


def test_short_text_single_chunk():
    chunks = chunk_text("Short doc.", target_chars=500, overlap_chars=50)
    assert chunks == ["Short doc."]


def test_empty_input():
    assert chunk_text("", target_chars=500, overlap_chars=50) == []


def test_long_text_splits_with_overlap():
    text = "A" * 1000 + "B" * 1000
    chunks = chunk_text(text, target_chars=500, overlap_chars=50)
    assert len(chunks) >= 4
    assert all(len(c) <= 600 for c in chunks)
    # adjacent chunks overlap
    assert chunks[0][-50:] == chunks[1][:50]


def test_prefers_sentence_boundary():
    text = "Sentence one. Sentence two. " * 50
    chunks = chunk_text(text, target_chars=200, overlap_chars=20)
    # each non-final chunk should end on a period (allow trailing space)
    for c in chunks[:-1]:
        assert c.rstrip().endswith(".")
