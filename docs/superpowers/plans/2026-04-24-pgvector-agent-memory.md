# pgvector Agent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent semantic memory to the customer support agent (per-customer conversation history, business KB, product semantic search, past-action recall) using pgvector + bge-m3 + Celery/RabbitMQ.

**Architecture:** New `agents/app/memory/` module owns SQLAlchemy vector tables, embedder singleton, repo, chunker, formatter. New `agents/app/worker/` module owns Celery app + tasks. New LangGraph node `load_memory` pre-injects conversation context; new tool `search_memory` handles on-demand KB/product/past-action retrieval. Writes flow async via Celery tasks enqueued from terminal graph nodes. Schema is SQLAlchemy-owned via Alembic (Prisma unaware).

**Tech Stack:** Python 3.11, FastAPI, LangGraph, SQLAlchemy 2.0, `pgvector` (Postgres extension + Python lib), `sentence-transformers` (bge-m3, 1024 dim), Celery 5.4, RabbitMQ (AMQP broker), Alembic, `phonenumbers`.

**Spec:** `docs/superpowers/specs/2026-04-24-pgvector-agent-memory-design.md`

---

## File Structure

```
agents/
  requirements.txt                    MODIFY: add deps
  alembic.ini                         NEW
  alembic/
    env.py                            NEW
    script.py.mako                    NEW (alembic-generated)
    versions/
      0001_memory_tables.py           NEW
  app/
    db.py                             MODIFY: import memory models into Base metadata
    memory/
      __init__.py                     NEW
      models.py                       NEW: 5 vector tables
      embedder.py                     NEW: bge-m3 singleton
      repo.py                         NEW: insert + vector search helpers
      chunker.py                      NEW: text splitter
      formatter.py                    NEW: memory block + tool result formatters
    worker/
      __init__.py                     NEW
      celery_app.py                   NEW
      tasks.py                        NEW
    agents/
      customer_support.py             MODIFY: phone state, load_memory node, search_memory tool, enqueue writes
    routers/
      support.py                      MODIFY: accept customer_phone
      memory.py                       NEW: /memory/product/{id}/reindex, /memory/kb
    main.py                           MODIFY: mount memory router
  tests/
    __init__.py                       NEW
    conftest.py                       NEW
    test_embedder.py                  NEW
    test_chunker.py                   NEW
    test_formatter.py                 NEW
    test_repo.py                      NEW
    test_tasks.py                     NEW
    test_graph_memory.py              NEW
    test_router_memory.py             NEW
  scripts/
    preload_embedder.py               NEW
    smoke_memory.py                   NEW
  .env.example                        MODIFY: add memory env vars
  README.md                           MODIFY: add memory setup instructions
```

---

## Task 0: Infra prerequisites (manual, documented)

**Files:**
- Modify: `agents/README.md`

These are environment steps the operator runs once. Plan documents them; no code yet.

- [ ] **Step 1: Start RabbitMQ container**

```bash
docker run -d --name pisang-rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

Verify: open `http://localhost:15672` → login `guest` / `guest` → see management UI.

- [ ] **Step 2: Enable pgvector extension**

Connect to the dev Postgres as a superuser (usually `postgres`):

```bash
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Verify:

```bash
psql "$DATABASE_URL" -c "\dx vector"
```

Expected: row showing extension `vector` with version.

- [ ] **Step 3: Commit updated README section**

Append a "Memory setup" section to `agents/README.md` documenting the two commands above. Keep wording minimal.

```bash
git add agents/README.md
git commit -m "docs(agents): document pgvector + rabbitmq setup"
```

---

## Task 1: Add Python dependencies

**Files:**
- Modify: `agents/requirements.txt`
- Create: `agents/scripts/preload_embedder.py`

- [ ] **Step 1: Append deps to `agents/requirements.txt`**

Add exactly these lines at the bottom:

```
pgvector==0.3.6
sentence-transformers==3.3.1
celery==5.4.0
kombu[amqp]==5.4.2
alembic==1.14.0
phonenumbers==8.13.50
```

- [ ] **Step 2: Install**

Run from `agents/`:

```bash
pip install -r requirements.txt
```

Expected: installs complete without resolver error.

- [ ] **Step 3: Create preload script**

Create `agents/scripts/preload_embedder.py`:

```python
"""Pre-download the bge-m3 model so first worker start is not slow."""
from sentence_transformers import SentenceTransformer

if __name__ == "__main__":
    model = SentenceTransformer("BAAI/bge-m3")
    print(f"Loaded bge-m3, dim={model.get_sentence_embedding_dimension()}")
```

- [ ] **Step 4: Run preload script once**

```bash
python scripts/preload_embedder.py
```

Expected output: `Loaded bge-m3, dim=1024`. Takes ~1-2 min first time (downloads ~2GB to HF cache).

- [ ] **Step 5: Commit**

```bash
git add agents/requirements.txt agents/scripts/preload_embedder.py
git commit -m "feat(agents): add pgvector/celery/bge-m3 deps + preload script"
```

---

## Task 2: SQLAlchemy memory models

**Files:**
- Create: `agents/app/memory/__init__.py`
- Create: `agents/app/memory/models.py`
- Modify: `agents/app/db.py`
- Test: `agents/tests/__init__.py`, `agents/tests/conftest.py`

- [ ] **Step 1: Create `agents/app/memory/__init__.py`**

Empty file.

- [ ] **Step 2: Create `agents/app/memory/models.py`**

```python
from sqlalchemy import Column, String, Integer, Boolean, Text, DateTime, Index
from pgvector.sqlalchemy import Vector
from datetime import datetime, timezone

from app.db import Base


EMBED_DIM = 1024


class MemoryConversationTurn(Base):
    __tablename__ = "memory_conversation_turn"
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    customerPhone = Column(String, nullable=False, index=True)
    buyerMsg = Column(Text, nullable=False)
    agentReply = Column(Text, nullable=False)
    turnAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    summarized = Column(Boolean, nullable=False, default=False)


class MemoryConversationSummary(Base):
    __tablename__ = "memory_conversation_summary"
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    customerPhone = Column(String, nullable=False, index=True)
    summary = Column(Text, nullable=False)
    coversFromTurnAt = Column(DateTime, nullable=False)
    coversToTurnAt = Column(DateTime, nullable=False)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class MemoryKbChunk(Base):
    __tablename__ = "memory_kb_chunk"
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    sourceId = Column(String, nullable=False, index=True)
    chunkIndex = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class MemoryProductEmbedding(Base):
    __tablename__ = "memory_product_embedding"
    productId = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    updatedAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))


class MemoryPastAction(Base):
    __tablename__ = "memory_past_action"
    id = Column(String, primary_key=True)
    businessId = Column(String, nullable=False, index=True)
    customerMsg = Column(Text, nullable=False)
    finalReply = Column(Text, nullable=False)
    embedding = Column(Vector(EMBED_DIM), nullable=False)
    createdAt = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


Index(
    "ix_memory_conversation_turn_biz_phone_turnat",
    MemoryConversationTurn.businessId,
    MemoryConversationTurn.customerPhone,
    MemoryConversationTurn.turnAt.desc(),
)
```

- [ ] **Step 3: Import memory models in `agents/app/db.py`**

Append to the bottom of `agents/app/db.py`:

```python
# Register memory models with Base.metadata so Alembic sees them.
from app.memory import models as _memory_models  # noqa: F401,E402
```

- [ ] **Step 4: Create test scaffolding**

Create `agents/tests/__init__.py` — empty file.

Create `agents/tests/conftest.py`:

```python
import os
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.db import Base
import app.memory.models  # noqa: F401  ensure models registered


@pytest.fixture(scope="session")
def engine():
    url = os.environ.get("TEST_DATABASE_URL") or os.environ["DATABASE_URL"]
    eng = create_engine(url, pool_pre_ping=True)
    with eng.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    Base.metadata.create_all(eng)
    yield eng


@pytest.fixture()
def session(engine):
    Session = sessionmaker(bind=engine)
    with Session() as s:
        yield s
        s.rollback()
```

- [ ] **Step 5: Sanity smoke — verify models import**

```bash
cd agents && python -c "from app.memory import models; print([m.__tablename__ for m in [models.MemoryConversationTurn, models.MemoryConversationSummary, models.MemoryKbChunk, models.MemoryProductEmbedding, models.MemoryPastAction]])"
```

Expected: list of 5 table names.

- [ ] **Step 6: Commit**

```bash
git add agents/app/memory/ agents/app/db.py agents/tests/__init__.py agents/tests/conftest.py
git commit -m "feat(memory): add SQLAlchemy vector table models"
```

---

## Task 3: Alembic setup + initial migration

**Files:**
- Create: `agents/alembic.ini`
- Create: `agents/alembic/env.py`
- Create: `agents/alembic/script.py.mako`
- Create: `agents/alembic/versions/0001_memory_tables.py`

- [ ] **Step 1: Initialize alembic**

```bash
cd agents && alembic init alembic
```

This creates `alembic.ini`, `alembic/env.py`, `alembic/script.py.mako`, `alembic/versions/`.

- [ ] **Step 2: Edit `agents/alembic.ini`**

Change line starting with `sqlalchemy.url =` to empty (we'll set it from env):

```ini
sqlalchemy.url =
```

- [ ] **Step 3: Replace `agents/alembic/env.py`**

```python
import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

from app.db import Base
import app.memory.models  # noqa: F401  ensure models are registered

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True,
                       dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 4: Create migration `agents/alembic/versions/0001_memory_tables.py`**

```python
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
```

- [ ] **Step 5: Run migration**

```bash
cd agents && alembic upgrade head
```

Expected output: `Running upgrade -> 0001, create memory tables`.

- [ ] **Step 6: Verify tables**

