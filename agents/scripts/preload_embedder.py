"""Pre-download the bge-m3 model so first worker start is not slow."""
from sentence_transformers import SentenceTransformer

if __name__ == "__main__":
    model = SentenceTransformer("BAAI/bge-m3")
    print(f"Loaded bge-m3, dim={model.get_sentence_embedding_dimension()}")
