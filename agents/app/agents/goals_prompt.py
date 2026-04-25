"""Helpers for injecting active business goals into agent system prompts.

Goals live in `public.goal` (Prisma-owned). Python reads them as a read-only
view. See agents/app/db.py for the SQLAlchemy model.
"""
from __future__ import annotations

from typing import Iterable

from sqlalchemy.orm import Session

from app.db import Goal


def format_goals_block(texts: Iterable[str]) -> str:
    """Render goal texts as a system-prompt block.

    Returns "" when there are no goals so callers can append unconditionally.
    """
    items = [t for t in texts if t and t.strip()]
    if not items:
        return ""
    lines = [f"{i + 1}. {t.strip()}" for i, t in enumerate(items)]
    return "\n\n## Business goals\n" + "\n".join(lines)


def load_active_goals_block(session: Session, business_id: str) -> str:
    """Fetch ACTIVE, non-deleted goals for the business, newest first, formatted."""
    rows = (
        session.query(Goal)
        .filter(
            Goal.businessId == business_id,
            Goal.status == "ACTIVE",
            Goal.deletedAt.is_(None),
        )
        .order_by(Goal.createdAt.desc())
        .all()
    )
    return format_goals_block([r.text for r in rows])
