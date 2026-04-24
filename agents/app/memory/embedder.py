import os
import threading
from sentence_transformers import SentenceTransformer


_model = None
_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                name = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
                _model = SentenceTransformer(name)
    return _model


def embed(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    model = _get_model()
    arr = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return arr.tolist()
