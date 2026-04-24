def chunk_text(text: str, target_chars: int = 2000, overlap_chars: int = 200) -> list[str]:
    """Chunk text into ~target_chars pieces with overlap. Prefers sentence boundaries."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= target_chars:
        return [text]

    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + target_chars, n)
        # try to extend to next sentence boundary within 20% of target
        if end < n:
            window_end = min(end + int(target_chars * 0.2), n)
            dot = text.rfind(". ", end, window_end)
            if dot != -1:
                end = dot + 1
            else:
                back_start = max(start + int(target_chars * 0.8), start + 1)
                dot = text.rfind(". ", back_start, end)
                if dot != -1:
                    end = dot + 1
        chunks.append(text[start:end])
        if end >= n:
            break
        start = max(0, end - overlap_chars)
    return chunks
