"""isolate alembic-owned tables under the `agents` schema

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-25

Moves every alembic-owned table from public.* to agents.*. Idempotent:
each ALTER TABLE checks information_schema first, so re-running on a DB
that's already been migrated is a no-op.

Data preservation: ALTER TABLE ... SET SCHEMA preserves rows, indexes,
constraints, sequences, and FKs.
"""
from alembic import op


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


_TABLES = [
    "memory_conversation_summary",
    "memory_conversation_turn",
    "memory_kb_chunk",
    "memory_past_action",
    "memory_product_embedding",
    "agent_events",
    "agents",
    "business_agents",
    "alembic_version",
]


def upgrade():
    op.execute("CREATE SCHEMA IF NOT EXISTS agents")
    for t in _TABLES:
        op.execute(f"""
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = '{t}'
              ) THEN
                EXECUTE 'ALTER TABLE public."{t}" SET SCHEMA agents';
              END IF;
            END$$;
        """)


def downgrade():
    for t in reversed(_TABLES):
        op.execute(f"""
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'agents' AND table_name = '{t}'
              ) THEN
                EXECUTE 'ALTER TABLE agents."{t}" SET SCHEMA public';
              END IF;
            END$$;
        """)
    op.execute("DROP SCHEMA IF EXISTS agents")
