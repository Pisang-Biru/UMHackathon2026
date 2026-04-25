from sqlalchemy import Column, String, Integer, Boolean, Text, DateTime, Index
from pgvector.sqlalchemy import Vector
from datetime import datetime, timezone

from app.db import Base


EMBED_DIM = 1024


class MemoryConversationTurn(Base):
    __tablename__ = "memory_conversation_turn"
    __table_args__ = {"schema": "agents"}
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    customerPhone = Column(String, nullable=False, index=True)
    buyerMsg = Column(Text, nullable=False)
    agentReply = Column(Text, nullable=False)
    turnAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    summarized = Column(Boolean, nullable=False, default=False)


class MemoryConversationSummary(Base):
    __tablename__ = "memory_conversation_summary"
    __table_args__ = {"schema": "agents"}
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    customerPhone = Column(String, nullable=False, index=True)
    summary = Column(Text, nullable=False)
    coversFromTurnAt = Column(DateTime, nullable=False)
    coversToTurnAt = Column(DateTime, nullable=False)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class MemoryKbChunk(Base):
    __tablename__ = "memory_kb_chunk"
    __table_args__ = {"schema": "agents"}
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    sourceId = Column(String, nullable=False, index=True)
    chunkIndex = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class MemoryProductEmbedding(Base):
    __tablename__ = "memory_product_embedding"
    __table_args__ = {"schema": "agents"}
    productId = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    updatedAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class MemoryPastAction(Base):
    __tablename__ = "memory_past_action"
    __table_args__ = {"schema": "agents"}
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    customerMsg = Column(Text, nullable=False)
    finalReply = Column(Text, nullable=False)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


Index(
    "ix_memory_conversation_turn_biz_phone_turnat",
    MemoryConversationTurn.businessId,
    MemoryConversationTurn.customerPhone,
    MemoryConversationTurn.turnAt.desc(),
)
