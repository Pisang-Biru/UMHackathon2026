"""agent events, registry, business enablement
Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agents",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("icon", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "business_agents",
        sa.Column("business_id", sa.Text(), nullable=False),
        sa.Column("agent_id", sa.Text(), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("business_id", "agent_id"),
    )

    op.create_table(
        "agent_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("ts", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("business_id", sa.Text(), nullable=True),
        sa.Column("conversation_id", sa.Text(), nullable=True),
        sa.Column("task_id", sa.Text(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("node", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("reasoning", sa.Text(), nullable=True),
        sa.Column("trace", postgresql.JSONB(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
    )
    op.create_index("ix_events_agent_ts", "agent_events", ["agent_id", sa.text("ts DESC")])
    op.create_index("ix_events_biz_ts", "agent_events", ["business_id", sa.text("ts DESC")])
    op.create_index("ix_events_conversation", "agent_events", ["conversation_id", "ts"])


def downgrade():
    op.drop_index("ix_events_conversation", table_name="agent_events")
    op.drop_index("ix_events_biz_ts", table_name="agent_events")
    op.drop_index("ix_events_agent_ts", table_name="agent_events")
    op.drop_table("agent_events")
    op.drop_table("business_agents")
    op.drop_table("agents")
