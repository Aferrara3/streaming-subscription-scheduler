from __future__ import annotations

from calendar import month_name
from datetime import date
from typing import Iterable


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _next_month(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _month_label(value: date) -> str:
    return f"{month_name[value.month]} {value.year}"


def _window_label(start_month: date, end_month: date) -> str:
    if start_month == end_month:
        return _month_label(start_month)
    if start_month.year == end_month.year:
        return f"{month_name[start_month.month]}-{month_name[end_month.month]} {start_month.year}"
    return f"{month_name[start_month.month]} {start_month.year}-{month_name[end_month.month]} {end_month.year}"


def collapse_month_windows(months: Iterable[date]) -> list[dict[str, str]]:
    ordered = sorted({_month_start(month) for month in months})
    if not ordered:
        return []

    windows: list[dict[str, str]] = []
    start_month = ordered[0]
    end_month = ordered[0]

    for month in ordered[1:]:
        if month == _next_month(end_month):
            end_month = month
            continue

        windows.append(
            {
                "start_month": start_month.isoformat(),
                "end_month": end_month.isoformat(),
                "label": _window_label(start_month, end_month),
            }
        )
        start_month = month
        end_month = month

    windows.append(
        {
            "start_month": start_month.isoformat(),
            "end_month": end_month.isoformat(),
            "label": _window_label(start_month, end_month),
        }
    )
    return windows


def build_provider_windows(show_cards: Iterable[dict]) -> list[dict]:
    provider_months: dict[str, set[date]] = {}
    provider_show_names: dict[str, set[str]] = {}

    for card in show_cards:
        provider = card["provider_name"]
        provider_show_names.setdefault(provider, set()).add(card["show_name"])
        for episode in card["episodes"]:
            provider_months.setdefault(provider, set()).add(_month_start(date.fromisoformat(episode["airdate"])))

    items: list[dict] = []
    for provider, months in sorted(provider_months.items(), key=lambda item: item[0].lower()):
        items.append(
            {
                "provider_name": provider,
                "show_count": len(provider_show_names.get(provider, set())),
                "windows": collapse_month_windows(months),
            }
        )
    return items


def build_calendar_months(show_cards: Iterable[dict]) -> list[dict]:
    months: dict[date, dict] = {}

    for card in show_cards:
        provider = card["provider_name"]
        for episode in card["episodes"]:
            airdate = date.fromisoformat(episode["airdate"])
            month = _month_start(airdate)
            bucket = months.setdefault(
                month,
                {
                    "month": month.isoformat(),
                    "label": _month_label(month),
                    "providers": set(),
                    "entries": [],
                },
            )
            bucket["providers"].add(provider)
            bucket["entries"].append(
                {
                    "tracked_show_id": card["tracked_show_id"],
                    "show_name": card["show_name"],
                    "provider_name": provider,
                    "episode_title": episode["title"],
                    "season_number": episode["season_number"],
                    "episode_number": episode["episode_number"],
                    "airdate": episode["airdate"],
                    "formatted_airdate": episode["formatted_airdate"],
                }
            )

    serialized: list[dict] = []
    for month in sorted(months):
        bucket = months[month]
        bucket["providers"] = sorted(bucket["providers"])
        bucket["entries"].sort(key=lambda entry: entry["airdate"])
        serialized.append(bucket)
    return serialized

