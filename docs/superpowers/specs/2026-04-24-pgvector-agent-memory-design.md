# pgvector Agent Memory — Design

**Date:** 2026-04-24
**Status:** Approved, pending implementation plan

## Goal

Add persistent semantic memory to the customer support agent so it can recall:

- **A.** Per-customer conversation history (keyed by WhatsApp/phone)
- **B.** Business knowledge base (owner-uploaded FAQ / policy docs)
- **C.** Product semantic search (fuzzy buyer queries match product catalog)
- **D.** Past resolved `agent_action` rows (few-shot style recall)

## Stack decisions

| Decision | Choice | Reason |
|---|---|---|
| Memory scope | All four types (A+B+C+D) | User-specified |
| Customer identity | Phone / WhatsApp number (E.164) | Matches messaging channel |
| Embedding model | `BAAI/bge-m3` via `sentence-transformers` | Multilingual (Malay+English), 1024 dim, free/local |
| Write strategy | Celery worker + RabbitMQ broker | Robust async, reprocessable, no result backend needed |
| Retrieval | Hybrid: conversation pre-injected, KB/product/past-action as tool | Always-useful pre-fetch + agentic on-demand |
| Schema ownership | SQLAlchemy only (+ Alembic) | `pgvector-python` is first-class on SQLAlchemy; Prisma unaware |
| Conversation granularity | Per-turn raw (last 20) + rolling summary older | Best recall/cost tradeoff |

## Architecture

**New components**

1. `pgvector` extension on existing Postgres
2. `agents/app/memory/` — `embedder.py` (bge-m3 singleton), `repo.py` (SQLAlchemy + vector search), `models.py`, `chunker.py`
3. `agents/app/worker/` — Celery app + tasks + beat schedule
4. RabbitMQ broker (`docker run -d --name pisang-rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management`)
5. New LangGraph node `load_memory` (before `draft_reply`)
6. New tool `search_memory(query, kind)` bound alongside `create_payment_link`
7. New FastAPI endpoints: `POST /memory/product/{id}/reindex`, `POST /memory/kb`

**Deps added**

`pgvector==0.3.6`, `sentence-transformers==3.3.1`, `celery==5.4.0`, `kombu[amqp]`, `alembic==1.14.0`, `phonenumbers==8.13.50`

**Env vars**

```
CELERY_BROKER_URL=amqp://guest:guest@localhost:5672//
EMBED_MODEL=BAAI/bge-m3
MEMORY_RECENT_TURNS=20
MEMORY_SUMMARY_BATCH=20
MEMORY_ENABLED=true
```

## Data flow

### Read — user message arrives

```
router → graph → load_context
               → load_memory        # fetch recent 20 turns + top-3 summaries by cosine
               → draft_reply        # tools: create_payment_link, search_memory
               → route_decision
               → auto_send OR queue_approval
               → END
               → enqueue embed_and_store_turn (Celery)
```

### Write — async via Celery

```
Celery worker → embedder.embed(text) → INSERT into memory table
```

## Schema (SQLAlchemy, vector dim=1024, HNSW cosine index)

### `memory_conversation_turn` (type A)

```
id: str                     pk (cuid)
businessId: str             idx
customerPhone: str          idx   # normalized E.164
buyerMsg: Text
agentReply: Text
turnAt: DateTime            idx
embedding: Vector(1024)           # embed(buyer_msg + "\n" + agent_reply)
summarized: bool            default False
```

### `memory_conversation_summary` (type A, rolling)

```
id: str                     pk
businessId: str             idx
customerPhone: str          idx
summary: Text                     # LLM-generated ~200 tok
coversFromTurnAt: DateTime
coversToTurnAt: DateTime
embedding: Vector(1024)
createdAt: DateTime
```

### `memory_kb_chunk` (type B)

```
id: str                     pk
businessId: str             idx
sourceId: str               idx
chunkIndex: int
content: Text                     # ~500 tok chunk, 50 tok overlap
embedding: Vector(1024)
createdAt: DateTime
```

### `memory_product_embedding` (type C)

```
productId: str              pk    # logical FK to Prisma-owned product table
businessId: str             idx
content: Text                     # "name — description — RMprice"
embedding: Vector(1024)
updatedAt: DateTime
```

### `memory_past_action` (type D)

```
id: str                     pk    # = agent_action.id
businessId: str             idx
customerMsg: Text
finalReply: Text
embedding: Vector(1024)           # embed(customer_msg)
createdAt: DateTime
```

### Indexes

```sql
CREATE INDEX ON memory_conversation_turn       USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON memory_conversation_summary    USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON memory_kb_chunk                USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON memory_product_embedding       USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON memory_past_action             USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON memory_conversation_turn (businessId, customerPhone, turnAt DESC);
```

## Retrieval tuning

| Memory | K | min_sim | Mode |
|---|---|---|---|
| Recent turns | 20 | — | `turnAt DESC` (no vector) |
| Summaries | 3 | 0.5 | auto-inject via `load_memory` |
| KB | 5 | 0.6 | on-demand via `search_memory` tool |
| Products | 5 | 0.5 | on-demand via `search_memory` tool |
| Past actions | 3 | 0.7 | on-demand via `search_memory` tool |

`SET LOCAL hnsw.ef_search = 40;` per connection (default). Embeddings normalized → cosine ≈ dot.

## Prompt format

Appended to existing `SYSTEM_TEMPLATE`:

```
--- Past conversation with this buyer (phone {phone_masked}) ---
{recent_turns_block}

--- Relevant older context ---
{summaries_block}
---

Use this history to maintain continuity. Do not re-ask info buyer already gave.
If no history, say nothing about "past conversation" — just answer fresh.
```

