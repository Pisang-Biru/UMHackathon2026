import importlib
import pkgutil
import logging
from typing import Iterable

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import SessionLocal, Agent, BusinessAgent, Business
import app.agents as agents_pkg

log = logging.getLogger(__name__)

# Modules in agents/app/agents that are NOT standalone agents (helpers, base, examples)
# Any file starting with "_" is also skipped automatically.
_SKIP_MODULES: set[str] = {"base", "registry", "example"}


def discover_agent_meta() -> list[dict]:
    """Scan app.agents.* modules for AGENT_META dicts. Dedup by id."""
    metas: list[dict] = []
    for info in pkgutil.iter_modules(agents_pkg.__path__):
        if info.name.startswith("_") or info.name in _SKIP_MODULES:
            continue
        try:
            mod = importlib.import_module(f"app.agents.{info.name}")
        except Exception:
            log.exception("registry: failed to import app.agents.%s", info.name)
            continue
        meta = getattr(mod, "AGENT_META", None)
        if isinstance(meta, dict) and "id" in meta and "name" in meta and "role" in meta:
            metas.append(meta)

    seen: dict[str, dict] = {}
    for m in metas:
        seen[m["id"]] = m
    return list(seen.values())


def upsert_registry(business_ids: Iterable[str] | None = None) -> None:
    """Upsert discovered AGENT_META into `agents` + enable per business."""
    metas = discover_agent_meta()
    if not metas:
        log.warning("upsert_registry: no AGENT_META found")
        return

    with SessionLocal() as s:
        for m in metas:
            stmt = (
                pg_insert(Agent)
                .values(
                    id=m["id"],
                    name=m["name"],
                    role=m["role"],
                    icon=m.get("icon"),
                )
                .on_conflict_do_update(
                    index_elements=[Agent.id],
                    set_={
                        "name": m["name"],
                        "role": m["role"],
                        "icon": m.get("icon"),
                    },
                )
            )
            s.execute(stmt)

        biz_ids = list(business_ids) if business_ids else [
            b.id for b in s.query(Business).all()
        ]
        for bid in biz_ids:
            for m in metas:
                stmt2 = (
                    pg_insert(BusinessAgent)
                    .values(business_id=bid, agent_id=m["id"], enabled=True)
                    .on_conflict_do_nothing()
                )
                s.execute(stmt2)

        s.commit()

    log.info(
        "upsert_registry: upserted %d agents across %d businesses",
        len(metas),
        len(biz_ids),
    )
