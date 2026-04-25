from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from app.db import MarginStatus

_QUANT = Decimal("0.01")


@dataclass
class MarginOutcome:
    status: MarginStatus
    real_margin: Optional[Decimal]
    revenue: Optional[Decimal] = None
    packaging_total: Optional[Decimal] = None
    transport: Optional[Decimal] = None
    platform_fee: Optional[Decimal] = None
    missing_fields: list[str] = field(default_factory=list)


def compute_margin(order, product, business) -> MarginOutcome:
    """Pure function: deterministic margin computation.
    Inputs are duck-typed; expects:
      order.qty, order.totalAmount, order.transportCost
      product.packagingCost
      business.platformFeePct
    All money fields are decimal.Decimal (or None for missing).
    """
    missing: list[str] = []
    if product.packagingCost is None:
        missing.append("packagingCost")
    if order.transportCost is None:
        missing.append("transportCost")
    if missing:
        return MarginOutcome(
            status=MarginStatus.MISSING_DATA,
            real_margin=None,
            missing_fields=missing,
        )

    qty = Decimal(order.qty)
    revenue = Decimal(order.totalAmount).quantize(_QUANT)
    packaging_total = (Decimal(product.packagingCost) * qty).quantize(_QUANT)
    transport = Decimal(order.transportCost).quantize(_QUANT)
    platform_fee = (revenue * Decimal(business.platformFeePct)).quantize(_QUANT)
    real_margin = (revenue - packaging_total - transport - platform_fee).quantize(_QUANT)

    status = MarginStatus.LOSS if real_margin < 0 else MarginStatus.OK
    return MarginOutcome(
        status=status,
        real_margin=real_margin,
        revenue=revenue,
        packaging_total=packaging_total,
        transport=transport,
        platform_fee=platform_fee,
    )
