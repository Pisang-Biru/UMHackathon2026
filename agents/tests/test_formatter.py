from datetime import datetime, timezone
from types import SimpleNamespace
from app.memory import formatter


def _turn(buyer, reply, when):
    return SimpleNamespace(buyerMsg=buyer, agentReply=reply, turnAt=when)


def _summary(text, covers_from, covers_to):
    return SimpleNamespace(summary=text, coversFromTurnAt=covers_from, coversToTurnAt=covers_to)


def test_memory_block_with_no_phone():
    block = formatter.memory_block(phone=None, recent_turns=[], summaries=[])
    assert "No prior history" in block


def test_memory_block_orders_turns_oldest_first():
    t1 = datetime(2026, 4, 20, 14, 32, tzinfo=timezone.utc)
    t2 = datetime(2026, 4, 20, 14, 35, tzinfo=timezone.utc)
    turns = [_turn("later", "ack-later", t2), _turn("earlier", "ack-earlier", t1)]
    block = formatter.memory_block(phone="+60111", recent_turns=turns, summaries=[])
    assert block.index("earlier") < block.index("later")


def test_memory_block_includes_summaries():
    s = _summary("Buyer prefers small jars.",
                 datetime(2026, 3, 1, tzinfo=timezone.utc),
                 datetime(2026, 4, 1, tzinfo=timezone.utc))
    block = formatter.memory_block(phone="+60111", recent_turns=[], summaries=[s])
    assert "small jars" in block
    assert "2026-03-01" in block


def test_memory_block_masks_phone():
    block = formatter.memory_block(phone="+60123456789", recent_turns=[], summaries=[])
    assert "+60123456789" not in block
    assert "456789" not in block  # last 6 digits masked


def test_format_search_results_shows_similarity():
    hits = [SimpleNamespace(content="hello", similarity=0.82)]
    out = formatter.format_search_results("kb", hits)
    assert "kind=kb" in out
    assert "0.82" in out
    assert "hello" in out


def test_format_search_results_empty():
    out = formatter.format_search_results("kb", [])
    assert "No results" in out
