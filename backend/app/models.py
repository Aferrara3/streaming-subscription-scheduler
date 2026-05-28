from __future__ import annotations

from datetime import date, datetime, timezone

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class Account(SQLModel, table=True):
    __tablename__ = "account"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True)
    password_hash: str
    password_salt: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class AuthSession(SQLModel, table=True):
    __tablename__ = "auth_session"

    id: int | None = Field(default=None, primary_key=True)
    account_id: int = Field(index=True, foreign_key="account.id")
    token_hash: str = Field(index=True)
    created_at: datetime = Field(default_factory=utc_now)
    last_used_at: datetime = Field(default_factory=utc_now)
    expires_at: datetime


class CatalogShow(SQLModel, table=True):
    __tablename__ = "catalog_show"

    id: int | None = Field(default=None, primary_key=True)
    source_name: str = Field(default="tvmaze", index=True)
    source_show_id: str = Field(index=True)
    name: str = Field(index=True)
    summary: str | None = None
    imdb_id: str | None = Field(default=None, index=True)
    premiered_on: date | None = None
    status: str | None = None
    official_site: str | None = None
    image_url: str | None = None
    source_url: str | None = None
    raw_payload_json: str | None = None
    last_refreshed_at: datetime = Field(default_factory=utc_now)
    cache_expires_at: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class CatalogEpisode(SQLModel, table=True):
    __tablename__ = "catalog_episode"

    id: int | None = Field(default=None, primary_key=True)
    show_id: int = Field(index=True, foreign_key="catalog_show.id")
    source_episode_id: str = Field(index=True)
    season_number: int | None = None
    episode_number: int | None = None
    title: str
    airdate: date | None = Field(default=None, index=True)
    airstamp: datetime | None = None
    source_url: str | None = None
    raw_payload_json: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class ShowAvailability(SQLModel, table=True):
    __tablename__ = "show_availability"

    id: int | None = Field(default=None, primary_key=True)
    show_id: int = Field(index=True, foreign_key="catalog_show.id")
    region_code: str = Field(default="US", index=True)
    provider_name: str | None = None
    provider_source: str | None = None
    provider_confidence: str = "low"
    source_url: str | None = None
    raw_payload_json: str | None = None
    last_refreshed_at: datetime = Field(default_factory=utc_now)
    cache_expires_at: datetime | None = None


class TrackedShow(SQLModel, table=True):
    __tablename__ = "tracked_show"

    id: int | None = Field(default=None, primary_key=True)
    account_id: int = Field(index=True, foreign_key="account.id")
    show_id: int = Field(index=True, foreign_key="catalog_show.id")
    provider_override_name: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class MetadataRefreshJob(SQLModel, table=True):
    __tablename__ = "metadata_refresh_job"

    id: int | None = Field(default=None, primary_key=True)
    show_id: int | None = Field(default=None, index=True, foreign_key="catalog_show.id")
    status: str = Field(default="queued", index=True)
    source_name: str = "tvmaze"
    error_message: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    started_at: datetime | None = None
    completed_at: datetime | None = None
