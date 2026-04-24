# Agents — LangGraph + FastAPI

## Structure

```
agents/
├── main.py                   # FastAPI app entrypoint
├── requirements.txt
├── .env.example
└── app/
    ├── agents/
    │   ├── base.py           # Simple chat agent (StateGraph)
    │   └── example.py        # Tool-calling research agent
    └── routers/
        └── agent.py          # POST /agent/chat endpoint
```

## Setup

```bash
cd agents
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Fill in OPENAI_API_KEY (or ANTHROPIC_API_KEY)
```

## Run

```bash
uvicorn main:app --reload --port 8000
```

API docs at `http://localhost:8000/docs`

---

## API

### `POST /agent/chat`

Send a message and get a reply.

**Request**
```json
{ "message": "What is the capital of France?" }
```

**Response**
```json
{ "reply": "The capital of France is Paris." }
```

**cURL**
```bash
curl -X POST http://localhost:8000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

### `GET /health`

Returns `{"status": "ok"}`.

---

## How LangGraph works here

### State

Every agent owns a `State` TypedDict. Nodes read from it and return partial updates.

```python
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
```

`add_messages` is a **reducer** — it appends new messages instead of replacing the list.

### Graph

```
START → model → END
```

`model` calls the LLM and returns `{"messages": [response]}`. The reducer appends it to state.

### Compile → invoke

```python
graph = StateGraph(AgentState)
graph.add_node("model", call_model)
graph.add_edge(START, "model")
graph.add_edge("model", END)
compiled = graph.compile()

result = compiled.invoke({"messages": [HumanMessage(content="Hi")]})
```

---

## Adding a new agent

1. Create `app/agents/my_agent.py`:

```python
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class MyState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    # add any extra fields you need


def build_my_agent(llm):
    def my_node(state: MyState) -> dict:
        # do work, return partial state update
        response = llm.invoke(state["messages"])
        return {"messages": [response]}

    graph = StateGraph(MyState)
    graph.add_node("my_node", my_node)
    graph.add_edge(START, "my_node")
    graph.add_edge("my_node", END)
    return graph.compile()
```

2. Wire it up in `main.py`:

```python
from app.agents.my_agent import build_my_agent
graph = build_my_agent(llm)
```

---

## Tool-calling agent

`app/agents/example.py` shows an agent that loops — it calls tools until the LLM stops emitting `tool_calls`.

```
START → model → (has tool_calls?) → tools → model → ... → END
```

Replace the `search` stub with a real implementation (Tavily, SerpAPI, etc.):

```python
@tool
def search(query: str) -> str:
    """Search the web."""
    # call your search API here
    return results
```

Switch to this agent in `main.py`:

```python
from app.agents.example import build_research_agent
graph = build_research_agent(llm)
```

---

## Swap LLM provider

**Anthropic (Claude)**
```python
from langchain_anthropic import ChatAnthropic
llm = ChatAnthropic(model="claude-sonnet-4-6")
```

**OpenAI (default)**
```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(model="gpt-4o-mini")
```

The agent code doesn't change — only `main.py`.

## Memory setup (pgvector + RabbitMQ)

### Prerequisites

RabbitMQ broker (for Celery):

```bash
docker run -d --name pisang-rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

Management UI at http://localhost:15672 (guest/guest).

Enable pgvector extension on the Postgres database (one-time, requires superuser):

```bash
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Verify:

```bash
psql "$DATABASE_URL" -c "\dx vector"
```

## Running with memory enabled

Prereqs:
- Postgres running, `pgvector` extension enabled
- `DATABASE_URL` exported
- RabbitMQ running on `localhost:5672` (see earlier memory-setup section)
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

