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
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'agent_action'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'agent_action'
              AND column_name = 'approvedAt'
          ) THEN
            ALTER TABLE public.agent_action
            ADD COLUMN "approvedAt" TIMESTAMPTZ NULL;
          END IF;
        END$$;
        """
    )

def downgrade():
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'agent_action'
              AND column_name = 'approvedAt'
          ) THEN
            ALTER TABLE public.agent_action DROP COLUMN "approvedAt";
          END IF;
        END$$;
        """
    )
