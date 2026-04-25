"""
TDD: assert all alembic-owned models are pinned to the 'agents' schema.
Run BEFORE patching models to confirm both tests fail, then again after.
"""
from app.db import Agent, BusinessAgent, AgentEvent
from app.memory.models import (
    MemoryConversationTurn,
    MemoryConversationSummary,
    MemoryKbChunk,
    MemoryProductEmbedding,
    MemoryPastAction,
)

ALEMBIC_MODELS = [
    Agent,
    BusinessAgent,
    AgentEvent,
    MemoryConversationTurn,
    MemoryConversationSummary,
    MemoryKbChunk,
    MemoryProductEmbedding,
    MemoryPastAction,
]


def test_all_alembic_models_use_agents_schema():
    for model in ALEMBIC_MODELS:
        assert model.__table__.schema == "agents", (
            f"{model.__name__}.__table__.schema is "
            f"{model.__table__.schema!r}, expected 'agents'"
        )


def test_business_agents_fk_targets_agents_schema():
    fks = list(BusinessAgent.__table__.c.agent_id.foreign_keys)
    assert len(fks) == 1, "Expected exactly one FK on BusinessAgent.agent_id"
    fk = fks[0]
    assert fk.target_fullname == "agents.agents.id", (
        f"FK target is {fk.target_fullname!r}, expected 'agents.agents.id'"
    )
