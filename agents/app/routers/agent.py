from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from langchain_core.messages import HumanMessage

router = APIRouter(prefix="/agent", tags=["agent"])


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


class ChatResponse(BaseModel):
    reply: str


def _make_router(graph):
    """Return a FastAPI router bound to a compiled LangGraph graph."""

    @router.post("/chat", response_model=ChatResponse)
    async def chat(req: ChatRequest):
        try:
            messages = [HumanMessage(content=req.message)]
            result = await graph.ainvoke({"messages": messages})
            last = result["messages"][-1]
            return ChatResponse(reply=last.content)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return router


def make_agent_router(graph):
    _make_router(graph)
    return router
