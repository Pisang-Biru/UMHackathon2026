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


_MEMORY_TABLES = (
    "memory_past_action",
    "memory_product_embedding",
    "memory_kb_chunk",
    "memory_conversation_summary",
    "memory_conversation_turn",
    "agent_action",
    "product",
)


@pytest.fixture(scope="session", autouse=True)
def bootstrap_fk_rows(engine):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
            VALUES ('test-user', 'Test User', 'test@example.com', false, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """))
        conn.execute(text("""
            INSERT INTO business (id, name, code, "userId", "createdAt", "updatedAt")
            VALUES ('biz1', 'Test Biz', 'TEST-BIZ-001', 'test-user', NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """))


@pytest.fixture()
def session(engine):
    with engine.begin() as conn:
        for t in _MEMORY_TABLES:
            conn.execute(text(f'TRUNCATE TABLE "{t}" RESTART IDENTITY CASCADE'))
    Session = sessionmaker(bind=engine)
    with Session() as s:
        yield s
        s.rollback()
