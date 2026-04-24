from typing import Literal
from pydantic import BaseModel, Field


class FactRef(BaseModel):
    """Identity key is (kind, id). Gate check uses f'{kind}:{id}' composite."""
    kind: Literal["product", "order", "kb", "memory"]
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
