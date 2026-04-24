from app.db import AgentAction


def test_agent_action_has_iterations_column():
    cols = {c.name for c in AgentAction.__table__.columns}
    assert "iterations" in cols


def test_iterations_is_jsonb_nullable_false():
    col = AgentAction.__table__.c.iterations
    assert col.nullable is False
