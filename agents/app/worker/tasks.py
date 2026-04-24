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
