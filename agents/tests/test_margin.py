from decimal import Decimal
from types import SimpleNamespace
from app.agents.finance.margin import compute_margin, MarginOutcome
from app.db import MarginStatus


def _o(qty=1, total="100.00", transport=None):
    return SimpleNamespace(
        qty=qty,
        totalAmount=Decimal(total),
        transportCost=Decimal(transport) if transport is not None else None,
    )


def _p(packaging=None):
    return SimpleNamespace(
        packagingCost=Decimal(packaging) if packaging is not None else None,
    )


def _b(fee="0.05"):
    return SimpleNamespace(platformFeePct=Decimal(fee))


def test_ok_case_positive_margin():
    out = compute_margin(_o(qty=2, total="200.00", transport="10.00"),
                         _p(packaging="2.00"),
                         _b(fee="0.05"))
    # revenue 200 - packaging 4 - transport 10 - fee 10 = 176.00
    assert out.status == MarginStatus.OK
    assert out.real_margin == Decimal("176.00")


def test_loss_case_negative_margin():
    out = compute_margin(_o(qty=1, total="10.00", transport="15.00"),
                         _p(packaging="2.00"),
                         _b(fee="0.05"))
    # 10 - 2 - 15 - 0.50 = -7.50
    assert out.status == MarginStatus.LOSS
    assert out.real_margin == Decimal("-7.50")


def test_missing_packaging():
    out = compute_margin(_o(transport="10.00"), _p(packaging=None), _b())
    assert out.status == MarginStatus.MISSING_DATA
    assert "packagingCost" in out.missing_fields


def test_missing_transport():
    out = compute_margin(_o(transport=None), _p(packaging="2.00"), _b())
    assert out.status == MarginStatus.MISSING_DATA
    assert "transportCost" in out.missing_fields


def test_zero_platform_fee():
    out = compute_margin(_o(qty=1, total="100.00", transport="0.00"),
                         _p(packaging="0.00"),
                         _b(fee="0.0000"))
    # revenue 100 - packaging 0 - transport 0 - fee 0 = 100.00
    assert out.status == MarginStatus.OK
    assert out.real_margin == Decimal("100.00")


def test_decimal_precision_no_float_drift():
    # 0.1 + 0.2 != 0.3 in float; ensure Decimal path keeps exact.
    out = compute_margin(_o(qty=3, total="0.30", transport="0.00"),
                         _p(packaging="0.00"),
                         _b(fee="0.00"))
    # revenue 0.30 - packaging 0 - transport 0 - fee 0 = 0.30
    assert out.real_margin == Decimal("0.30")


def test_breakdown_returned():
    out = compute_margin(_o(qty=2, total="200.00", transport="10.00"),
                         _p(packaging="2.00"),
                         _b(fee="0.05"))
    assert out.revenue == Decimal("200.00")
    assert out.packaging_total == Decimal("4.00")
    assert out.transport == Decimal("10.00")
    assert out.platform_fee == Decimal("10.00")
