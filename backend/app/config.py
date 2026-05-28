from __future__ import annotations

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


def _load_dotenv_file(path: Path) -> None:
    if not path.is_file():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        normalized_key = key.strip()
        if not normalized_key:
            continue

        parsed_value = value.strip()
        if len(parsed_value) >= 2 and parsed_value[0] == parsed_value[-1] and parsed_value[0] in {'"', "'"}:
            parsed_value = parsed_value[1:-1]
        os.environ.setdefault(normalized_key, parsed_value)


def _parse_csv_env(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


_load_dotenv_file(REPO_ROOT / ".env")

APP_HOST = os.environ.get("APP_HOST", "127.0.0.1").strip() or "127.0.0.1"
APP_PORT = int(os.environ.get("APP_PORT", "8787"))
FRONTEND_PORT = int(os.environ.get("FRONTEND_PORT", "3107"))
CORS_ALLOWED_ORIGINS = _parse_csv_env("CORS_ALLOWED_ORIGINS", f"http://127.0.0.1:{FRONTEND_PORT}")
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
METADATA_TTL_HOURS = int(os.environ.get("METADATA_TTL_HOURS", "168"))
PLANNING_LOOKAHEAD_DAYS = int(os.environ.get("PLANNING_LOOKAHEAD_DAYS", "365"))
ENABLE_OLLAMA_FALLBACK = os.environ.get("ENABLE_OLLAMA_FALLBACK", "").strip().lower() in {"1", "true", "yes", "on"}
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip() or "http://127.0.0.1:11434"
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3:latest").strip() or "gemma3:latest"
TVMAZE_BASE_URL = os.environ.get("TVMAZE_BASE_URL", "https://api.tvmaze.com").strip() or "https://api.tvmaze.com"
DEFAULT_DB_PATH = BACKEND_DIR / "database-dev.db"
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

