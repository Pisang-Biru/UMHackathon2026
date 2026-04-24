from app.worker.celery_app import celery
from app.db import SessionLocal, Product
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


@celery.task(bind=True, max_retries=3, default_retry_delay=30)
def embed_product(self, product_id: str):
    try:
        with SessionLocal() as session:
            p = session.query(Product).filter(Product.id == product_id).first()
            if not p:
                return
            content = f"{p.name} — {p.description or ''} — RM{float(p.price):.2f}"
            vec = embed([content])[0]
            repo.upsert_product_embedding(session, p.id, p.businessId, content, vec)
            session.commit()
    except Exception as e:
        raise self.retry(exc=e)


@celery.task(bind=True, max_retries=3, default_retry_delay=30)
def embed_kb_chunk(self, business_id: str, source_id: str, chunk_index: int, content: str):
    try:
        vec = embed([content])[0]
        with SessionLocal() as session:
            repo.insert_kb_chunk(session, business_id, source_id, chunk_index, content, vec)
            session.commit()
    except Exception as e:
        raise self.retry(exc=e)


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


import os
from sqlalchemy import select, func
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage


def _llm_summarize(turns) -> str:
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
        from app.memory.models import MemoryConversationTurn as T

        pairs = session.execute(
            select(T.businessId, T.customerPhone, func.count(T.id))
            .where(T.summarized == False)  # noqa: E712
            .group_by(T.businessId, T.customerPhone)
            .having(func.count(T.id) > recent_keep)
        ).all()

        for business_id, phone, _cnt in pairs:
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