Missing phone → both blocks replaced with `"(No prior history — first contact)"`.

## `search_memory` tool result format

```
Found N results (kind={kind}):
1. [sim=0.82] {content}
2. [sim=0.71] {content}
...
```

Similarity exposed to let LLM calibrate trust.

## Celery config

```python
celery = Celery("pisang_agents", broker=CELERY_BROKER_URL, include=["app.worker.tasks"])
celery.conf.update(
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_default_queue="memory",
    beat_schedule={
        "summarize-old-turns": {
            "task": "app.worker.tasks.summarize_old_turns",
            "schedule": 3600.0,
        },
    },
)
```

### Tasks

- `embed_and_store_turn(business_id, customer_phone, buyer_msg, agent_reply, action_id)`
- `embed_product(product_id)` — upsert by pk
- `embed_kb_chunk(business_id, source_id, chunk_index, content)`
- `embed_past_action(action_id)` — upsert by pk
- `summarize_old_turns()` — beat-scheduled hourly

All tasks `bind=True, max_retries=3, default_retry_delay=30`.

### Run commands

```bash
cd agents && celery -A app.worker.celery_app worker --loglevel=info --concurrency=2 -Q memory
cd agents && celery -A app.worker.celery_app beat --loglevel=info
```

FastAPI process only calls `.delay()` — model is not loaded in API process.

## Embedder

```python
# agents/app/memory/embedder.py
from sentence_transformers import SentenceTransformer

_model = None

def _get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer(os.environ.get("EMBED_MODEL", "BAAI/bge-m3"))
    return _model

def embed(texts: list[str]) -> list[list[float]]:
    return _get_model().encode(texts, normalize_embeddings=True).tolist()
```

~2GB per worker process. Dev: `--concurrency=2`.

## Error handling

| Failure | Behavior |
|---|---|
| `CREATE EXTENSION vector` needs superuser | Doc + startup warning if ext missing |
| Model download fails on first run | Pre-download step in setup; Celery retries |
| RabbitMQ down from FastAPI | Wrap `.delay()` in try/except, log, agent reply still sent |
| RabbitMQ down from worker | Celery auto-reconnect |
| No rows above threshold | Empty block / `"No results"` — agent proceeds |
| Phone missing | Skip memory read + write, graph runs normally |
| Dim mismatch on model swap | Schema pinned at `Vector(1024)` — require migration |
| Summarizer LLM fails | Retry 3× backoff, next hour retries again |
| Duplicate product/action embed | Upsert on pk — idempotent |

## Router contract change

Customer support endpoint must accept `customer_phone` in request body; forward into `SupportAgentState`. TS caller (inbox route) updated to pass phone from WhatsApp webhook payload. `None` permitted — agent degrades gracefully.

## Migration plan (sequenced)

1. **Infra**: RabbitMQ container + `CREATE EXTENSION vector;`
2. **Deps** added to `requirements.txt`; pre-download bge-m3
3. **Alembic init** under `agents/alembic/`, first migration creates 5 tables + indexes
4. **Memory module** (`embedder`, `repo`, `models`, `chunker`) + unit tests
5. **Celery worker** + tasks + integration tests (`CELERY_TASK_ALWAYS_EAGER=True`)
6. **Graph wiring**: add `customer_phone` to state, `load_memory` node, `search_memory` tool, enqueue writes from `auto_send`/`queue_approval`
7. **Indexing endpoints**: `POST /memory/product/{id}/reindex`, `POST /memory/kb`; hook TS app product mutations to reindex endpoint
8. **Beat**: enable hourly `summarize_old_turns`
9. **Smoke**: seed → 25-turn conversation → verify summaries + retrieval

## Rollback

All changes additive. Disable via `MEMORY_ENABLED=false` (skips `load_memory` node + skips enqueues). Alembic downgrade drops memory tables. Existing `agent_action` / `order` flows unaffected.

## Testing

### Unit

- `embedder`: 1024-dim output, deterministic, distinct texts → sim < 1.0
- `repo`: insert+fetch ordering, semantic ranking on fixtures, threshold filter, upsert idempotency
- `chunker`: overlap preserved, sentence boundaries, empty input

### Integration (eager Celery)

- `embed_and_store_turn.delay()` → row with correct embedding
- `embed_product.delay()` for missing product → retries then dead-letters (API not crashed)
- `summarize_old_turns` with 25 fixtures → 1 summary, 20 oldest marked `summarized=True`

### Graph (mocked LLM)

- First msg from phone X → empty memory block
- 4th msg from phone X → prior 3 turns in block
- Missing phone → runs end-to-end, no memory I/O, no error
- Tool call `search_memory("shipping", "kb")` → seeded chunk returned

### E2E smoke (manual)

1. Start pg+vector, rabbitmq, worker, beat, FastAPI
2. Seed 1 business, 3 products, 1 KB doc
3. Two msgs from `+60123456789` — verify continuity + KB retrieval
4. 22 backdated turns + manual beat trigger → summary appears

### Regression guards

- Existing customer_support tests pass with `MEMORY_ENABLED=false`
- `MEMORY_ENABLED=true` + rabbitmq down → 200 response, enqueue-fail logged

### Perf sanity (not a load test)

- bge-m3 cold encode: <3s
- Warm single encode: <50ms
- Vector search on 10k rows: <20ms p95

## Non-goals

- Multi-agent memory sharing (only customer_support for now)
- UI for owners to view/edit/delete memories
- Cross-business memory
- GDPR/PDPA-style buyer memory erasure API (future work)
- GPU-accelerated embedding
- Re-ranking with cross-encoder
