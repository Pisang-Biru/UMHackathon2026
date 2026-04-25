"""add instagram session persistence table

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-26
"""
from alembic import op


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS agents.instagram_auth_sessions (
          id BIGSERIAL PRIMARY KEY,
          business_id TEXT NOT NULL UNIQUE,
          instagram_username TEXT NOT NULL,
          session_settings JSONB NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_instagram_auth_sessions_business
        ON agents.instagram_auth_sessions (business_id);
        """
    )


def downgrade():
    op.execute("DROP TABLE IF EXISTS agents.instagram_auth_sessions")
