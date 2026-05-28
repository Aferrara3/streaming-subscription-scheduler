from datetime import datetime, timezone

from backend.app.models import ensure_utc


def test_ensure_utc_adds_utc_to_naive_datetimes() -> None:
    naive = datetime(2026, 5, 27, 18, 0, 0)

    normalized = ensure_utc(naive)

    assert normalized == datetime(2026, 5, 27, 18, 0, 0, tzinfo=timezone.utc)


def test_ensure_utc_preserves_aware_utc_datetimes() -> None:
    aware = datetime(2026, 5, 27, 18, 0, 0, tzinfo=timezone.utc)

    normalized = ensure_utc(aware)

    assert normalized == aware