```bash
psql "$DATABASE_URL" -c "\dt memory_*"
```

Expected: 5 tables listed.

- [ ] **Step 7: Commit**

```bash
git add agents/alembic.ini agents/alembic/
git commit -m "feat(memory): add alembic migration for vector tables + HNSW indexes"
```

---

## Task 4: Embedder module

**Files:**
- Create: `agents/app/memory/embedder.py`
- Create: `agents/tests/test_embedder.py`

- [ ] **Step 1: Write the failing test `agents/tests/test_embedder.py`**

```python
import pytest
from app.memory import embedder


def test_embed_returns_correct_dim():
    vecs = embedder.embed(["hello world"])
    assert len(vecs) == 1
    assert len(vecs[0]) == 1024


def test_embed_is_deterministic():
    a = embedder.embed(["consistency test"])[0]
    b = embedder.embed(["consistency test"])[0]
    assert a == b


def test_embed_different_texts_differ():
    a = embedder.embed(["nasi lemak"])[0]
    b = embedder.embed(["quantum physics"])[0]
    # cosine sim = dot since normalized
    sim = sum(x * y for x, y in zip(a, b))
    assert sim < 0.95


def test_embed_batch():
    vecs = embedder.embed(["a", "b", "c"])
    assert len(vecs) == 3
    assert all(len(v) == 1024 for v in vecs)
```

- [ ] **Step 2: Run tests — should fail (module missing)**

```bash
cd agents && pytest tests/test_embedder.py -v
```

Expected: import error for `app.memory.embedder`.

- [ ] **Step 3: Implement `agents/app/memory/embedder.py`**

```python
import os
import threading
from sentence_transformers import SentenceTransformer


_model = None
_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                name = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
                _model = SentenceTransformer(name)
    return _model


def embed(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    model = _get_model()
    arr = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return arr.tolist()
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd agents && pytest tests/test_embedder.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/memory/embedder.py agents/tests/test_embedder.py
git commit -m "feat(memory): add bge-m3 embedder singleton"
```

---

## Task 5: Chunker module

**Files:**
- Create: `agents/app/memory/chunker.py`
- Create: `agents/tests/test_chunker.py`

- [ ] **Step 1: Write the failing test `agents/tests/test_chunker.py`**

```python
from app.memory.chunker import chunk_text


def test_short_text_single_chunk():
    chunks = chunk_text("Short doc.", target_chars=500, overlap_chars=50)
    assert chunks == ["Short doc."]


def test_empty_input():
    assert chunk_text("", target_chars=500, overlap_chars=50) == []


def test_long_text_splits_with_overlap():
    text = "A" * 1000 + "B" * 1000
    chunks = chunk_text(text, target_chars=500, overlap_chars=50)
    assert len(chunks) >= 4
    assert all(len(c) <= 600 for c in chunks)
    # adjacent chunks overlap
    assert chunks[0][-50:] == chunks[1][:50]


def test_prefers_sentence_boundary():
    text = "Sentence one. Sentence two. " * 50
    chunks = chunk_text(text, target_chars=200, overlap_chars=20)
    # each non-final chunk should end on a period (allow trailing space)
    for c in chunks[:-1]:
        assert c.rstrip().endswith(".")
```

- [ ] **Step 2: Run tests — should fail**

