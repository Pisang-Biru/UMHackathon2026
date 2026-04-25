from decimal import Decimal
from app.db import Product, Business, Order, FinanceAlert, MarginStatus, FinanceAlertKind


def test_product_has_cost_columns():
    cols = {c.name for c in Product.__table__.columns}
    assert "cogs" in cols
    assert "packagingCost" in cols


def test_business_has_fee_columns():
    cols = {c.name for c in Business.__table__.columns}
    assert "platformFeePct" in cols
    assert "defaultTransportCost" in cols


def test_order_has_margin_columns():
    cols = {c.name for c in Order.__table__.columns}
    assert "transportCost" in cols
    assert "realMargin" in cols
    assert "marginStatus" in cols


def test_finance_alert_table_shape():
    cols = {c.name for c in FinanceAlert.__table__.columns}
    assert {"id", "businessId", "orderId", "productId", "kind",
            "marginValue", "message", "resolvedAt", "createdAt",
            "updatedAt"} <= cols


def test_margin_status_enum_values():
    assert {e.value for e in MarginStatus} == {"OK", "LOSS", "MISSING_DATA"}


def test_finance_alert_kind_enum_values():
    assert {e.value for e in FinanceAlertKind} == {"LOSS", "MISSING_DATA"}
