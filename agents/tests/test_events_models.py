from app.db import SessionLocal, Agent, BusinessAgent, AgentEvent


def test_can_insert_agent_and_event():
    with SessionLocal() as s:
        s.add(Agent(id="t_agent", name="Test", role="tester", icon=None))
        s.add(BusinessAgent(business_id="dev-biz", agent_id="t_agent", enabled=True))
        s.add(AgentEvent(
            agent_id="t_agent", business_id="dev-biz",
            conversation_id="c1", kind="node.start", node="nodeA",
            status="ok", summary="hello", duration_ms=12,
        ))
        s.commit()
        row = s.query(AgentEvent).filter_by(agent_id="t_agent").one()
        assert row.summary == "hello"
        assert row.ts is not None
        s.query(AgentEvent).filter_by(agent_id="t_agent").delete()
        s.query(BusinessAgent).filter_by(agent_id="t_agent").delete()
        s.query(Agent).filter_by(id="t_agent").delete()
        s.commit()