```bash
cd agents && pytest tests/test_chunker.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `agents/app/memory/chunker.py`**

```python
def chunk_text(text: str, target_chars: int = 2000, overlap_chars: int = 200) -> list[str]:
    """Chunk text into ~target_chars pieces with overlap. Prefers sentence boundaries."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= target_chars:
        return [text]

    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + target_chars, n)
        # try to extend to next sentence boundary within 20% of target
        if end < n:
            window_end = min(end + int(target_chars * 0.2), n)
            dot = text.rfind(". ", end, window_end)
            if dot != -1:
                end = dot + 1
            else:
                # fall back to backing off to previous period within last 20%
                back_start = max(start + int(target_chars * 0.8), start + 1)
                dot = text.rfind(". ", back_start, end)
                if dot != -1:
                    end = dot + 1
        chunks.append(text[start:end])
        if end >= n:
            break
        start = max(0, end - overlap_chars)
    return chunks
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd agents && pytest tests/test_chunker.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/memory/chunker.py agents/tests/test_chunker.py
git commit -m "feat(memory): add text chunker with sentence-boundary preference"
```

---

## Task 6: Repo — insert/upsert helpers

**Files:**
- Create: `agents/app/memory/repo.py`
- Create: `agents/tests/test_repo.py`

- [ ] **Step 1: Write failing test `agents/tests/test_repo.py`**

```python
from datetime import datetime, timezone
from app.memory import repo, models


def _vec(seed: int) -> list[float]:
    # simple deterministic unit-ish vector
    import math
    raw = [(i * seed % 97) / 97.0 for i in range(1024)]
    norm = math.sqrt(sum(x * x for x in raw)) or 1.0
    return [x / norm for x in raw]


def test_insert_turn_and_fetch_recent(session):
    repo.insert_turn(session, "biz1", "+60111", "hi", "hello", _vec(1))
    repo.insert_turn(session, "biz1", "+60111", "nak order", "sure", _vec(2))
    session.commit()
    rows = repo.recent_turns(session, "biz1", "+60111", limit=10)
    assert len(rows) == 2
    assert rows[0].buyerMsg == "nak order"  # newest first


def test_recent_turns_isolates_by_phone(session):
    repo.insert_turn(session, "biz1", "+60111", "mine", "a", _vec(3))
    repo.insert_turn(session, "biz1", "+60222", "other", "b", _vec(4))
    session.commit()
    rows = repo.recent_turns(session, "biz1", "+60111", limit=10)
    assert all(r.customerPhone == "+60111" for r in rows)


def test_upsert_product(session):
    repo.upsert_product_embedding(session, "p1", "biz1", "sambal", _vec(5))
    repo.upsert_product_embedding(session, "p1", "biz1", "sambal updated", _vec(6))
    session.commit()
    row = session.query(models.MemoryProductEmbedding).filter_by(productId="p1").one()
    assert row.content == "sambal updated"


def test_upsert_past_action(session):
    repo.upsert_past_action(session, "a1", "biz1", "refund?", "sure", _vec(7))
    repo.upsert_past_action(session, "a1", "biz1", "refund?", "updated", _vec(8))
    session.commit()
    row = session.query(models.MemoryPastAction).filter_by(id="a1").one()
    assert row.finalReply == "updated"


def test_insert_kb_chunk(session):
    repo.insert_kb_chunk(session, "biz1", "src1", 0, "shipping policy", _vec(9))
    session.commit()
    rows = session.query(models.MemoryKbChunk).filter_by(businessId="biz1").all()
    assert len(rows) == 1
    assert rows[0].sourceId == "src1"


def test_insert_summary(session):
    now = datetime.now(timezone.utc)
    repo.insert_summary(session, "biz1", "+60111", "buyer liked sambal", now, now, _vec(10))
    session.commit()
    rows = session.query(models.MemoryConversationSummary).all()
    assert len(rows) == 1
```

- [ ] **Step 2: Run test — should fail (module missing)**

```bash
cd agents && pytest tests/test_repo.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `agents/app/memory/repo.py` (insert/upsert half)**

```python
from datetime import datetime, timezone
from cuid2 import Cuid as _Cuid

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.memory import models

_cuid = _Cuid()


def _id() -> str:
    return _cuid.generate()


def insert_turn(session: Session, business_id: str, customer_phone: str,
                buyer_msg: str, agent_reply: str, embedding: list[float]) -> str:
    row = models.MemoryConversationTurn(
        id=_id(),
        businessId=business_id,
        customerPhone=customer_phone,
        buyerMsg=buyer_msg,
        agentReply=agent_reply,
        turnAt=datetime.now(timezone.utc),
        embedding=embedding,
        summarized=False,
    )
    session.add(row)
    return row.id


def insert_summary(session: Session, business_id: str, customer_phone: str,
                    summary: str, covers_from: datetime, covers_to: datetime,
                    embedding: list[float]) -> str:
    row = models.MemoryConversationSummary(
        id=_id(),
        businessId=business_id,
        customerPhone=customer_phone,
        summary=summary,
        coversFromTurnAt=covers_from,
        coversToTurnAt=covers_to,
        embedding=embedding,
        createdAt=datetime.now(timezone.utc),
    )
    session.add(row)
    return row.id


def insert_kb_chunk(session: Session, business_id: str, source_id: str,
                    chunk_index: int, content: str, embedding: list[float]) -> str:
    row = models.MemoryKbChunk(
        id=_id(),
        businessId=business_id,
        sourceId=source_id,
        chunkIndex=chunk_index,
        content=content,
        embedding=embedding,
        createdAt=datetime.now(timezone.utc),
    )
    session.add(row)
    return row.id


def upsert_product_embedding(session: Session, product_id: str, business_id: str,
                              content: str, embedding: list[float]) -> None:
    stmt = pg_insert(models.MemoryProductEmbedding).values(
        productId=product_id,
        businessId=business_id,
        content=content,
        embedding=embedding,
        updatedAt=datetime.now(timezone.utc),
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["productId"],
        set_={
            "content": stmt.excluded.content,
            "embedding": stmt.excluded.embedding,
            "businessId": stmt.excluded.businessId,
            "updatedAt": stmt.excluded.updatedAt,
        },
    )
    session.execute(stmt)


def upsert_past_action(session: Session, action_id: str, business_id: str,
                        customer_msg: str, final_reply: str, embedding: list[float]) -> None:
    stmt = pg_insert(models.MemoryPastAction).values(
        id=action_id,
        businessId=business_id,
        customerMsg=customer_msg,
        finalReply=final_reply,
        embedding=embedding,
        createdAt=datetime.now(timezone.utc),
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "customerMsg": stmt.excluded.customerMsg,
            "finalReply": stmt.excluded.finalReply,
            "embedding": stmt.excluded.embedding,
        },
    )
    session.execute(stmt)


def recent_turns(session: Session, business_id: str, customer_phone: str,
                  limit: int = 20) -> list[models.MemoryConversationTurn]:
    q = (
        select(models.MemoryConversationTurn)
        .where(models.MemoryConversationTurn.businessId == business_id)
        .where(models.MemoryConversationTurn.customerPhone == customer_phone)
        .order_by(models.MemoryConversationTurn.turnAt.desc())
        .limit(limit)
    )
    return list(session.execute(q).scalars())
```

- [ ] **Step 4: Run test — should pass**

```bash
cd agents && pytest tests/test_repo.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/memory/repo.py agents/tests/test_repo.py
git commit -m "feat(memory): add repo insert/upsert helpers + tests"
```

---

## Task 7: Repo — vector search

**Files:**
- Modify: `agents/app/memory/repo.py`
- Modify: `agents/tests/test_repo.py`

- [ ] **Step 1: Add failing tests to `agents/tests/test_repo.py`**

Append to the file:

```python
def test_search_kb_ranks_closer_text_first(session):
    # embed-like vectors: construct two vectors far apart
    v1 = [1.0] + [0.0] * 1023
    v2 = [0.0, 1.0] + [0.0] * 1022
    repo.insert_kb_chunk(session, "biz2", "src", 0, "shipping KL", v1)
    repo.insert_kb_chunk(session, "biz2", "src", 1, "refund policy", v2)
    session.commit()
    # query close to v1
    hits = repo.search_kb(session, "biz2", v1, k=2, min_sim=0.0)
    assert hits[0].content == "shipping KL"


def test_search_threshold_filters_noise(session):
    v1 = [1.0] + [0.0] * 1023
    v2 = [0.0, 1.0] + [0.0] * 1022
    repo.insert_kb_chunk(session, "biz3", "src", 0, "unrelated", v2)
    session.commit()
    hits = repo.search_kb(session, "biz3", v1, k=5, min_sim=0.5)
    assert hits == []


def test_search_isolates_by_business(session):
    v1 = [1.0] + [0.0] * 1023
    repo.insert_kb_chunk(session, "bizA", "src", 0, "A doc", v1)
    repo.insert_kb_chunk(session, "bizB", "src", 0, "B doc", v1)
    session.commit()
    hits = repo.search_kb(session, "bizA", v1, k=5, min_sim=0.0)
    assert all(h.businessId == "bizA" for h in hits)


def test_search_summaries_filters_by_phone(session):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    v = [1.0] + [0.0] * 1023
    repo.insert_summary(session, "biz4", "+60111", "mine", now, now, v)
    repo.insert_summary(session, "biz4", "+60222", "other", now, now, v)
    session.commit()
    hits = repo.search_summaries(session, "biz4", "+60111", v, k=5, min_sim=0.0)
    assert all(h.customerPhone == "+60111" for h in hits)


def test_search_products_and_past_actions_work(session):
    v = [1.0] + [0.0] * 1023
    repo.upsert_product_embedding(session, "p2", "biz5", "sambal", v)
    repo.upsert_past_action(session, "a2", "biz5", "refund?", "yes", v)
    session.commit()
    p_hits = repo.search_products(session, "biz5", v, k=5, min_sim=0.0)
    a_hits = repo.search_past_actions(session, "biz5", v, k=5, min_sim=0.0)
    assert len(p_hits) == 1 and p_hits[0].content == "sambal"
    assert len(a_hits) == 1 and a_hits[0].customerMsg == "refund?"
```

- [ ] **Step 2: Run — should fail (search fns missing)**

```bash
cd agents && pytest tests/test_repo.py -v
```

Expected: AttributeError on `repo.search_kb` etc.

- [ ] **Step 3: Append search helpers to `agents/app/memory/repo.py`**

```python
# cosine distance via pgvector's <=> operator. similarity = 1 - distance.
# pgvector.sqlalchemy exposes .cosine_distance() on Vector columns.

def _with_similarity(query, distance_col):
    sim_col = (1 - distance_col).label("similarity")
    return query.add_columns(sim_col).order_by(distance_col)


def _run_search(session, model, embedding, k, min_sim, extra_filters):
    dist = model.embedding.cosine_distance(embedding)
    q = select(model, (1 - dist).label("similarity"))
    for f in extra_filters:
        q = q.where(f)
    q = q.order_by(dist).limit(k)
    rows = session.execute(q).all()
    results = []
    for row in rows:
        obj = row[0]
        sim = float(row[1])
        if sim < min_sim:
            continue
        obj.similarity = sim  # attach for callers
        results.append(obj)
    return results


def search_kb(session, business_id, embedding, k=5, min_sim=0.6):
    return _run_search(
        session,
        models.MemoryKbChunk,
        embedding,
        k,
        min_sim,
        [models.MemoryKbChunk.businessId == business_id],
    )


def search_products(session, business_id, embedding, k=5, min_sim=0.5):
    return _run_search(
        session,
        models.MemoryProductEmbedding,
        embedding,
        k,
        min_sim,
        [models.MemoryProductEmbedding.businessId == business_id],
    )


def search_past_actions(session, business_id, embedding, k=3, min_sim=0.7):
    return _run_search(
        session,
        models.MemoryPastAction,
        embedding,
        k,
        min_sim,
        [models.MemoryPastAction.businessId == business_id],
    )


def search_summaries(session, business_id, customer_phone, embedding, k=3, min_sim=0.5):
    return _run_search(
        session,
        models.MemoryConversationSummary,
        embedding,
        k,
        min_sim,
        [
            models.MemoryConversationSummary.businessId == business_id,
            models.MemoryConversationSummary.customerPhone == customer_phone,
        ],
    )
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd agents && pytest tests/test_repo.py -v
```

Expected: 11 passed (6 prior + 5 new).

- [ ] **Step 5: Commit**

```bash
git add agents/app/memory/repo.py agents/tests/test_repo.py
git commit -m "feat(memory): add cosine vector search helpers"
```

---

## Task 8: Formatter module

**Files:**
- Create: `agents/app/memory/formatter.py`
- Create: `agents/tests/test_formatter.py`

- [ ] **Step 1: Write failing test `agents/tests/test_formatter.py`**

```python
from datetime import datetime, timezone
from types import SimpleNamespace
from app.memory import formatter


def _turn(buyer, reply, when):
    return SimpleNamespace(buyerMsg=buyer, agentReply=reply, turnAt=when)


def _summary(text, covers_from, covers_to):
    return SimpleNamespace(summary=text, coversFromTurnAt=covers_from, coversToTurnAt=covers_to)


def test_memory_block_with_no_phone():
    block = formatter.memory_block(phone=None, recent_turns=[], summaries=[])
    assert "No prior history" in block


def test_memory_block_orders_turns_oldest_first():
    t1 = datetime(2026, 4, 20, 14, 32, tzinfo=timezone.utc)
    t2 = datetime(2026, 4, 20, 14, 35, tzinfo=timezone.utc)
    # repo returns newest first; formatter must flip
    turns = [_turn("later", "ack-later", t2), _turn("earlier", "ack-earlier", t1)]
    block = formatter.memory_block(phone="+60111", recent_turns=turns, summaries=[])
    assert block.index("earlier") < block.index("later")


def test_memory_block_includes_summaries():
    s = _summary("Buyer prefers small jars.",
                 datetime(2026, 3, 1, tzinfo=timezone.utc),
                 datetime(2026, 4, 1, tzinfo=timezone.utc))
    block = formatter.memory_block(phone="+60111", recent_turns=[], summaries=[s])
    assert "small jars" in block
    assert "2026-03-01" in block


def test_memory_block_masks_phone():
    block = formatter.memory_block(phone="+60123456789", recent_turns=[], summaries=[])
    assert "+60123456789" not in block
    assert "456789" not in block  # last 6 digits masked


def test_format_search_results_shows_similarity():
    hits = [SimpleNamespace(content="hello", similarity=0.82)]
    out = formatter.format_search_results("kb", hits)
    assert "kind=kb" in out
    assert "0.82" in out
    assert "hello" in out


def test_format_search_results_empty():
    out = formatter.format_search_results("kb", [])
    assert "No results" in out
```

- [ ] **Step 2: Run — should fail**

```bash
cd agents && pytest tests/test_formatter.py -v
```

- [ ] **Step 3: Implement `agents/app/memory/formatter.py`**

```python
def _mask_phone(phone: str) -> str:
    if not phone:
        return ""
    if len(phone) <= 4:
        return "*" * len(phone)
    return phone[:4] + "*" * (len(phone) - 4)


def memory_block(phone, recent_turns, summaries) -> str:
    if not phone:
        return "(No prior history — first contact)"
    if not recent_turns and not summaries:
        return f"(No prior history with buyer {_mask_phone(phone)} — first contact)"

    lines = [f"--- Past conversation with this buyer (phone {_mask_phone(phone)}) ---"]
    # repo returns newest first; flip to oldest first for reading order
    turns = list(reversed(list(recent_turns)))
    for t in turns:
        ts = t.turnAt.strftime("%Y-%m-%d %H:%M")
        lines.append(f"[{ts}] Buyer: {t.buyerMsg}")
        lines.append(f"              You:   {t.agentReply}")

    if summaries:
        lines.append("")
        lines.append("--- Relevant older context ---")
        for s in summaries:
            a = s.coversFromTurnAt.strftime("%Y-%m-%d")
            b = s.coversToTurnAt.strftime("%Y-%m-%d")
            lines.append(f"- [covers {a} → {b}] {s.summary}")

    lines.append("---")
    lines.append("Use this history to maintain continuity. Do not re-ask info buyer already gave.")
    return "\n".join(lines)


def format_search_results(kind: str, hits) -> str:
    hits = list(hits)
    if not hits:
        return f"No results (kind={kind})."
    lines = [f"Found {len(hits)} results (kind={kind}):"]
    for i, h in enumerate(hits, start=1):
        sim = getattr(h, "similarity", 0.0)
        content = getattr(h, "content", None) or getattr(h, "customerMsg", None) or ""
        lines.append(f"{i}. [sim={sim:.2f}] {content}")
    return "\n".join(lines)
```

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_formatter.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/memory/formatter.py agents/tests/test_formatter.py
git commit -m "feat(memory): add memory block + search result formatters"
```

---

## Task 9: Celery app skeleton

**Files:**
- Create: `agents/app/worker/__init__.py`
- Create: `agents/app/worker/celery_app.py`
- Modify: `.env.example` (or create if missing)

- [ ] **Step 1: Create `agents/app/worker/__init__.py`** — empty file.

- [ ] **Step 2: Create `agents/app/worker/celery_app.py`**

```python
import os
from celery import Celery
from dotenv import load_dotenv

load_dotenv()

BROKER_URL = os.environ.get("CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//")

celery = Celery(
    "pisang_agents",
    broker=BROKER_URL,
    include=["app.worker.tasks"],
)

celery.conf.update(
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_default_queue="memory",
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "summarize-old-turns": {
            "task": "app.worker.tasks.summarize_old_turns",
            "schedule": float(os.environ.get("MEMORY_SUMMARY_INTERVAL_SEC", "3600")),
        },
    },
)
```

- [ ] **Step 3: Update `.env.example`**

If file exists, append. Otherwise create at `agents/.env.example`:

```
CELERY_BROKER_URL=amqp://guest:guest@localhost:5672//
EMBED_MODEL=BAAI/bge-m3
MEMORY_RECENT_TURNS=20
MEMORY_SUMMARY_BATCH=20
MEMORY_SUMMARY_INTERVAL_SEC=3600
MEMORY_ENABLED=true
```

- [ ] **Step 4: Smoke — verify import**

```bash
cd agents && python -c "from app.worker.celery_app import celery; print(celery.main, celery.conf.broker_url)"
```

Expected: `pisang_agents amqp://guest:guest@localhost:5672//`.

- [ ] **Step 5: Commit**

```bash
git add agents/app/worker/ agents/.env.example
git commit -m "feat(worker): add Celery app + RabbitMQ broker config"
```

---

## Task 10: Task `embed_and_store_turn`

**Files:**
- Create: `agents/app/worker/tasks.py`
- Create: `agents/tests/test_tasks.py`

- [ ] **Step 1: Write failing test `agents/tests/test_tasks.py`**

```python
import pytest
from app.worker.celery_app import celery
from app.worker import tasks
from app.memory import models


@pytest.fixture(autouse=True)
def eager_celery():
    celery.conf.task_always_eager = True
    celery.conf.task_eager_propagates = True
    yield
    celery.conf.task_always_eager = False


def test_embed_and_store_turn_writes_row(session, engine, monkeypatch):
    # patch SessionLocal used inside tasks so writes land on our test engine
    from sqlalchemy.orm import sessionmaker
    TestSession = sessionmaker(bind=engine)
    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    # patch embedder to avoid loading the model in tests
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.1] * 1024 for _ in texts])

    tasks.embed_and_store_turn.delay(
        business_id="biz1",
        customer_phone="+60111",
        buyer_msg="hi",
        agent_reply="hello",
        action_id="act1",
    )

    rows = session.query(models.MemoryConversationTurn).filter_by(businessId="biz1").all()
    assert len(rows) == 1
    assert rows[0].buyerMsg == "hi"
    assert len(rows[0].embedding) == 1024
```

- [ ] **Step 2: Run — should fail**

```bash
cd agents && pytest tests/test_tasks.py -v
```

- [ ] **Step 3: Implement `agents/app/worker/tasks.py`**

```python
from app.worker.celery_app import celery
from app.db import SessionLocal
from app.memory import repo
from app.memory.embedder import embed


@celery.task(bind=True, max_retries=3, default_retry_delay=30)
def embed_and_store_turn(self, business_id: str, customer_phone: str,
                          buyer_msg: str, agent_reply: str, action_id: str):
    try:
        text = f"{buyer_msg}\n{agent_reply}"
        vec = embed([text])[0]
        with SessionLocal() as session:
            repo.insert_turn(session, business_id, customer_phone, buyer_msg, agent_reply, vec)
            session.commit()
    except Exception as e:
        raise self.retry(exc=e)
```

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_tasks.py -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/worker/tasks.py agents/tests/test_tasks.py
git commit -m "feat(worker): add embed_and_store_turn task + test"
```

---

## Task 11: Task `embed_product`

**Files:**
- Modify: `agents/app/worker/tasks.py`
- Modify: `agents/tests/test_tasks.py`

- [ ] **Step 1: Append test to `agents/tests/test_tasks.py`**

```python
def test_embed_product_upserts(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from app.db import Product
    # insert a product row directly using our test engine
    TestSession = sessionmaker(bind=engine)
    with TestSession() as s:
        s.add(Product(id="p1", name="Sambal", price=9.9, stock=5,
                       description="spicy", businessId="biz1"))
        s.commit()

    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.2] * 1024 for _ in texts])

    tasks.embed_product.delay("p1")
    tasks.embed_product.delay("p1")  # idempotent

    rows = session.query(models.MemoryProductEmbedding).filter_by(productId="p1").all()
    assert len(rows) == 1
    assert "Sambal" in rows[0].content
```

- [ ] **Step 2: Run — should fail (task missing)**

```bash
cd agents && pytest tests/test_tasks.py::test_embed_product_upserts -v
```

- [ ] **Step 3: Append task to `agents/app/worker/tasks.py`**

```python
from app.db import Product


@celery.task(bind=True, max_retries=3, default_retry_delay=30)
def embed_product(self, product_id: str):
    try:
        with SessionLocal() as session:
            p = session.query(Product).filter(Product.id == product_id).first()
            if not p:
                return  # silently skip; caller can re-trigger
            content = f"{p.name} — {p.description or ''} — RM{float(p.price):.2f}"
            vec = embed([content])[0]
            repo.upsert_product_embedding(session, p.id, p.businessId, content, vec)
            session.commit()
    except Exception as e:
        raise self.retry(exc=e)
```

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_tasks.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/worker/tasks.py agents/tests/test_tasks.py
git commit -m "feat(worker): add embed_product upsert task"
```

---

## Task 12: Task `embed_kb_chunk`

**Files:**
- Modify: `agents/app/worker/tasks.py`
- Modify: `agents/tests/test_tasks.py`

- [ ] **Step 1: Append test**

```python
def test_embed_kb_chunk_writes_row(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    TestSession = sessionmaker(bind=engine)
    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.3] * 1024])

    tasks.embed_kb_chunk.delay(
        business_id="biz1",
        source_id="docA",
        chunk_index=0,
        content="We ship KL same day",
    )

    rows = session.query(models.MemoryKbChunk).filter_by(sourceId="docA").all()
    assert len(rows) == 1
    assert rows[0].content == "We ship KL same day"
```

- [ ] **Step 2: Run — should fail**

```bash
cd agents && pytest tests/test_tasks.py::test_embed_kb_chunk_writes_row -v
```

- [ ] **Step 3: Append task**

```python
@celery.task(bind=True, max_retries=3, default_retry_delay=30)
def embed_kb_chunk(self, business_id: str, source_id: str, chunk_index: int, content: str):
    try:
        vec = embed([content])[0]
        with SessionLocal() as session:
            repo.insert_kb_chunk(session, business_id, source_id, chunk_index, content, vec)
            session.commit()
    except Exception as e:
        raise self.retry(exc=e)
```

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_tasks.py -v
```

- [ ] **Step 5: Commit**

```bash
git add agents/app/worker/tasks.py agents/tests/test_tasks.py
git commit -m "feat(worker): add embed_kb_chunk task"
```

---

## Task 13: Task `embed_past_action`

**Files:**
- Modify: `agents/app/worker/tasks.py`
- Modify: `agents/tests/test_tasks.py`

- [ ] **Step 1: Append test**

```python
def test_embed_past_action_upserts(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from datetime import datetime, timezone
    from app.db import AgentAction, AgentActionStatus
    TestSession = sessionmaker(bind=engine)
    with TestSession() as s:
        s.add(AgentAction(id="act1", businessId="biz1", customerMsg="refund?",
                           draftReply="sure", finalReply="sure",
                           confidence=0.9, reasoning="ok",
                           status=AgentActionStatus.APPROVED,
                           createdAt=datetime.now(timezone.utc),
                           updatedAt=datetime.now(timezone.utc)))
        s.commit()

    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.4] * 1024])

    tasks.embed_past_action.delay("act1")
    tasks.embed_past_action.delay("act1")  # idempotent

    rows = session.query(models.MemoryPastAction).filter_by(id="act1").all()
    assert len(rows) == 1
```

- [ ] **Step 2: Run — should fail**

```bash
cd agents && pytest tests/test_tasks.py::test_embed_past_action_upserts -v
```

- [ ] **Step 3: Append task**

```python
from app.db import AgentAction


@celery.task(bind=True, max_retries=3, default_retry_delay=30)
def embed_past_action(self, action_id: str):
    try:
        with SessionLocal() as session:
            a = session.query(AgentAction).filter(AgentAction.id == action_id).first()
            if not a:
                return
            msg = a.customerMsg
            reply = a.finalReply or a.draftReply
            vec = embed([msg])[0]
            repo.upsert_past_action(session, a.id, a.businessId, msg, reply, vec)
            session.commit()
    except Exception as e:
        raise self.retry(exc=e)
```

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_tasks.py -v
```

- [ ] **Step 5: Commit**

```bash
git add agents/app/worker/tasks.py agents/tests/test_tasks.py
git commit -m "feat(worker): add embed_past_action task"
```

---

## Task 14: Task `summarize_old_turns`

**Files:**
- Modify: `agents/app/worker/tasks.py`
- Modify: `agents/tests/test_tasks.py`

- [ ] **Step 1: Append test**

```python
def test_summarize_old_turns(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from datetime import datetime, timezone, timedelta
    TestSession = sessionmaker(bind=engine)

    # 25 turns, oldest first; keep last 20 untouched, summarize 5 oldest
    now = datetime.now(timezone.utc)
    with TestSession() as s:
        for i in range(25):
            s.add(models.MemoryConversationTurn(
                id=f"t{i}",
                businessId="bizS",
                customerPhone="+60111",
                buyerMsg=f"q{i}",
                agentReply=f"a{i}",
                turnAt=now - timedelta(minutes=25 - i),
                embedding=[0.01] * 1024,
                summarized=False,
            ))
        s.commit()

    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.5] * 1024 for _ in texts])
    monkeypatch.setattr(tasks, "_llm_summarize",
                         lambda turns: "Buyer asked several questions about sambal.")

    tasks.summarize_old_turns.delay()

    # summary row written
    summaries = session.query(models.MemoryConversationSummary).filter_by(businessId="bizS").all()
    assert len(summaries) == 1

    # 5 oldest marked summarized=True, 20 newest still False
    turns = session.query(models.MemoryConversationTurn).filter_by(businessId="bizS").order_by(
        models.MemoryConversationTurn.turnAt.asc()).all()
    assert [t.summarized for t in turns[:5]] == [True] * 5
    assert all(not t.summarized for t in turns[5:])
```

- [ ] **Step 2: Run — should fail**

```bash
cd agents && pytest tests/test_tasks.py::test_summarize_old_turns -v
```

- [ ] **Step 3: Append task + helper**

```python
import os
from sqlalchemy import select, func
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage


def _llm_summarize(turns) -> str:
    """Call LLM to summarize a list of MemoryConversationTurn rows. Overridable in tests."""
    model = ChatOpenAI(
        model=os.getenv("MODEL"),
        openai_api_key=os.getenv("API_KEY"),
        openai_api_base=os.getenv("OPENAI_API_BASE"),
        temperature=0.3,
    )
    convo = "\n".join(f"Buyer: {t.buyerMsg}\nSeller: {t.agentReply}" for t in turns)
    resp = model.invoke([
        SystemMessage(content=(
            "Summarize the following buyer/seller exchange in about 200 tokens. "
            "Preserve facts stated, preferences revealed, and unresolved items. "
            "Output plain text, no headings."
        )),
        HumanMessage(content=convo),
    ])
    return resp.content if isinstance(resp.content, str) else str(resp.content)


@celery.task
def summarize_old_turns():
    recent_keep = int(os.environ.get("MEMORY_RECENT_TURNS", "20"))
    batch_size = int(os.environ.get("MEMORY_SUMMARY_BATCH", "20"))

    with SessionLocal() as session:
        # find (businessId, customerPhone) pairs with >recent_keep unsummarized turns
        from app.memory.models import MemoryConversationTurn as T

        pairs = session.execute(
            select(T.businessId, T.customerPhone, func.count(T.id))
            .where(T.summarized == False)  # noqa: E712
            .group_by(T.businessId, T.customerPhone)
            .having(func.count(T.id) > recent_keep)
        ).all()

        for business_id, phone, _cnt in pairs:
            # oldest unsummarized-excluding-recent-20
            turns = session.execute(
                select(T)
                .where(T.businessId == business_id, T.customerPhone == phone, T.summarized == False)  # noqa: E712
                .order_by(T.turnAt.asc())
            ).scalars().all()

            if len(turns) <= recent_keep:
                continue

            to_summarize = turns[: len(turns) - recent_keep][:batch_size]
            if not to_summarize:
                continue

            summary_text = _llm_summarize(to_summarize)
            vec = embed([summary_text])[0]
            repo.insert_summary(
                session, business_id, phone, summary_text,
                to_summarize[0].turnAt, to_summarize[-1].turnAt, vec,
            )
            for t in to_summarize:
                t.summarized = True
            session.commit()
```

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_tasks.py -v
```

Expected: 5 passed total.

- [ ] **Step 5: Commit**

```bash
git add agents/app/worker/tasks.py agents/tests/test_tasks.py
git commit -m "feat(worker): add summarize_old_turns beat task"
```

---

## Task 15: Graph state — add `customer_phone` + `memory_block`

**Files:**
- Modify: `agents/app/agents/customer_support.py`

- [ ] **Step 1: Edit `SupportAgentState` TypedDict**

Find the existing definition:

```python
class SupportAgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    business_context: str
    business_id: str
    customer_id: str
    draft_reply: str
    confidence: float
    reasoning: str
    action: Literal["auto_send", "queue_approval"]
    action_id: str
```

Replace with:

```python
class SupportAgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    business_context: str
    business_id: str
    customer_id: str
    customer_phone: str  # normalized E.164 or empty string
    memory_block: str
    draft_reply: str
    confidence: float
    reasoning: str
    action: Literal["auto_send", "queue_approval"]
    action_id: str
```

- [ ] **Step 2: Smoke import**

```bash
cd agents && python -c "from app.agents.customer_support import SupportAgentState; print(SupportAgentState.__annotations__.keys())"
```

Expected output includes `customer_phone` and `memory_block`.

- [ ] **Step 3: Commit**

```bash
git add agents/app/agents/customer_support.py
git commit -m "feat(agent): add customer_phone + memory_block to SupportAgentState"
```

---

## Task 16: Graph node — `load_memory`

**Files:**
- Modify: `agents/app/agents/customer_support.py`
- Create: `agents/tests/test_graph_memory.py`

- [ ] **Step 1: Write failing test `agents/tests/test_graph_memory.py`**

```python
import pytest
from types import SimpleNamespace
from app.agents import customer_support as cs


class FakeLLM:
    def bind_tools(self, tools): return self
    async def ainvoke(self, messages): return SimpleNamespace(content="ok", tool_calls=[])
    def with_structured_output(self, schema):
        class _Parser:
            async def ainvoke(self_inner, history):
                return schema(reply="ok", confidence=0.95, reasoning="clear")
        return _Parser()


@pytest.mark.asyncio
async def test_load_memory_handles_missing_phone(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    TestSession = sessionmaker(bind=engine)
    monkeypatch.setattr(cs, "SessionLocal", TestSession)
    monkeypatch.setattr(cs, "embed", lambda texts: [[0.1] * 1024 for _ in texts])

    state = {
        "messages": [],
        "business_id": "biz1",
        "customer_phone": "",
    }
    result = await cs._load_memory_node(state)
    assert "No prior history" in result["memory_block"]


@pytest.mark.asyncio
async def test_load_memory_fetches_recent_turns(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from app.memory import repo
    from langchain_core.messages import HumanMessage
    TestSession = sessionmaker(bind=engine)
    with TestSession() as s:
        repo.insert_turn(s, "bizM", "+60999", "earlier q", "earlier a", [0.1] * 1024)
        s.commit()

    monkeypatch.setattr(cs, "SessionLocal", TestSession)
    monkeypatch.setattr(cs, "embed", lambda texts: [[0.1] * 1024 for _ in texts])

    state = {
        "messages": [HumanMessage(content="next q")],
        "business_id": "bizM",
        "customer_phone": "+60999",
    }
    result = await cs._load_memory_node(state)
    assert "earlier q" in result["memory_block"]
```

- [ ] **Step 2: Run — should fail (node missing)**

```bash
cd agents && pytest tests/test_graph_memory.py -v
```

- [ ] **Step 3: Add `_load_memory_node` to `agents/app/agents/customer_support.py`**

Add imports near top:

```python
from app.memory import repo as memory_repo
from app.memory.embedder import embed
from app.memory.formatter import memory_block as format_memory_block
```

Add node implementation (before `build_customer_support_agent`):

```python
async def _load_memory_node(state: SupportAgentState) -> dict:
    phone = state.get("customer_phone") or ""
    business_id = state["business_id"]

    if not phone:
        return {"memory_block": format_memory_block(phone=None, recent_turns=[], summaries=[])}

    latest = ""
    if state["messages"]:
        last = state["messages"][-1]
        if isinstance(last.content, str):
            latest = last.content

    with SessionLocal() as session:
        recent = memory_repo.recent_turns(session, business_id, phone,
                                           limit=int(os.environ.get("MEMORY_RECENT_TURNS", "20")))
        summaries = []
        if latest:
            q_vec = embed([latest])[0]
            summaries = memory_repo.search_summaries(session, business_id, phone, q_vec, k=3, min_sim=0.5)

    block = format_memory_block(phone=phone, recent_turns=recent, summaries=summaries)
    return {"memory_block": block}
```

Wire into graph inside `build_customer_support_agent`. Find:

```python
    graph.add_edge(START, "load_context")
    graph.add_edge("load_context", "draft_reply")
```

Replace with:

```python
    graph.add_node("load_memory", _load_memory_node)
    graph.add_edge(START, "load_context")
    graph.add_edge("load_context", "load_memory")
    graph.add_edge("load_memory", "draft_reply")
```

Also update `SYSTEM_TEMPLATE`. Find the template string and add the memory block below `{context}`:

```python
SYSTEM_TEMPLATE = """\
You are a helpful customer support agent for a seller.

