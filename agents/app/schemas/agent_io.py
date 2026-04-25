from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field


class FactRef(BaseModel):
    """Identity key is (kind, id). Gate check uses f'{kind}:{id}' composite."""
    kind: Literal["product", "order", "kb", "memory", "memory:past_action", "payment_link"]
    id: str


class StructuredReply(BaseModel):
    reply: str
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    reasoning: str = ""
    addressed_questions: list[str] = Field(default_factory=list)
    unaddressed_questions: list[str] = Field(default_factory=list)
    facts_used: list[FactRef] = Field(default_factory=list)
    needs_human: bool = False


class ManagerCritique(BaseModel):
    missing_facts: list[str] = Field(default_factory=list)
    incorrect_claims: list[str] = Field(default_factory=list)
    tone_issues: list[str] = Field(default_factory=list)
    unanswered_questions: list[str] = Field(default_factory=list)
    keep_from_draft: list[str] = Field(default_factory=list)


class ManagerVerdict(BaseModel):
    verdict: Literal["pass", "revise", "rewrite", "escalate"]
    critique: ManagerCritique | None = None
    reason: str


class IterationEntry(BaseModel):
    stage: Literal["jual_v1", "jual_v2", "manager_rewrite"]
    draft: StructuredReply | None = None
    verdict: ManagerVerdict | None = None
    gate_results: dict = Field(default_factory=dict)
    latency_ms: int | None = None


# ---- Grounding receipts (tool-emitted, harvested into valid_fact_ids) ----

class ProductReceipt(BaseModel):
    kind: Literal["product"] = "product"
    id: str  # product_id


class OrderReceipt(BaseModel):
    kind: Literal["order"] = "order"
    id: str  # order_id, OR f"none:{phone_key}" for citable negative


class KbReceipt(BaseModel):
    kind: Literal["kb"] = "kb"
    id: str          # 8-char short id surfaced in formatter; what the LLM cites
    chunk_id: str    # full chunk pk; telemetry/debug only
    sim: float


class PastActionReceipt(BaseModel):
    kind: Literal["memory:past_action"] = "memory:past_action"
    id: str          # 8-char short id
    full_id: str
    sim: float


class PaymentLinkReceipt(BaseModel):
    kind: Literal["payment_link"] = "payment_link"
    id: str          # order_id


GroundingReceipt = Annotated[
    Union[ProductReceipt, OrderReceipt, KbReceipt, PastActionReceipt, PaymentLinkReceipt],
    Field(discriminator="kind"),
]
