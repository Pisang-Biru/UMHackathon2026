import os
from sqlalchemy import (
    create_engine, Column, String, Float, Integer, Text, DateTime,
    Enum as SAEnum, Numeric, text, BigInteger, Boolean, ForeignKey,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from datetime import datetime, timezone
import enum


engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class AgentActionStatus(enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    AUTO_SENT = "AUTO_SENT"


class Business(Base):
    __tablename__ = "business"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    code = Column(String, unique=True, nullable=False)
    mission = Column(Text, nullable=True)


class Product(Base):
    __tablename__ = "product"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    stock = Column(Integer, nullable=False, default=0)
    description = Column(Text, nullable=True)
    businessId = Column(String, nullable=False)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class AgentAction(Base):
    __tablename__ = "agent_action"
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False)
    customerMsg = Column(Text, nullable=False)
    draftReply = Column(Text, nullable=False)
    finalReply = Column(Text, nullable=True)
    confidence = Column(Float, nullable=False)
    reasoning = Column(Text, nullable=False)
    status = Column(SAEnum(AgentActionStatus, name="AgentActionStatus"), nullable=False, default=AgentActionStatus.PENDING)
    iterations = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    createdAt = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    approvedAt = Column(DateTime, nullable=True)


class OrderStatus(enum.Enum):
    PENDING_PAYMENT = "PENDING_PAYMENT"
    PAID = "PAID"
    CANCELLED = "CANCELLED"


class Order(Base):
    __tablename__ = "order"
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False)
    productId = Column(String, nullable=False)
    agentType = Column(String, nullable=True)
    qty = Column(Integer, nullable=False)
    unitPrice = Column(Numeric(10, 2), nullable=False)
    totalAmount = Column(Numeric(10, 2), nullable=False)
    status = Column(SAEnum(OrderStatus, name="OrderStatus"), nullable=False, default=OrderStatus.PENDING_PAYMENT)
    buyerName = Column(String, nullable=True)
    buyerContact = Column(String, nullable=True)
    paymentUrl = Column(String, nullable=True)
    paidAt = Column(DateTime, nullable=True)
    acknowledgedAt = Column(DateTime, nullable=True)
    createdAt = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Agent(Base):
    __tablename__ = "agents"
    id = Column(Text, primary_key=True)
    name = Column(Text, nullable=False)
    role = Column(Text, nullable=False)
    icon = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)


class BusinessAgent(Base):
    __tablename__ = "business_agents"
    business_id = Column(Text, primary_key=True)
    agent_id = Column(Text, ForeignKey("agents.id"), primary_key=True)
    enabled = Column(Boolean, nullable=False, server_default=text("true"))


class AgentEvent(Base):
    __tablename__ = "agent_events"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    ts = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    agent_id = Column(Text, nullable=False)
    business_id = Column(Text, nullable=True)
    conversation_id = Column(Text, nullable=True)
    task_id = Column(Text, nullable=True)
    kind = Column(Text, nullable=False)
    node = Column(Text, nullable=True)
    status = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    reasoning = Column(Text, nullable=True)
    trace = Column(JSONB, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    tokens_in = Column(Integer, nullable=True)
    tokens_out = Column(Integer, nullable=True)


# Register memory models with Base.metadata so Alembic sees them.
from app.memory import models as _memory_models  # noqa: F401,E402
