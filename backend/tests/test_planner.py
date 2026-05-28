from datetime import date

from backend.app.planner import build_calendar_months, build_provider_windows, collapse_month_windows


def test_collapse_month_windows_merges_contiguous_months() -> None:
    windows = collapse_month_windows(
        [
            date(2026, 3, 2),
            date(2026, 3, 19),
            date(2026, 4, 3),
            date(2026, 6, 9),
        ]
    )

    assert windows == [
        {"start_month": "2026-03-01", "end_month": "2026-04-01", "label": "March-April 2026"},
        {"start_month": "2026-06-01", "end_month": "2026-06-01", "label": "June 2026"},
    ]


def test_build_provider_windows_groups_shows_by_provider() -> None:
    show_cards = [
        {
            "tracked_show_id": 1,
            "show_name": "Show A",
            "provider_name": "Max",
            "episodes": [
                {"airdate": "2026-03-12", "formatted_airdate": "3/12", "title": "Ep 1", "season_number": 1, "episode_number": 1},
                {"airdate": "2026-04-02", "formatted_airdate": "4/2", "title": "Ep 2", "season_number": 1, "episode_number": 2},
            ],
        },
        {
            "tracked_show_id": 2,
            "show_name": "Show B",
            "provider_name": "Max",
            "episodes": [
                {"airdate": "2026-04-20", "formatted_airdate": "4/20", "title": "Ep 5", "season_number": 2, "episode_number": 5},
            ],
        },
    ]

    provider_windows = build_provider_windows(show_cards)

    assert provider_windows == [
        {
            "provider_name": "Max",
            "show_count": 2,
            "windows": [
                {"start_month": "2026-03-01", "end_month": "2026-04-01", "label": "March-April 2026"},
            ],
        }
    ]


def test_build_calendar_months_groups_entries_by_month() -> None:
    show_cards = [
        {
            "tracked_show_id": 1,
            "show_name": "Severance",
            "provider_name": "Apple TV+",
            "episodes": [
                {"airdate": "2026-04-01", "formatted_airdate": "4/1", "title": "Hello", "season_number": 4, "episode_number": 1},
            ],
        },
        {
            "tracked_show_id": 2,
            "show_name": "Andor",
            "provider_name": "Disney+",
            "episodes": [
                {"airdate": "2026-04-10", "formatted_airdate": "4/10", "title": "Fight", "season_number": 3, "episode_number": 2},
            ],
        },
    ]

    months = build_calendar_months(show_cards)

    assert months == [
        {
            "month": "2026-04-01",
            "label": "April 2026",
            "providers": ["Apple TV+", "Disney+"],
            "entries": [
                {
                    "tracked_show_id": 1,
                    "show_name": "Severance",
                    "provider_name": "Apple TV+",
                    "episode_title": "Hello",
                    "season_number": 4,
                    "episode_number": 1,
                    "airdate": "2026-04-01",
                    "formatted_airdate": "4/1",
                },
                {
                    "tracked_show_id": 2,
                    "show_name": "Andor",
                    "provider_name": "Disney+",
                    "episode_title": "Fight",
                    "season_number": 3,
                    "episode_number": 2,
                    "airdate": "2026-04-10",
                    "formatted_airdate": "4/10",
                },
            ],
        }
    ]
