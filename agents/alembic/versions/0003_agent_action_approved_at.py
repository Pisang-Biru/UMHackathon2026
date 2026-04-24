"""add approvedAt column to agent_action for undo anchor
Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column(
        "agent_action",
        sa.Column("approvedAt", sa.DateTime(timezone=True), nullable=True),
    )

def downgrade():
    op.drop_column("agent_action", "approvedAt")
