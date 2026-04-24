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
)


@pytest.fixture()
def session(engine):
    with engine.begin() as conn:
        for t in _MEMORY_TABLES:
            conn.execute(text(f'TRUNCATE TABLE "{t}" RESTART IDENTITY CASCADE'))
    Session = sessionmaker(bind=engine)
    with Session() as s:
        yield s
        s.rollback()
