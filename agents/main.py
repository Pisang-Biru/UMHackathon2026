from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from langchain_openai import ChatOpenAI
from app.agents.base import build_chat_agent
from app.routers.agent import make_agent_router

llm = ChatOpenAI(
    model="glm-5.1",
    openai_api_key=os.getenv("ZAI_API_KEY"),
    openai_api_base="https://api.z.ai/api/paas/v4/",
    temperature=0.6,
)

graph = build_chat_agent(llm)

app = FastAPI(title="LangGraph Agents API", version="0.1.0")
app.include_router(make_agent_router(graph))


@app.get("/health")
def health():
    return {"status": "ok"}
