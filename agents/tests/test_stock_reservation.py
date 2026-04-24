import os
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

from app.db import Product, Order, OrderStatus
from app.worker.celery_app import celery
from app.worker import tasks
from app.agents import customer_support


@pytest.fixture(autouse=True)
def eager_celery():
    celery.conf.task_always_eager = True
    celery.conf.task_eager_propagates = True
    yield
    celery.conf.task_always_eager = False


@pytest.fixture
def TestSession(engine, session):
    # `session` fixture truncates tables between tests
    return sessionmaker(bind=engine)


def _seed_product(TestSession, stock=5, pid="prod-stock-1"):
    with TestSession() as s:
        s.add(Product(id=pid, name="Sambal", price=10.0, stock=stock,
                      description="hot", businessId="biz1"))
        s.commit()
    return pid


def test_create_order_reserves_stock(TestSession, monkeypatch):
    pid = _seed_product(TestSession, stock=5)
    monkeypatch.setattr(customer_support, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.1] * 1024 for _ in texts])

    order_id = customer_support._create_order("biz1", pid, qty=2)

    with TestSession() as s:
        p = s.query(Product).filter_by(id=pid).first()
        assert p.stock == 3
        o = s.query(Order).filter_by(id=order_id).first()
        assert o is not None
        assert o.status == OrderStatus.PENDING_PAYMENT
        assert o.qty == 2


def test_create_order_rejects_oversell(TestSession, monkeypatch):
    pid = _seed_product(TestSession, stock=2)
    monkeypatch.setattr(customer_support, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.1] * 1024 for _ in texts])

    with pytest.raises(ValueError, match="Insufficient stock"):
        customer_support._create_order("biz1", pid, qty=5)

    with TestSession() as s:
        p = s.query(Product).filter_by(id=pid).first()
        assert p.stock == 2
        assert s.query(Order).count() == 0


def test_create_order_rejects_non_positive_qty(TestSession, monkeypatch):
    pid = _seed_product(TestSession, stock=5)
    monkeypatch.setattr(customer_support, "SessionLocal", TestSession)

    with pytest.raises(ValueError, match="qty must be positive"):
        customer_support._create_order("biz1", pid, qty=0)


def test_expire_pending_orders_cancels_and_restores(TestSession, monkeypatch):
    pid = _seed_product(TestSession, stock=3)
    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.1] * 1024 for _ in texts])
    os.environ["ORDER_EXPIRY_MINUTES"] = "30"

    stale_created = datetime.now(timezone.utc) - timedelta(minutes=45)
    recent_created = datetime.now(timezone.utc) - timedelta(minutes=5)

    with TestSession() as s:
        # reserve 2 stale + 1 recent
        s.query(Product).filter_by(id=pid).update({Product.stock: Product.stock - 3})
        s.add(Order(id="stale-1", businessId="biz1", productId=pid, agentType="support",
                    qty=2, unitPrice=10.0, totalAmount=20.0,
                    status=OrderStatus.PENDING_PAYMENT, createdAt=stale_created))
        s.add(Order(id="recent-1", businessId="biz1", productId=pid, agentType="support",
                    qty=1, unitPrice=10.0, totalAmount=10.0,
                    status=OrderStatus.PENDING_PAYMENT, createdAt=recent_created))
        s.commit()

    tasks.expire_pending_orders()

    with TestSession() as s:
        stale = s.query(Order).filter_by(id="stale-1").first()
        recent = s.query(Order).filter_by(id="recent-1").first()
        p = s.query(Product).filter_by(id=pid).first()
        assert stale.status == OrderStatus.CANCELLED
        assert recent.status == OrderStatus.PENDING_PAYMENT
        # stock was 0 after reserving 3, stale restored 2 → 2, recent still reserved
        assert p.stock == 2


def test_expire_pending_orders_skips_paid(TestSession, monkeypatch):
    pid = _seed_product(TestSession, stock=3)
    monkeypatch.setattr(tasks, "SessionLocal", TestSession)
    monkeypatch.setattr(tasks, "embed", lambda texts: [[0.1] * 1024 for _ in texts])

    old = datetime.now(timezone.utc) - timedelta(hours=2)
    with TestSession() as s:
        s.query(Product).filter_by(id=pid).update({Product.stock: Product.stock - 1})
        s.add(Order(id="paid-1", businessId="biz1", productId=pid, agentType="support",
                    qty=1, unitPrice=10.0, totalAmount=10.0,
                    status=OrderStatus.PAID, createdAt=old))
        s.commit()

    tasks.expire_pending_orders()

    with TestSession() as s:
        o = s.query(Order).filter_by(id="paid-1").first()
        p = s.query(Product).filter_by(id=pid).first()
        assert o.status == OrderStatus.PAID
        assert p.stock == 2
