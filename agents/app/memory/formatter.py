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


def format_search_results(kind: str, hits) -> str:
    hits = list(hits)
    if not hits:
        return f"No results (kind={kind})."
    lines = [f"Found {len(hits)} results (kind={kind}):"]
    for i, h in enumerate(hits, start=1):
        sim = getattr(h, "similarity", 0.0)
        content = getattr(h, "content", None) or getattr(h, "customerMsg", None) or ""
        lines.append(f"{i}. [sim={sim:.2f}] {content}")
    return "\n".join(lines)
