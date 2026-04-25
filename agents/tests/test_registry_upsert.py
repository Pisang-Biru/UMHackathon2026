from app.agents.registry import discover_agent_meta, upsert_registry
from app.db import SessionLocal, Agent, BusinessAgent


def test_discover_includes_both_agents():
    metas = {m["id"]: m for m in discover_agent_meta()}
    assert "customer_support" in metas
    assert "manager" in metas
    assert metas["customer_support"]["name"] == "Sales Assistant"
    assert metas["manager"]["name"] == "Manager"


def test_upsert_idempotent():
    upsert_registry(business_ids=["dev-biz"])
    upsert_registry(business_ids=["dev-biz"])  # second call must not error

    with SessionLocal() as s:
        assert s.query(Agent).filter_by(id="manager").count() == 1
        assert s.query(Agent).filter_by(id="customer_support").count() == 1
        assert (
            s.query(BusinessAgent)
            .filter_by(business_id="dev-biz", agent_id="manager")
            .count()
            == 1
        )
        assert (
            s.query(BusinessAgent)
            .filter_by(business_id="dev-biz", agent_id="customer_support")
            .count()
            == 1
        )
