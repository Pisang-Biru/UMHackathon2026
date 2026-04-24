"""create memory tables

Revision ID: 0001
Revises:
Create Date: 2026-04-24
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


EMBED_DIM = 1024


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "memory_conversation_turn",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("businessId", sa.String, nullable=False, index=True),
        sa.Column("customerPhone", sa.String, nullable=False, index=True),
        sa.Column("buyerMsg", sa.Text, nullable=False),
        sa.Column("agentReply", sa.Text, nullable=False),
        sa.Column("turnAt", sa.DateTime, nullable=False, index=True),
        sa.Column("embedding", Vector(EMBED_DIM), nullable=False),
        sa.Column("summarized", sa.Boolean, nullable=False, server_default=sa.text("false")),
    )
    op.create_index(
        "ix_memory_conversation_turn_biz_phone_turnat",
        "memory_conversation_turn",
        ["businessId", "customerPhone", sa.text("\"turnAt\" DESC")],
    )
    op.execute(
        "CREATE INDEX memory_conversation_turn_embedding_hnsw "
        "ON memory_conversation_turn USING hnsw (embedding vector_cosine_ops)"
    )

    op.create_table(
        "memory_conversation_summary",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("businessId", sa.String, nullable=False, index=True),
        sa.Column("customerPhone", sa.String, nullable=False, index=True),
        sa.Column("summary", sa.Text, nullable=False),
        sa.Column("coversFromTurnAt", sa.DateTime, nullable=False),
        sa.Column("coversToTurnAt", sa.DateTime, nullable=False),
        sa.Column("embedding", Vector(EMBED_DIM), nullable=False),
        sa.Column("createdAt", sa.DateTime, nullable=False),
    )
    op.execute(
        "CREATE INDEX memory_conversation_summary_embedding_hnsw "
        "ON memory_conversation_summary USING hnsw (embedding vector_cosine_ops)"
    )

    op.create_table(
        "memory_kb_chunk",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("businessId", sa.String, nullable=False, index=True),
        sa.Column("sourceId", sa.String, nullable=False, index=True),
        sa.Column("chunkIndex", sa.Integer, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("embedding", Vector(EMBED_DIM), nullable=False),
        sa.Column("createdAt", sa.DateTime, nullable=False),
    )
    op.execute(
        "CREATE INDEX memory_kb_chunk_embedding_hnsw "
        "ON memory_kb_chunk USING hnsw (embedding vector_cosine_ops)"
    )

    op.create_table(
        "memory_product_embedding",
        sa.Column("productId", sa.String, primary_key=True),
        sa.Column("businessId", sa.String, nullable=False, index=True),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("embedding", Vector(EMBED_DIM), nullable=False),
        sa.Column("updatedAt", sa.DateTime, nullable=False),
    )
    op.execute(
        "CREATE INDEX memory_product_embedding_embedding_hnsw "
        "ON memory_product_embedding USING hnsw (embedding vector_cosine_ops)"
    )

    op.create_table(
        "memory_past_action",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("businessId", sa.String, nullable=False, index=True),
        sa.Column("customerMsg", sa.Text, nullable=False),
        sa.Column("finalReply", sa.Text, nullable=False),
        sa.Column("embedding", Vector(EMBED_DIM), nullable=False),
        sa.Column("createdAt", sa.DateTime, nullable=False),
    )
    op.execute(
        "CREATE INDEX memory_past_action_embedding_hnsw "
        "ON memory_past_action USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade():
    op.drop_table("memory_past_action")
    op.drop_table("memory_product_embedding")
    op.drop_table("memory_kb_chunk")
    op.drop_table("memory_conversation_summary")
    op.drop_table("memory_conversation_turn")
