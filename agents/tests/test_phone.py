from app.memory.phone import normalize_phone


def test_normalize_local_my():
    assert normalize_phone("0123456789", region="MY") == "+60123456789"


def test_normalize_already_e164():
    assert normalize_phone("+60123456789") == "+60123456789"


def test_normalize_with_spaces():
    assert normalize_phone("012-345 6789", region="MY") == "+60123456789"


def test_normalize_invalid_returns_empty():
    assert normalize_phone("not a phone") == ""


def test_normalize_empty_returns_empty():
    assert normalize_phone("") == ""
    assert normalize_phone(None) == ""
