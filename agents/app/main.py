from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from langchain_openai import ChatOpenAI
from app.agents.base import build_chat_agent
from app.agents.customer_support import build_customer_support_agent
from app.routers.agent import make_agent_router
from app.routers.support import make_support_router
from app.routers.memory import router as memory_router

llm = ChatOpenAI(
    model=os.getenv("MODEL"),
    openai_api_key=os.getenv("API_KEY"),
    openai_api_base=os.getenv("OPENAI_API_BASE"),
    temperature=0.6,
)

chat_graph = build_chat_agent(llm)
support_graph = build_customer_support_agent(llm)

import os as _os_for_flag
from app.agents.manager import build_manager_graph as _build_manager_graph

# MANAGER_ENABLED is read once at import time. Flipping the env var
# requires restarting the agents process (docker compose restart).
_MANAGER_ENABLED = _os_for_flag.environ.get("MANAGER_ENABLED", "false").lower() == "true"

if _MANAGER_ENABLED:
    active_graph = _build_manager_graph(jual_llm=llm, manager_llm=llm)
else:
    active_graph = support_graph

app = FastAPI(title="LangGraph Agents API", version="0.1.0")

from fastapi.middleware.cors import CORSMiddleware

# Dev convenience: allow the local Vite frontend to call us directly.
# Production should pin the exact origin instead of "*".
_DEV_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEV_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

from app.agents.registry import upsert_registry


@app.on_event("startup")
def _boot_registry() -> None:
    try:
        upsert_registry()
    except Exception:
        import logging
        logging.getLogger(__name__).exception("registry upsert failed")


app.include_router(make_agent_router(chat_graph))
app.include_router(make_support_router(active_graph))
app.include_router(memory_router)

from app.routers.events import router as events_router
app.include_router(events_router)


@app.get("/health")
def health():
    return {"status": "ok"}
