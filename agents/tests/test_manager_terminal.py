# agents/tests/test_manager_terminal.py
import pytest
from unittest.mock import MagicMock
from langchain_core.messages import HumanMessage
from app.schemas.agent_io import StructuredReply, IterationEntry, ManagerVerdict, FactRef
from app.agents.manager_terminal import make_finalize_node, make_queue_for_human_node


class _FakeSession:
    def __init__(self):
        self.added = []
        self.committed = False
    def add(self, r): self.added.append(r)
    def commit(self): self.committed = True
    def __enter__(self): return self
    def __exit__(self, *a): return False


@pytest.fixture
def patch_session(monkeypatch):
    fake = _FakeSession()
    def _factory():
        return fake
    import app.agents.manager_terminal as mt
    monkeypatch.setattr(mt, "SessionLocal", _factory)
    return fake


@pytest.fixture
def patch_enqueue(monkeypatch):
    calls = []
    import app.agents.manager_terminal as mt
    def _fake(state, action_id, final_reply):
        calls.append((action_id, final_reply))
    monkeypatch.setattr(mt, "_enqueue_memory_write", _fake)
    return calls


def _base_state():
    v1 = IterationEntry(
        stage="jual_v1",
        draft=StructuredReply(reply="hello", confidence=0.72, reasoning="r"),
        verdict=ManagerVerdict(verdict="pass", reason="all good"),
    )
    return {
        "messages": [HumanMessage(content="hi")],
        "business_id": "biz1",
        "valid_fact_ids": set(),
        "jual_draft": v1.draft,
        "iterations": [v1],
        "final_reply": None,
    }


@pytest.mark.asyncio
async def test_finalize_writes_auto_sent_row(patch_session, patch_enqueue):
    finalize = make_finalize_node()
    out = await finalize(_base_state())
    assert patch_session.committed
    row = patch_session.added[0]
    assert row.status.value == "AUTO_SENT"
    assert row.finalReply == "hello"
    assert row.confidence == 0.72   # Jual v1 confidence, not rewrite's
    assert row.draftReply == "hello"
    assert isinstance(row.iterations, list)
    assert len(row.iterations) == 1
    assert row.iterations[0]["stage"] == "jual_v1"
    assert out["action_id"] == row.id
    assert len(patch_enqueue) == 1
    assert patch_enqueue[0][1] == "hello"


@pytest.mark.asyncio
async def test_queue_for_human_writes_pending_row_no_memory(patch_session, patch_enqueue):
    v1 = IterationEntry(
        stage="jual_v1",
        draft=StructuredReply(reply="unsure", needs_human=True, confidence=0.3),
        verdict=ManagerVerdict(verdict="escalate", reason="gate:jual_self_flagged"),
    )
    state = _base_state()
    state["iterations"] = [v1]
    state["jual_draft"] = v1.draft

    queue = make_queue_for_human_node()
    out = await queue(state)
    row = patch_session.added[0]
    assert row.status.value == "PENDING"
    assert row.finalReply is None
    assert row.confidence == 0.3
    assert "Refund" in row.reasoning or "sensitive" in row.reasoning
    assert out["best_draft"] == "unsure"
    # memory write NOT called on escalation
    assert len(patch_enqueue) == 0


@pytest.mark.asyncio
async def test_finalize_uses_manager_rewrite_reply_when_present(patch_session, patch_enqueue):
    v1 = IterationEntry(stage="jual_v1", draft=StructuredReply(reply="v1", confidence=0.6))
    rewrite = IterationEntry(
        stage="manager_rewrite",
        draft=StructuredReply(reply="rewritten", facts_used=[FactRef(kind="product", id="p1")]),
    )
    state = _base_state()
    state["iterations"] = [v1, rewrite]
    state["valid_fact_ids"] = {"product:p1"}
    state["final_reply"] = "rewritten"
    state["jual_draft"] = v1.draft

    finalize = make_finalize_node()
    await finalize(state)
    row = patch_session.added[0]
    assert row.finalReply == "rewritten"
    assert row.confidence == 0.6   # Jual v1 confidence preserved for telemetry
