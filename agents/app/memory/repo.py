from datetime import datetime, timezone
from cuid2 import Cuid as _Cuid

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.memory import models

_cuid = _Cuid()


def _id() -> str:
    return _cuid.generate()


def insert_turn(session: Session, business_id: str, customer_phone: str,
                buyer_msg: str, agent_reply: str, embedding: list[float]) -> str:
    row = models.MemoryConversationTurn(
        id=_id(),
        businessId=business_id,
        customerPhone=customer_phone,
        buyerMsg=buyer_msg,
        agentReply=agent_reply,
        turnAt=datetime.now(timezone.utc),
        embedding=embedding,
        summarized=False,
    )
    session.add(row)
    return row.id


def insert_summary(session: Session, business_id: str, customer_phone: str,
                    summary: str, covers_from: datetime, covers_to: datetime,
                    embedding: list[float]) -> str:
    row = models.MemoryConversationSummary(
        id=_id(),
        businessId=business_id,
        customerPhone=customer_phone,
        summary=summary,
        coversFromTurnAt=covers_from,
        coversToTurnAt=covers_to,
        embedding=embedding,
        createdAt=datetime.now(timezone.utc),
    )
    session.add(row)
    return row.id


def insert_kb_chunk(session: Session, business_id: str, source_id: str,
                    chunk_index: int, content: str, embedding: list[float]) -> str:
    row = models.MemoryKbChunk(
        id=_id(),
        businessId=business_id,
        sourceId=source_id,
        chunkIndex=chunk_index,
        content=content,
        embedding=embedding,
        createdAt=datetime.now(timezone.utc),
    )
    session.add(row)
    return row.id


def upsert_product_embedding(session: Session, product_id: str, business_id: str,
                              content: str, embedding: list[float]) -> None:
    stmt = pg_insert(models.MemoryProductEmbedding).values(
        productId=product_id,
        businessId=business_id,
        content=content,
        embedding=embedding,
        updatedAt=datetime.now(timezone.utc),
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["productId"],
        set_={
            "content": stmt.excluded.content,
            "embedding": stmt.excluded.embedding,
            "businessId": stmt.excluded.businessId,
            "updatedAt": stmt.excluded.updatedAt,
        },
    )
    session.execute(stmt)


def upsert_past_action(session: Session, action_id: str, business_id: str,
                        customer_msg: str, final_reply: str, embedding: list[float]) -> None:
    stmt = pg_insert(models.MemoryPastAction).values(
        id=action_id,
        businessId=business_id,
        customerMsg=customer_msg,
        finalReply=final_reply,
        embedding=embedding,
        createdAt=datetime.now(timezone.utc),
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "customerMsg": stmt.excluded.customerMsg,
            "finalReply": stmt.excluded.finalReply,
            "embedding": stmt.excluded.embedding,
        },
    )
    session.execute(stmt)


def recent_turns(session: Session, business_id: str, customer_phone: str,
                  limit: int = 20) -> list[models.MemoryConversationTurn]:
    q = (
        select(models.MemoryConversationTurn)
        .where(models.MemoryConversationTurn.businessId == business_id)
        .where(models.MemoryConversationTurn.customerPhone == customer_phone)
        .order_by(models.MemoryConversationTurn.turnAt.desc())
        .limit(limit)
    )
    return list(session.execute(q).scalars())
