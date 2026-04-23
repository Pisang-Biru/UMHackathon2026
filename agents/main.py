from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from langchain_openai import ChatOpenAI
from app.agents.base import build_chat_agent
from app.agents.customer_support import build_customer_support_agent
from app.routers.agent import make_agent_router
from app.routers.support import make_support_router

llm = ChatOpenAI(
    model="ilmu-glm-5.1",
    openai_api_key=os.getenv("ZAI_API_KEY"),
    openai_api_base="https://api.ilmu.ai/v1/",
    temperature=0.6,
)

chat_graph = build_chat_agent(llm)
support_graph = build_customer_support_agent(llm)

app = FastAPI(title="LangGraph Agents API", version="0.1.0")
app.include_router(make_agent_router(chat_graph))
app.include_router(make_support_router(support_graph))


@app.get("/health")
def health():
    return {"status": "ok"}
