from decimal import Decimal

import pytest

from app.db import AgentRun, AgentRunStatus
from app.agents._runs import record_run


def test_record_run_inserts_row(session):
    record_run(
        business_id="biz1",
        agent_type="finance",
        kind="margin_check",
        summary="checked margin for product A",
        status="OK",
        duration_ms=42,
        tokens=(10, 5, 0),
        cost_usd=Decimal("0.000123"),
        payload={"product_id": "p1"},
        ref=("product", "p1"),
    )
    rows = session.query(AgentRun).filter_by(businessId="biz1").all()
    assert len(rows) == 1
    r = rows[0]
    assert r.agentType == "finance"
    assert r.status == AgentRunStatus.OK
    assert r.durationMs == 42
    assert r.inputTokens == 10
    assert r.outputTokens == 5
    assert r.cachedTokens == 0
    assert r.costUsd == Decimal("0.000123")
    assert r.payload == {"product_id": "p1"}
    assert r.refTable == "product" and r.refId == "p1"


def test_record_run_swallows_db_error(monkeypatch):
    """If insert raises, helper logs + returns None — never propagates."""
    from app.agents import _runs as runs_mod

    class Boom(Exception):
        pass

    def bad_session(*_a, **_kw):
        raise Boom("db down")

    monkeypatch.setattr(runs_mod, "SessionLocal", bad_session)
    record_run(business_id="biz1", agent_type="x", kind="x", summary="x")  # no raise


def test_backfill_is_idempotent(session):
    from app.db import AgentAction, AgentActionStatus, AgentRun
    from cuid2 import Cuid as _Cuid
    _cuid = _Cuid().generate

    # Insert one AgentAction representing legacy data (default agentType="support")
    action_id = _cuid()
    a = AgentAction(
        id=action_id,
        businessId="biz1",
        customerMsg="hi",
        draftReply="hello",
        confidence=0.9,
        reasoning="test",
        status=AgentActionStatus.AUTO_SENT,
    )
    session.add(a)
    session.commit()

    from scripts.backfill_agent_runs import backfill

    inserted_first = backfill()
    inserted_second = backfill()

    rows = session.query(AgentRun).filter_by(refTable="agent_action", refId=action_id).all()

    assert inserted_first >= 1
    assert inserted_second == 0
    assert len(rows) == 1
