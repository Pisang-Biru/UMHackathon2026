"""add iterations JSONB column to agent_action

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002"
down_revision = "0001"
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
              AND column_name = 'iterations'
          ) THEN
            ALTER TABLE public.agent_action
            ADD COLUMN iterations JSONB DEFAULT '[]'::jsonb NOT NULL;
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
              AND column_name = 'iterations'
          ) THEN
            ALTER TABLE public.agent_action DROP COLUMN iterations;
          END IF;
        END$$;
        """
    )
