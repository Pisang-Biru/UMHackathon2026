from decimal import Decimal
from app.db import Product, Order
from app.agents.customer_support import _create_order


def _seed_product(session, product_id="p1", stock=100, price=Decimal("5.00")):
    session.add(Product(
        id=product_id,
        businessId="biz1",
        name="Pisang",
        price=price,
        stock=stock,
    ))
    session.commit()


def test_create_order_persists_buyer_contact(session):
    _seed_product(session)
    order_id = _create_order("biz1", "p1", 3, buyer_contact="+60123456789")
    row = session.query(Order).filter(Order.id == order_id).one()
    assert row.buyerContact == "+60123456789"
    assert row.qty == 3
    assert row.businessId == "biz1"
