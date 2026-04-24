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

_MANAGER_ENABLED = _os_for_flag.environ.get("MANAGER_ENABLED", "false").lower() == "true"

if _MANAGER_ENABLED:
    active_graph = _build_manager_graph(jual_llm=llm, manager_llm=llm)
else:
    active_graph = support_graph

app = FastAPI(title="LangGraph Agents API", version="0.1.0")
app.include_router(make_agent_router(chat_graph))
app.include_router(make_support_router(active_graph))
app.include_router(memory_router)


@app.get("/health")
def health():
    return {"status": "ok"}
