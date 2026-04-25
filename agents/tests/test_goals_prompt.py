from app.agents.goals_prompt import format_goals_block


def test_format_goals_block_empty_returns_empty_string():
    assert format_goals_block([]) == ""


def test_format_goals_block_numbers_each_goal():
    out = format_goals_block(["Increase margin", "Reply within 5 minutes"])
    assert "## Business goals" in out
    assert "1. Increase margin" in out
    assert "2. Reply within 5 minutes" in out


def test_format_goals_block_starts_with_blank_lines_for_separation():
    out = format_goals_block(["x"])
    assert out.startswith("\n\n")
