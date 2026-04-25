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


class AgentRunStatus(enum.Enum):
    OK = "OK"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class MarginStatus(enum.Enum):
    OK = "OK"
    LOSS = "LOSS"
    MISSING_DATA = "MISSING_DATA"


class FinanceAlertKind(enum.Enum):
    LOSS = "LOSS"
    MISSING_DATA = "MISSING_DATA"


class Business(Base):
    __tablename__ = "business"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    code = Column(String, unique=True, nullable=False)
    mission = Column(Text, nullable=True)
    userId = Column(String, nullable=False)
    platformFeePct = Column(Numeric(5, 4), nullable=False, server_default=text("0.05"))
    defaultTransportCost = Column(Numeric(10, 2), nullable=False, server_default=text("0"))
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Product(Base):
    __tablename__ = "product"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    stock = Column(Integer, nullable=False, default=0)
    description = Column(Text, nullable=True)
    businessId = Column(String, nullable=False)
    packagingCost = Column(Numeric(10, 2), nullable=True)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Goal(Base):
    __tablename__ = "goal"
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False)
    text = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="ACTIVE")
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    deletedAt = Column(DateTime, nullable=True)


class AgentRun(Base):
    __tablename__ = "agent_run"
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False)
    agentType = Column(String, nullable=False)
    kind = Column(String, nullable=False)
    summary = Column(Text, nullable=False)
    status = Column(SAEnum(AgentRunStatus, name="AgentRunStatus"), nullable=False, default=AgentRunStatus.OK)
    durationMs = Column(Integer, nullable=True)
    inputTokens = Column(Integer, nullable=True)
    outputTokens = Column(Integer, nullable=True)
    cachedTokens = Column(Integer, nullable=True)
    costUsd = Column(Numeric(10, 6), nullable=True)
    payload = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    refTable = Column(String, nullable=True)
    refId = Column(String, nullable=True)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


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
    groupId = Column(String, nullable=True)
    paidAt = Column(DateTime, nullable=True)
    acknowledgedAt = Column(DateTime, nullable=True)
    transportCost = Column(Numeric(10, 2), nullable=True)
    realMargin = Column(Numeric(10, 2), nullable=True)
    marginStatus = Column(SAEnum(MarginStatus, name="MarginStatus"), nullable=True)
    createdAt = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class FinanceAlert(Base):
    __tablename__ = "finance_alert"
    id = Column(String, primary_key=True)
    businessId = Column(String, ForeignKey("business.id", ondelete="CASCADE"), nullable=False)
    orderId = Column(String, ForeignKey("order.id", ondelete="CASCADE"), nullable=True)
    productId = Column(String, ForeignKey("product.id", ondelete="CASCADE"), nullable=True)
    kind = Column(SAEnum(FinanceAlertKind, name="FinanceAlertKind"), nullable=False)
    marginValue = Column(Numeric(10, 2), nullable=True)
    message = Column(Text, nullable=False)
    resolvedAt = Column(DateTime, nullable=True)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updatedAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = {"schema": "agents"}
    id = Column(Text, primary_key=True)
    name = Column(Text, nullable=False)
    role = Column(Text, nullable=False)
    icon = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)


class BusinessAgent(Base):
    __tablename__ = "business_agents"
    __table_args__ = {"schema": "agents"}
    business_id = Column(Text, primary_key=True)
    agent_id = Column(Text, ForeignKey("agents.agents.id"), primary_key=True)
    enabled = Column(Boolean, nullable=False, server_default=text("true"))


class AgentEvent(Base):
    __tablename__ = "agent_events"
    __table_args__ = {"schema": "agents"}
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
