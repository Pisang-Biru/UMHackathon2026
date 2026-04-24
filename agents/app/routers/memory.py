import os
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.memory.chunker import chunk_text

_log = logging.getLogger(__name__)
router = APIRouter(prefix="/memory", tags=["memory"])


def _memory_enabled() -> bool:
    return os.environ.get("MEMORY_ENABLED", "true").lower() == "true"


def _enqueue_product(product_id: str) -> None:
    if not _memory_enabled():
        return
    try:
        from app.worker.tasks import embed_product
        embed_product.delay(product_id)
    except Exception as e:
        _log.warning("enqueue product failed: %s", e)


def _enqueue_kb_chunk(*, business_id: str, source_id: str, chunk_index: int, content: str) -> None:
    if not _memory_enabled():
        return
    try:
        from app.worker.tasks import embed_kb_chunk
        embed_kb_chunk.delay(
            business_id=business_id,
            source_id=source_id,
            chunk_index=chunk_index,
            content=content,
        )
    except Exception as e:
        _log.warning("enqueue kb chunk failed: %s", e)


class KbIngest(BaseModel):
    business_id: str
    source_id: str
    text: str


@router.post("/product/{product_id}/reindex", status_code=202)
def reindex_product(product_id: str):
    _enqueue_product(product_id)
    return {"status": "queued", "product_id": product_id}


@router.post("/kb", status_code=202)
def ingest_kb(body: KbIngest):
    if not body.text.strip():
        raise HTTPException(400, "text is empty")
    chunks = chunk_text(body.text, target_chars=2000, overlap_chars=200)
    for i, c in enumerate(chunks):
        _enqueue_kb_chunk(business_id=body.business_id, source_id=body.source_id,
                           chunk_index=i, content=c)
    return {"status": "queued", "chunks": len(chunks)}
