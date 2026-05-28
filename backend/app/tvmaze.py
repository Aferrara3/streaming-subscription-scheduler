from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

from .config import ENABLE_OLLAMA_FALLBACK, METADATA_TTL_HOURS, OLLAMA_BASE_URL, OLLAMA_MODEL, TVMAZE_BASE_URL


TRADITIONAL_NETWORK_PROVIDER_MAP = {
    "ABC": "Hulu",
    "AMC": "AMC+",
    "Adult Swim": "Max",
    "Cartoon Network": "Max",
    "CBS": "Paramount+",
    "CW": "Max",
    "Disney Channel": "Disney+",
    "Disney Junior": "Disney+",
    "Disney XD": "Disney+",
    "FOX": "Hulu",
    "Freeform": "Hulu",
    "FX": "Hulu",
    "FXX": "Hulu",
    "HBO": "Max",
    "History": "History Vault",
    "NBC": "Peacock",
    "Nat Geo": "Disney+",
    "National Geographic": "Disney+",
    "Paramount Network": "Paramount+",
    "Showtime": "Paramount+",
}

DIRECT_PROVIDER_ALIASES = {
    "Amazon Prime Video": "Prime Video",
    "Apple TV+": "Apple TV+",
    "Crunchyroll": "Crunchyroll",
    "Disney+": "Disney+",
    "HBO Max": "Max",
    "Hulu": "Hulu",
    "Max": "Max",
    "Netflix": "Netflix",
    "Paramount+": "Paramount+",
    "Peacock": "Peacock",
    "Prime Video": "Prime Video",
}


def _sanitize_summary(summary: str | None) -> str | None:
    if not summary:
        return None
    cleaned = re.sub(r"<[^>]+>", "", summary)
    normalized = re.sub(r"\s+", " ", cleaned).strip()
    return normalized or None


def _parse_date(raw_value: str | None) -> date | None:
    if not raw_value:
        return None
    return date.fromisoformat(raw_value)


def _parse_datetime(raw_value: str | None) -> datetime | None:
    if not raw_value:
        return None
    return datetime.fromisoformat(raw_value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _provider_from_payload(show_payload: dict[str, Any]) -> tuple[str | None, str | None, str]:
    web_channel = show_payload.get("webChannel") or {}
    network = show_payload.get("network") or {}

    web_channel_name = web_channel.get("name")
    if isinstance(web_channel_name, str) and web_channel_name.strip():
        canonical = DIRECT_PROVIDER_ALIASES.get(web_channel_name.strip(), web_channel_name.strip())
        return canonical, "tvmaze-web-channel", "high"

    network_name = network.get("name")
    if isinstance(network_name, str) and network_name.strip():
        normalized = network_name.strip()
        canonical = DIRECT_PROVIDER_ALIASES.get(normalized) or TRADITIONAL_NETWORK_PROVIDER_MAP.get(normalized) or normalized
        return canonical, "tvmaze-network", "medium"

    return None, None, "low"


def _ollama_provider_fallback(show_payload: dict[str, Any]) -> tuple[str | None, str | None, str]:
    if not ENABLE_OLLAMA_FALLBACK:
        return None, None, "low"

    prompt = (
        "Pick the most likely US streaming service for this TV series.\n"
        "If the metadata only points to a traditional cable or broadcast network, map it to the most likely US streaming home.\n"
        "Return only the provider name and nothing else.\n\n"
        f"Show title: {show_payload.get('name')}\n"
        f"Web channel: {(show_payload.get('webChannel') or {}).get('name')}\n"
        f"Network: {(show_payload.get('network') or {}).get('name')}\n"
        f"Official site: {show_payload.get('officialSite')}\n"
        f"Summary: {_sanitize_summary(show_payload.get('summary'))}\n"
    )

    response = requests.post(
        f"{OLLAMA_BASE_URL.rstrip('/')}/api/generate",
        json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
        timeout=20,
    )
    response.raise_for_status()
    provider_name = response.json().get("response", "").strip()
    return (provider_name or None), "ollama-provider-fallback", "low"


class TVMazeClient:
    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update({"Accept": "application/json", "User-Agent": "sub-schedule/0.1"})

    def search_shows(self, query: str) -> list[dict[str, Any]]:
        response = self._session.get(
            f"{TVMAZE_BASE_URL.rstrip('/')}/search/shows",
            params={"q": query},
            timeout=15,
        )
        response.raise_for_status()
        return response.json()

    def get_show(self, source_show_id: str) -> dict[str, Any]:
        response = self._session.get(
            f"{TVMAZE_BASE_URL.rstrip('/')}/shows/{source_show_id}",
            params={"embed": "episodes"},
            timeout=20,
        )
        response.raise_for_status()
        return response.json()


def normalize_search_result(result: dict[str, Any]) -> dict[str, Any]:
    show = result.get("show") or {}
    provider_name, provider_source, provider_confidence = _provider_from_payload(show)
    return {
        "source_name": "tvmaze",
        "source_show_id": str(show.get("id")),
        "name": show.get("name") or "Untitled show",
        "summary": _sanitize_summary(show.get("summary")),
        "premiered_on": show.get("premiered"),
        "status": show.get("status"),
        "image_url": ((show.get("image") or {}).get("original") or (show.get("image") or {}).get("medium")),
        "imdb_id": (show.get("externals") or {}).get("imdb"),
        "source_url": show.get("url"),
        "provider_name": provider_name,
        "provider_source": provider_source,
        "provider_confidence": provider_confidence,
    }


def normalize_show_payload(show_payload: dict[str, Any]) -> dict[str, Any]:
    provider_name, provider_source, provider_confidence = _provider_from_payload(show_payload)
    if provider_name is None:
        provider_name, provider_source, provider_confidence = _ollama_provider_fallback(show_payload)

    episodes = []
    for episode in (show_payload.get("_embedded") or {}).get("episodes", []):
        episode_id = episode.get("id")
        if episode_id is None:
            continue
        episodes.append(
            {
                "source_episode_id": str(episode_id),
                "season_number": episode.get("season"),
                "episode_number": episode.get("number"),
                "title": episode.get("name") or "Untitled episode",
                "airdate": _parse_date(episode.get("airdate")),
                "airstamp": _parse_datetime(episode.get("airstamp")),
                "source_url": episode.get("url"),
                "raw_payload_json": json.dumps(episode),
            }
        )

    now = datetime.now(timezone.utc)
    return {
        "source_name": "tvmaze",
        "source_show_id": str(show_payload.get("id")),
        "name": show_payload.get("name") or "Untitled show",
        "summary": _sanitize_summary(show_payload.get("summary")),
        "imdb_id": (show_payload.get("externals") or {}).get("imdb"),
        "premiered_on": _parse_date(show_payload.get("premiered")),
        "status": show_payload.get("status"),
        "official_site": show_payload.get("officialSite"),
        "image_url": ((show_payload.get("image") or {}).get("original") or (show_payload.get("image") or {}).get("medium")),
        "source_url": show_payload.get("url"),
        "raw_payload_json": json.dumps(show_payload),
        "last_refreshed_at": now,
        "cache_expires_at": now + timedelta(hours=METADATA_TTL_HOURS),
        "provider_name": provider_name or "Unknown",
        "provider_source": provider_source or "manual-review",
        "provider_confidence": provider_confidence,
        "availability_source_url": show_payload.get("url"),
        "episodes": episodes,
    }

