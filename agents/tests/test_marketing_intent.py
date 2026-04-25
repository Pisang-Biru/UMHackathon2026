import pytest

from app.agents.marketing import is_marketing_request


@pytest.mark.parametrize(
    "text",
    [
        "post to instagram",
        "post ke ig",
        "buat ig post",
        "buat 3 poster promo",
        "create instagram post",
        "generate 5 ig posts",
        "jana poster baru",
        "design poster untuk minggu ni",
        "marketing campaign for raya",
        "ig post please",
        "post ig sekarang",
        "upload ke instagram",
        "publish to ig",
    ],
)
def test_explicit_marketing_commands_match(text):
    assert is_marketing_request(text), f"expected match: {text!r}"


@pytest.mark.parametrize(
    "text",
    [
        "ada promo tak hari ni?",
        "what's your instagram handle?",
        "boleh dm ig korang?",
        "tengok poster kat kedai semalam",
        "iklan tu lawa",
        "marketing team contact mana?",
        "any campaign coming up?",
        "promo milk masih ada?",
        "follow ig kau",
    ],
)
def test_ordinary_chat_does_not_match(text):
    assert not is_marketing_request(text), f"expected no match: {text!r}"


def test_empty_input():
    assert is_marketing_request("") is False
    assert is_marketing_request(None) is False