{context}

{memory_block}

Your job:
- Answer buyer questions accurately using ONLY the info above
- Be friendly and concise
- Reply in the same language the buyer uses (Malay or English)
- If you are unsure about anything, say so honestly — never fabricate stock or prices

Purchase flow:
- If the buyer clearly wants to purchase a specific product and quantity, call the create_payment_link tool with the product id and quantity.
- After the tool returns a URL, include that URL verbatim in your reply.
- Never invent a payment URL.

After any tool calls, you MUST respond with valid JSON only, no other text:
{{
  "reply": "<your reply to the buyer (include payment URL when a link was generated)>",
  "confidence": <float between 0.0 and 1.0>,
  "reasoning": "<one sentence explaining your confidence>"
}}

Confidence guide:
- 0.9+   : Direct factual answer from product data above, or confirmed payment link
- 0.7-0.9: Reasonable inference from available info
- <0.7   : Uncertain, info missing, or sensitive topic (complaints, refunds, shipping)
"""
```

Update `draft_reply` to pass `memory_block` when formatting:

```python
        system_prompt = SYSTEM_TEMPLATE.format(
            context=state["business_context"],
            memory_block=state.get("memory_block", ""),
        )
```

- [ ] **Step 4: Install pytest-asyncio if missing**

```bash
cd agents && pip install pytest-asyncio==0.24.0
```

Add `agents/pytest.ini` if missing:

```ini
[pytest]
asyncio_mode = auto
```

- [ ] **Step 5: Run tests — should pass**

```bash
cd agents && pytest tests/test_graph_memory.py -v
```

- [ ] **Step 6: Commit**

```bash
git add agents/app/agents/customer_support.py agents/tests/test_graph_memory.py agents/pytest.ini
git commit -m "feat(agent): add load_memory graph node + inject memory_block into system prompt"
```

---

## Task 17: Graph tool — `search_memory`

**Files:**
- Modify: `agents/app/agents/customer_support.py`
- Modify: `agents/tests/test_graph_memory.py`

- [ ] **Step 1: Append failing test**

```python
@pytest.mark.asyncio
async def test_search_memory_tool_returns_kb_hits(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    from app.memory import repo
    TestSession = sessionmaker(bind=engine)
    # known vector so we can query with same vector
    v = [1.0] + [0.0] * 1023
    with TestSession() as s:
        repo.insert_kb_chunk(s, "bizT", "src", 0, "We ship KL same day", v)
        s.commit()

    monkeypatch.setattr(cs, "SessionLocal", TestSession)
    monkeypatch.setattr(cs, "embed", lambda texts: [v for _ in texts])

    tool = cs._make_search_memory_tool("bizT")
    out = tool.invoke({"query": "shipping KL", "kind": "kb"})
    assert "ship KL" in out
    assert "kind=kb" in out


@pytest.mark.asyncio
async def test_search_memory_tool_empty_result(session, engine, monkeypatch):
    from sqlalchemy.orm import sessionmaker
    TestSession = sessionmaker(bind=engine)
    monkeypatch.setattr(cs, "SessionLocal", TestSession)
    monkeypatch.setattr(cs, "embed", lambda texts: [[0.0] * 1024 for _ in texts])

    tool = cs._make_search_memory_tool("biz_empty")
    out = tool.invoke({"query": "anything", "kind": "kb"})
    assert "No results" in out
```

- [ ] **Step 2: Run — should fail**

```bash
cd agents && pytest tests/test_graph_memory.py -v
```

- [ ] **Step 3: Add tool factory + wire it into `draft_reply`**

Add to `agents/app/agents/customer_support.py`:

```python
from app.memory.formatter import format_search_results
from typing import Literal as _Lit


def _make_search_memory_tool(business_id: str):
    @tool
    def search_memory(query: str, kind: _Lit["kb", "product", "past_action"]) -> str:
        """Search business memory for context outside of the live conversation.
        Args:
            query: what to search for (buyer's phrasing or a paraphrase)
            kind: "kb" (FAQ/policy docs), "product" (fuzzy product match), or "past_action" (similar past buyer messages)
        Returns a numbered list of top matches with similarity scores, or "No results".
        """
        q_vec = embed([query])[0]
        with SessionLocal() as session:
            if kind == "kb":
                hits = memory_repo.search_kb(session, business_id, q_vec, k=5, min_sim=0.6)
            elif kind == "product":
                hits = memory_repo.search_products(session, business_id, q_vec, k=5, min_sim=0.5)
            else:
                hits = memory_repo.search_past_actions(session, business_id, q_vec, k=3, min_sim=0.7)
        return format_search_results(kind, hits)
    return search_memory
```

Update `draft_reply` tool binding. Find:

```python
        tool_fn = _make_tool(state["business_id"])
        llm_with_tools = llm.bind_tools([tool_fn])
```

Replace with:

```python
        payment_tool = _make_tool(state["business_id"])
        memory_tool = _make_search_memory_tool(state["business_id"])
        llm_with_tools = llm.bind_tools([payment_tool, memory_tool])
```

Also update the tool-dispatch loop. Find:

```python
            for call in tool_calls:
                result = tool_fn.invoke(call["args"])
                history.append(ToolMessage(content=str(result), tool_call_id=call["id"]))
```

Replace with:

```python
            tool_by_name = {payment_tool.name: payment_tool, memory_tool.name: memory_tool}
            for call in tool_calls:
                chosen = tool_by_name.get(call["name"])
                if chosen is None:
                    history.append(ToolMessage(content=f"ERROR: unknown tool {call['name']}", tool_call_id=call["id"]))
                    continue
                result = chosen.invoke(call["args"])
                history.append(ToolMessage(content=str(result), tool_call_id=call["id"]))
```

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_graph_memory.py -v
```

- [ ] **Step 5: Commit**

```bash
git add agents/app/agents/customer_support.py agents/tests/test_graph_memory.py
git commit -m "feat(agent): add search_memory tool for on-demand KB/product/past-action retrieval"
```

---

## Task 18: Enqueue writes from terminal nodes

**Files:**
- Modify: `agents/app/agents/customer_support.py`
- Modify: `agents/tests/test_graph_memory.py`

- [ ] **Step 1: Append test**

```python
@pytest.mark.asyncio
async def test_auto_send_enqueues_memory_write(monkeypatch):
    enqueued = []
    monkeypatch.setattr(cs, "_enqueue_turn_write", lambda **kw: enqueued.append(kw))

    state = {
        "messages": [SimpleNamespace(content="hi there")],
        "business_id": "bizE",
        "customer_phone": "+60999",
        "draft_reply": "hello!",
        "confidence": 0.95,
        "reasoning": "",
    }
    # just exercise the helper path
    cs._enqueue_from_state(state, action_id="actX")
    assert len(enqueued) == 1
    assert enqueued[0]["business_id"] == "bizE"
    assert enqueued[0]["customer_phone"] == "+60999"
    assert enqueued[0]["buyer_msg"] == "hi there"
    assert enqueued[0]["agent_reply"] == "hello!"


@pytest.mark.asyncio
async def test_enqueue_skipped_when_phone_missing(monkeypatch):
    enqueued = []
    monkeypatch.setattr(cs, "_enqueue_turn_write", lambda **kw: enqueued.append(kw))
    state = {
        "messages": [SimpleNamespace(content="hi")],
        "business_id": "bizE",
        "customer_phone": "",
        "draft_reply": "hello!",
    }
    cs._enqueue_from_state(state, action_id="actX")
    assert enqueued == []
```

- [ ] **Step 2: Run — should fail**

```bash
cd agents && pytest tests/test_graph_memory.py -v
```

- [ ] **Step 3: Add helpers + wire into nodes**

Add to `agents/app/agents/customer_support.py`:

```python
import logging
_log = logging.getLogger(__name__)


def _enqueue_turn_write(*, business_id, customer_phone, buyer_msg, agent_reply, action_id):
    """Wrapped so tests can monkeypatch without importing Celery."""
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return
    try:
        from app.worker.tasks import embed_and_store_turn, embed_past_action
        embed_and_store_turn.delay(
            business_id=business_id,
            customer_phone=customer_phone,
            buyer_msg=buyer_msg,
            agent_reply=agent_reply,
            action_id=action_id,
        )
        embed_past_action.delay(action_id)
    except Exception as e:
        _log.warning("memory enqueue failed: %s", e)


def _enqueue_from_state(state, action_id: str):
    phone = state.get("customer_phone") or ""
    if not phone:
        return
    msg = ""
    if state.get("messages"):
        last = state["messages"][-1]
        if isinstance(last.content, str):
            msg = last.content
    reply = state.get("draft_reply") or ""
    _enqueue_turn_write(
        business_id=state["business_id"],
        customer_phone=phone,
        buyer_msg=msg,
        agent_reply=reply,
        action_id=action_id,
    )
```

Modify `auto_send` node — after `session.commit()` add:

```python
        _enqueue_from_state(state, action_id=action_id)
```

Modify `queue_approval` node — after its `session.commit()` add the same line. (For `queue_approval` the agent reply has not yet been sent, but recording the draft + customer msg is still valid for future retrieval; `embed_past_action` for that action will re-run once the action transitions to APPROVED via router — see Task 19.)

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_graph_memory.py -v
```

- [ ] **Step 5: Commit**

```bash
git add agents/app/agents/customer_support.py agents/tests/test_graph_memory.py
git commit -m "feat(agent): enqueue memory writes from auto_send + queue_approval"
```

---

## Task 19: Router — accept `customer_phone`, re-embed on approve/edit

**Files:**
- Modify: `agents/app/routers/support.py`
- Create: `agents/tests/test_router_memory.py`

- [ ] **Step 1: Write test `agents/tests/test_router_memory.py`**

```python
import pytest
from fastapi.testclient import TestClient
from app.main import app


def test_support_chat_accepts_customer_phone(monkeypatch):
    from app.routers import support as support_router

    captured = {}

    async def fake_ainvoke(state):
        captured.update(state)
        return {
            "action": "auto_send",
            "draft_reply": "hi back",
            "action_id": "act1",
            "confidence": 0.9,
        }

    monkeypatch.setattr(support_router, "_support_graph_ainvoke", fake_ainvoke)

    client = TestClient(app)
    r = client.post("/agent/support/chat", json={
        "business_id": "biz1",
        "customer_id": "c1",
        "customer_phone": "+60123456789",
        "message": "hi",
    })
    assert r.status_code == 200
    assert captured["customer_phone"] == "+60123456789"


def test_support_chat_without_phone_defaults_empty(monkeypatch):
    from app.routers import support as support_router
    captured = {}

    async def fake_ainvoke(state):
        captured.update(state)
        return {"action": "auto_send", "draft_reply": "ok", "action_id": "a", "confidence": 0.9}

    monkeypatch.setattr(support_router, "_support_graph_ainvoke", fake_ainvoke)

    client = TestClient(app)
    r = client.post("/agent/support/chat", json={
        "business_id": "biz1",
        "customer_id": "c1",
        "message": "hi",
    })
    assert r.status_code == 200
    assert captured["customer_phone"] == ""


def test_approve_enqueues_past_action(monkeypatch):
    from app.routers import support as support_router
    from datetime import datetime, timezone
    from app.db import SessionLocal, AgentAction, AgentActionStatus
    import cuid2
    calls = []
    monkeypatch.setattr(support_router, "_enqueue_past_action",
                         lambda action_id: calls.append(action_id))

    aid = cuid2.Cuid().generate()
    with SessionLocal() as s:
        s.add(AgentAction(
            id=aid, businessId="biz1", customerMsg="q", draftReply="d",
            confidence=0.5, reasoning="r", status=AgentActionStatus.PENDING,
            createdAt=datetime.now(timezone.utc),
            updatedAt=datetime.now(timezone.utc),
        ))
        s.commit()

    client = TestClient(app)
    r = client.post(f"/agent/actions/{aid}/approve")
    assert r.status_code == 200
    assert aid in calls
```

- [ ] **Step 2: Run — should fail (fields/helpers missing)**

```bash
cd agents && pytest tests/test_router_memory.py -v
```

- [ ] **Step 3: Modify `agents/app/routers/support.py`**

Change `SupportChatRequest`:

```python
class SupportChatRequest(BaseModel):
    business_id: str
    customer_id: str
    customer_phone: Optional[str] = None
    message: str
```

Add top-level hooks (below imports, outside `make_support_router`):

```python
import logging
_log = logging.getLogger(__name__)


def _enqueue_past_action(action_id: str):
    import os
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return
    try:
        from app.worker.tasks import embed_past_action
        embed_past_action.delay(action_id)
    except Exception as e:
        _log.warning("enqueue past action failed: %s", e)


async def _support_graph_ainvoke(state):
    """Indirection so tests can monkeypatch."""
    raise NotImplementedError("assigned in make_support_router")
```

Inside `make_support_router`, right after the function definition, assign the real invoker:

```python
    global _support_graph_ainvoke
    async def _real_invoke(state):
        return await support_graph.ainvoke(state)
    _support_graph_ainvoke = _real_invoke
```

Change the body of `support_chat`:

```python
    @router.post("/support/chat", response_model=SupportChatResponse)
    async def support_chat(req: SupportChatRequest):
        try:
            result = await _support_graph_ainvoke({
                "messages": [HumanMessage(content=req.message)],
                "business_id": req.business_id,
                "customer_id": req.customer_id,
                "customer_phone": req.customer_phone or "",
                "memory_block": "",
                "business_context": "",
                "draft_reply": "",
                "confidence": 0.0,
                "reasoning": "",
                "action": "queue_approval",
                "action_id": "",
            })
            if result["action"] == "auto_send":
                return SupportChatResponse(
                    status="sent",
                    reply=result["draft_reply"],
                    action_id=result["action_id"],
                    confidence=result["confidence"],
                )
            else:
                return SupportChatResponse(
                    status="pending_approval",
                    action_id=result["action_id"],
                    confidence=result["confidence"],
                )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
```

In `approve_action` and `edit_action`, after `session.commit()` add:

```python
            _enqueue_past_action(action.id)
```

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_router_memory.py -v
```

- [ ] **Step 5: Commit**

```bash
git add agents/app/routers/support.py agents/tests/test_router_memory.py
git commit -m "feat(router): accept customer_phone + enqueue past_action on approve/edit"
```

---

## Task 20: Memory ingest router

**Files:**
- Create: `agents/app/routers/memory.py`
- Modify: `agents/main.py`
- Modify: `agents/tests/test_router_memory.py`

- [ ] **Step 1: Append tests**

```python
def test_reindex_product_endpoint_enqueues(monkeypatch):
    from app.routers import memory as mem_router
    calls = []
    monkeypatch.setattr(mem_router, "_enqueue_product", lambda pid: calls.append(pid))
    client = TestClient(app)
    r = client.post("/memory/product/abc123/reindex")
    assert r.status_code == 202
    assert calls == ["abc123"]


def test_kb_ingest_chunks_and_enqueues(monkeypatch):
    from app.routers import memory as mem_router
    calls = []
    monkeypatch.setattr(mem_router, "_enqueue_kb_chunk",
                         lambda **kw: calls.append(kw))
    client = TestClient(app)
    r = client.post("/memory/kb", json={
        "business_id": "biz1",
        "source_id": "docX",
        "text": "Hello world. " * 300,
    })
    assert r.status_code == 202
    assert len(calls) >= 1
    assert all(c["business_id"] == "biz1" and c["source_id"] == "docX" for c in calls)
```

- [ ] **Step 2: Run — should fail (router missing)**

```bash
cd agents && pytest tests/test_router_memory.py -v
```

- [ ] **Step 3: Create `agents/app/routers/memory.py`**

```python
import os
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.memory.chunker import chunk_text

_log = logging.getLogger(__name__)
router = APIRouter(prefix="/memory", tags=["memory"])


def _memory_enabled() -> bool:
    return os.environ.get("MEMORY_ENABLED", "true").lower() == "true"


def _enqueue_product(product_id: str) -> None:
    if not _memory_enabled():
        return
    try:
        from app.worker.tasks import embed_product
        embed_product.delay(product_id)
    except Exception as e:
        _log.warning("enqueue product failed: %s", e)


def _enqueue_kb_chunk(*, business_id: str, source_id: str, chunk_index: int, content: str) -> None:
    if not _memory_enabled():
        return
    try:
        from app.worker.tasks import embed_kb_chunk
        embed_kb_chunk.delay(
            business_id=business_id,
            source_id=source_id,
            chunk_index=chunk_index,
            content=content,
        )
    except Exception as e:
        _log.warning("enqueue kb chunk failed: %s", e)


class KbIngest(BaseModel):
    business_id: str
    source_id: str
    text: str


@router.post("/product/{product_id}/reindex", status_code=202)
def reindex_product(product_id: str):
    _enqueue_product(product_id)
    return {"status": "queued", "product_id": product_id}


@router.post("/kb", status_code=202)
def ingest_kb(body: KbIngest):
    if not body.text.strip():
        raise HTTPException(400, "text is empty")
    chunks = chunk_text(body.text, target_chars=2000, overlap_chars=200)
    for i, c in enumerate(chunks):
        _enqueue_kb_chunk(business_id=body.business_id, source_id=body.source_id,
                           chunk_index=i, content=c)
    return {"status": "queued", "chunks": len(chunks)}
```

- [ ] **Step 4: Mount in `agents/main.py`**

Add import near the other routers:

```python
from app.routers.memory import router as memory_router
```

Then after `app.include_router(make_support_router(support_graph))` add:

```python
app.include_router(memory_router)
```

- [ ] **Step 5: Run tests — should pass**

```bash
cd agents && pytest tests/test_router_memory.py -v
```

- [ ] **Step 6: Commit**

```bash
git add agents/app/routers/memory.py agents/main.py agents/tests/test_router_memory.py
git commit -m "feat(router): add /memory/product/{id}/reindex + /memory/kb endpoints"
```

---

## Task 21: Feature flag `MEMORY_ENABLED` on read path

**Files:**
- Modify: `agents/app/agents/customer_support.py`
- Modify: `agents/tests/test_graph_memory.py`

- [ ] **Step 1: Append test**

```python
@pytest.mark.asyncio
async def test_memory_disabled_skips_load(monkeypatch):
    monkeypatch.setenv("MEMORY_ENABLED", "false")
    state = {
        "messages": [],
        "business_id": "biz1",
        "customer_phone": "+60111",
    }
    result = await cs._load_memory_node(state)
    assert result["memory_block"] == ""
```

- [ ] **Step 2: Run — should fail**

```bash
cd agents && pytest tests/test_graph_memory.py::test_memory_disabled_skips_load -v
```

- [ ] **Step 3: Guard `_load_memory_node`**

At the top of `_load_memory_node` in `customer_support.py`:

```python
async def _load_memory_node(state: SupportAgentState) -> dict:
    if os.environ.get("MEMORY_ENABLED", "true").lower() != "true":
        return {"memory_block": ""}
    phone = state.get("customer_phone") or ""
    ...
```

- [ ] **Step 4: Run — should pass**

```bash
cd agents && pytest tests/test_graph_memory.py -v
```

- [ ] **Step 5: Commit**

```bash
git add agents/app/agents/customer_support.py agents/tests/test_graph_memory.py
git commit -m "feat(agent): honor MEMORY_ENABLED=false on load_memory"
```

---

## Task 22: Phone normalization helper

**Files:**
- Create: `agents/app/memory/phone.py`
- Create: `agents/tests/test_phone.py`
- Modify: `agents/app/routers/support.py`

- [ ] **Step 1: Write failing test `agents/tests/test_phone.py`**

```python
from app.memory.phone import normalize_phone


def test_normalize_local_my():
    assert normalize_phone("0123456789", region="MY") == "+60123456789"


def test_normalize_already_e164():
    assert normalize_phone("+60123456789") == "+60123456789"


def test_normalize_with_spaces():
    assert normalize_phone("012-345 6789", region="MY") == "+60123456789"


def test_normalize_invalid_returns_empty():
    assert normalize_phone("not a phone") == ""


def test_normalize_empty_returns_empty():
    assert normalize_phone("") == ""
    assert normalize_phone(None) == ""
```

- [ ] **Step 2: Run — should fail**

```bash
cd agents && pytest tests/test_phone.py -v
```

- [ ] **Step 3: Implement `agents/app/memory/phone.py`**

```python
import phonenumbers


def normalize_phone(raw, region: str = "MY") -> str:
    if not raw:
        return ""
    try:
        parsed = phonenumbers.parse(raw, region)
    except phonenumbers.NumberParseException:
        return ""
    if not phonenumbers.is_valid_number(parsed):
        return ""
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
```

- [ ] **Step 4: Apply in `support_chat` handler**

In `agents/app/routers/support.py`, modify the body to normalize:

```python
from app.memory.phone import normalize_phone
```

```python
            "customer_phone": normalize_phone(req.customer_phone) if req.customer_phone else "",
```

- [ ] **Step 5: Run all tests**

```bash
cd agents && pytest -v
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add agents/app/memory/phone.py agents/tests/test_phone.py agents/app/routers/support.py
git commit -m "feat(memory): add phone normalization + apply in support_chat"
```

---

## Task 23: TS app — trigger reindex on product mutation

**Files:**
- Modify: `app/src/...` — find the product create/update handler

- [ ] **Step 1: Locate product mutation handler**

```bash
cd app && grep -rn "product.create\|product.update\|Product.create\|Product.update" src/ | head
```

Identify the tRPC/route handler that creates or updates a product. (Typically `src/integrations/trpc/routers/product.ts` or similar.)

- [ ] **Step 2: Add reindex fire-and-forget call**

In each product create/update handler, after the Prisma write succeeds, call:

```typescript
// fire-and-forget reindex; do not block the response
const agentsUrl = process.env.AGENTS_URL ?? "http://localhost:8000";
fetch(`${agentsUrl}/memory/product/${product.id}/reindex`, { method: "POST" })
  .catch((err) => console.warn("reindex enqueue failed", err));
```

Use the exact product id variable the handler produces.

- [ ] **Step 3: Add `AGENTS_URL` to `.env.example` in `app/`**

Append:

```
AGENTS_URL=http://localhost:8000
```

- [ ] **Step 4: Smoke**

Start FastAPI + worker + RabbitMQ. Create a product via the TS app UI or direct tRPC call. Verify in FastAPI logs a POST to `/memory/product/{id}/reindex`, and after a few seconds a row in `memory_product_embedding`:

```bash
psql "$DATABASE_URL" -c "SELECT \"productId\", LEFT(content, 60) FROM memory_product_embedding;"
```

- [ ] **Step 5: Commit**

```bash
git add app/src app/.env.example
git commit -m "feat(app): call agents /memory/product/{id}/reindex on product mutation"
```

---

## Task 24: Run docs + smoke script

**Files:**
- Create: `agents/scripts/smoke_memory.py`
- Modify: `agents/README.md`

- [ ] **Step 1: Create `agents/scripts/smoke_memory.py`**

```python
"""End-to-end smoke for agent memory.

Assumes: DATABASE_URL set, RabbitMQ running, Celery worker running, FastAPI running on :8000.
Seeds a business + product + KB doc, sends two chat messages from one phone,
prints recovered rows.
"""
import os, time, json
import httpx
import cuid2

BASE = os.environ.get("AGENTS_URL", "http://localhost:8000")
PHONE = "+60123456789"


def main():
    # 1. seed business via SQL (bypass auth)
    from sqlalchemy import create_engine, text
    eng = create_engine(os.environ["DATABASE_URL"])
    biz_id = cuid2.Cuid().generate()
    prod_id = cuid2.Cuid().generate()
    with eng.begin() as c:
        c.execute(text("INSERT INTO business (id, name, code, \"userId\", \"createdAt\", \"updatedAt\") "
                        "VALUES (:id, :n, :code, :uid, NOW(), NOW()) ON CONFLICT DO NOTHING"),
                   {"id": biz_id, "n": "Smoke Biz", "code": f"SMK{biz_id[:4]}", "uid": "smoke-user"})
        c.execute(text("INSERT INTO product (id, name, price, stock, description, \"businessId\", \"createdAt\", \"updatedAt\") "
                        "VALUES (:id, :n, 10, 5, 'smoke product', :b, NOW(), NOW()) "
                        "ON CONFLICT DO NOTHING"),
                   {"id": prod_id, "n": "Sambal Smoke", "b": biz_id})

    # 2. KB ingest
    httpx.post(f"{BASE}/memory/kb", json={
        "business_id": biz_id,
        "source_id": "smoke-doc",
        "text": "We ship KL same day before 2pm. Outside KL 2-3 days.",
    }).raise_for_status()

    # 3. reindex product
    httpx.post(f"{BASE}/memory/product/{prod_id}/reindex").raise_for_status()

    # 4. chat msg 1
    r1 = httpx.post(f"{BASE}/agent/support/chat", json={
        "business_id": biz_id,
        "customer_id": "smoke-c",
        "customer_phone": PHONE,
        "message": "Boleh ship KL esok?",
    }, timeout=60).json()
    print("msg1:", json.dumps(r1, indent=2))

    # 5. wait for worker
    time.sleep(5)

    # 6. chat msg 2
    r2 = httpx.post(f"{BASE}/agent/support/chat", json={
        "business_id": biz_id,
        "customer_id": "smoke-c",
        "customer_phone": PHONE,
        "message": "Nak order 2 botol.",
    }, timeout=60).json()
    print("msg2:", json.dumps(r2, indent=2))

    # 7. dump memory rows
    time.sleep(3)
    with eng.begin() as c:
        turns = c.execute(text("SELECT \"buyerMsg\", \"agentReply\" FROM memory_conversation_turn "
                                 "WHERE \"customerPhone\" = :p ORDER BY \"turnAt\" ASC"),
                            {"p": PHONE}).all()
        kb = c.execute(text("SELECT LEFT(content, 60) FROM memory_kb_chunk "
                              "WHERE \"businessId\" = :b"), {"b": biz_id}).all()
        prod = c.execute(text("SELECT content FROM memory_product_embedding "
                                "WHERE \"productId\" = :p"), {"p": prod_id}).all()

    print("turns:", turns)
    print("kb rows:", kb)
    print("product rows:", prod)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Append to `agents/README.md`**

Add a "Running memory" section:

```markdown
## Running with memory enabled

Prereqs:
- Postgres running, `pgvector` extension enabled
- `DATABASE_URL` exported
- RabbitMQ running on `localhost:5672` (see Task 0 for docker command)
- `alembic upgrade head` run once
- `python scripts/preload_embedder.py` run once (downloads bge-m3)

Three processes:

```bash
# Terminal 1 — API
uvicorn main:app --reload

# Terminal 2 — Celery worker
celery -A app.worker.celery_app worker --loglevel=info --concurrency=2 -Q memory

# Terminal 3 — Celery beat (periodic summarizer)
celery -A app.worker.celery_app beat --loglevel=info
```

Smoke test:

```bash
python scripts/smoke_memory.py
```
```

- [ ] **Step 3: Commit**

```bash
git add agents/scripts/smoke_memory.py agents/README.md
git commit -m "docs(agents): add memory run instructions + smoke script"
```

---

## Task 25: Full test + manual smoke

- [ ] **Step 1: Run full test suite**

```bash
cd agents && pytest -v
```

Expected: all tests pass.

- [ ] **Step 2: Start services**

Three terminals as documented in `agents/README.md`. Verify:
- API: `curl http://localhost:8000/health` → `{"status":"ok"}`
- Worker: log shows `celery@... ready.`
- Beat: log shows beat scheduler started, next tick listed

- [ ] **Step 3: Run smoke**

```bash
cd agents && python scripts/smoke_memory.py
```

Expected: two chat responses printed, then turns/kb/product rows listed (2 turns, ≥1 kb row, 1 product row).

- [ ] **Step 4: Verify continuity**

Second message response should reference first message context (e.g. acknowledge earlier shipping question) or use KB content about KL shipping.

- [ ] **Step 5: Verify beat summarizer (optional, longer run)**

Manually insert 22 backdated turns (2 hours old), then trigger the task synchronously:

```bash
cd agents && python -c "from app.worker.tasks import summarize_old_turns; summarize_old_turns()"
```

```bash
psql "$DATABASE_URL" -c "SELECT LEFT(summary, 80), \"coversFromTurnAt\" FROM memory_conversation_summary;"
```

Expected: 1 summary row covering the oldest ~20 turns.

- [ ] **Step 6: Final commit (if any doc fixes)**

```bash
git status
# if clean: done. Otherwise commit any cleanups.
```

---

## Done

All memory features implemented, tested, and smoke-verified. Rollback by setting `MEMORY_ENABLED=false` (disables read-path injection + write enqueues) or `alembic downgrade base` (drops tables).
