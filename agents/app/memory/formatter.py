import os
from datetime import timezone
from zoneinfo import ZoneInfo


_DISPLAY_TZ = ZoneInfo(os.environ.get("MEMORY_DISPLAY_TZ", "Asia/Kuala_Lumpur"))


def _to_local(dt):
    if dt is None:
        return None
    # turnAt is stored naive (DateTime without tz) but values are UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_DISPLAY_TZ)


def _mask_phone(phone: str) -> str:
    if not phone:
        return ""
    if len(phone) <= 4:
        return "*" * len(phone)
    return phone[:4] + "*" * (len(phone) - 4)


def memory_block(phone, recent_turns, summaries) -> str:
    if not phone:
        return "(No prior history — first contact)"
    if not recent_turns and not summaries:
        return f"(No prior history with buyer {_mask_phone(phone)} — first contact)"

    lines = [f"--- Past conversation with this buyer (phone {_mask_phone(phone)}) ---"]
    turns = list(reversed(list(recent_turns)))
    for t in turns:
        ts = _to_local(t.turnAt).strftime("%Y-%m-%d %H:%M %Z")
        lines.append(f"[{ts}] Buyer: {t.buyerMsg}")
        lines.append(f"              You:   {t.agentReply}")

    if summaries:
        lines.append("")
        lines.append("--- Relevant older context ---")
        for s in summaries:
            a = _to_local(s.coversFromTurnAt).strftime("%Y-%m-%d")
            b = _to_local(s.coversToTurnAt).strftime("%Y-%m-%d")
            lines.append(f"- [covers {a} → {b}] {s.summary}")

    lines.append("---")
    lines.append("Use this history to maintain continuity. Do not re-ask info buyer already gave.")
    return "\n".join(lines)


def format_search_results(kind: str, hits, *, query: str | None = None) -> str:
    """Render a retrieval result for the LLM with stable, citable short ids.

    Each hit gets `[id=<short>]` derived from its full pk via sha1[:8]. Empty
    results render `[id=none:<query_hash8>]` so the LLM has a citable anchor
    for negative claims ("I checked, no relevant docs"). On the rare short-id
    collision within one result, all ids in that result bump to 12 chars.
    """
    import hashlib

    def _short(full: str, n: int) -> str:
        return hashlib.sha1(str(full).encode("utf-8")).hexdigest()[:n]

    hits = list(hits)
    if not hits:
        q = query or ""
        q_hash = _short(q, 8)
        return (
            f"No results (kind={kind}).\n"
            f'[id=none:{q_hash}] for query "{q}"'
        )

    # Choose short-id width (8 default; bump to 12 on collision).
    raw_ids = [str(getattr(h, "id", "")) for h in hits]
    width = 8
    if len({_short(r, 8) for r in raw_ids}) < len(raw_ids):
        width = 12

    lines = [f"Found {len(hits)} results (kind={kind}):"]
    for h, raw in zip(hits, raw_ids):
        sim = getattr(h, "similarity", 0.0)
        content = getattr(h, "content", None) or getattr(h, "customerMsg", None) or ""
        lines.append(f"[id={_short(raw, width)} sim={sim:.2f}] {content}")
    return "\n".join(lines)
