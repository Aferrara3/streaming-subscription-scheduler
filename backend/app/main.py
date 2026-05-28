from __future__ import annotations
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field as PydanticField
from sqlmodel import Session, select

from .auth import AuthContext, create_auth_session, create_password_credentials, require_auth_context, verify_password
from .config import APP_HOST, APP_PORT, CORS_ALLOWED_ORIGINS, PLANNING_LOOKAHEAD_DAYS
from .database import create_db_and_tables, get_session
from .models import Account, AuthSession, CatalogEpisode, CatalogShow, MetadataRefreshJob, ShowAvailability, TrackedShow, ensure_utc, utc_now
from .planner import build_calendar_months, build_provider_windows, collapse_month_windows
from .tvmaze import TVMazeClient, normalize_search_result, normalize_show_payload


tvmaze_client = TVMazeClient()


class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class TrackShowRequest(BaseModel):
    source_show_id: str


class TrackedShowUpdateRequest(BaseModel):
    provider_override_name: str | None = None


class AuthResponse(BaseModel):
    token: str
    account: dict


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_db_and_tables()
    yield


app = FastAPI(title="Sub Schedule API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _normalize_username(username: str) -> str:
    normalized = username.strip().lower()
    if len(normalized) < 3:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Username must be at least 3 characters")
    return normalized


def _ensure_password_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Password must be at least 8 characters")


def _serialize_account(account: Account) -> dict:
    return {
        "id": account.id,
        "username": account.username,
        "created_at": account.created_at.isoformat(),
    }


def _serialize_episode(episode: CatalogEpisode) -> dict:
    if episode.airdate is None:
        raise ValueError("Episode airdate must exist before serialization")
    formatted = f"{episode.airdate.month}/{episode.airdate.day}"
    season = episode.season_number or 0
    number = episode.episode_number or 0
    return {
        "id": episode.id,
        "title": episode.title,
        "season_number": season,
        "episode_number": number,
        "airdate": episode.airdate.isoformat(),
        "formatted_airdate": formatted,
        "label": f"S{season}E{number} {episode.title}",
    }


def _resolve_provider_name(tracked_show: TrackedShow, availability: ShowAvailability | None) -> tuple[str, str, str]:
    if tracked_show.provider_override_name and tracked_show.provider_override_name.strip():
        return tracked_show.provider_override_name.strip(), "manual-override", "high"
    if availability and availability.provider_name:
        return availability.provider_name, availability.provider_source or "metadata-cache", availability.provider_confidence
    return "Unknown", "manual-review", "low"


def _replace_episodes(session: Session, show_id: int, episodes: list[dict]) -> None:
    existing_episodes = session.exec(select(CatalogEpisode).where(CatalogEpisode.show_id == show_id)).all()
    for episode in existing_episodes:
        session.delete(episode)
    session.commit()

    for episode in episodes:
        session.add(CatalogEpisode(show_id=show_id, **episode))
    session.commit()


def _upsert_show(session: Session, normalized_show: dict) -> CatalogShow:
    catalog_show = session.exec(
        select(CatalogShow).where(
            CatalogShow.source_name == normalized_show["source_name"],
            CatalogShow.source_show_id == normalized_show["source_show_id"],
        )
    ).first()
    if catalog_show is None:
        catalog_show = CatalogShow(source_name=normalized_show["source_name"], source_show_id=normalized_show["source_show_id"], name=normalized_show["name"])
        session.add(catalog_show)
        session.commit()
        session.refresh(catalog_show)

    catalog_show.name = normalized_show["name"]
    catalog_show.summary = normalized_show["summary"]
    catalog_show.imdb_id = normalized_show["imdb_id"]
    catalog_show.premiered_on = normalized_show["premiered_on"]
    catalog_show.status = normalized_show["status"]
    catalog_show.official_site = normalized_show["official_site"]
    catalog_show.image_url = normalized_show["image_url"]
    catalog_show.source_url = normalized_show["source_url"]
    catalog_show.raw_payload_json = normalized_show["raw_payload_json"]
    catalog_show.last_refreshed_at = normalized_show["last_refreshed_at"]
    catalog_show.cache_expires_at = normalized_show["cache_expires_at"]
    catalog_show.updated_at = utc_now()
    session.add(catalog_show)
    session.commit()
    session.refresh(catalog_show)

    _replace_episodes(session, catalog_show.id, normalized_show["episodes"])

    availability = session.exec(
        select(ShowAvailability).where(
            ShowAvailability.show_id == catalog_show.id,
            ShowAvailability.region_code == "US",
        )
    ).first()
    if availability is None:
        availability = ShowAvailability(show_id=catalog_show.id, region_code="US")

    availability.provider_name = normalized_show["provider_name"]
    availability.provider_source = normalized_show["provider_source"]
    availability.provider_confidence = normalized_show["provider_confidence"]
    availability.source_url = normalized_show["availability_source_url"]
    availability.raw_payload_json = normalized_show["raw_payload_json"]
    availability.last_refreshed_at = normalized_show["last_refreshed_at"]
    availability.cache_expires_at = normalized_show["cache_expires_at"]
    session.add(availability)
    session.commit()
    return catalog_show


def _refresh_show_metadata(session: Session, source_show_id: str, force: bool = False) -> CatalogShow:
    existing_show = session.exec(
        select(CatalogShow).where(CatalogShow.source_name == "tvmaze", CatalogShow.source_show_id == source_show_id)
    ).first()
    if (
        existing_show is not None
        and not force
        and existing_show.cache_expires_at is not None
        and ensure_utc(existing_show.cache_expires_at) > datetime.now(timezone.utc)
    ):
        return existing_show

    show_for_job = existing_show.id if existing_show is not None else None
    job = MetadataRefreshJob(show_id=show_for_job, status="processing", source_name="tvmaze", started_at=utc_now())
    session.add(job)
    session.commit()
    session.refresh(job)

    try:
        show_payload = tvmaze_client.get_show(source_show_id)
        normalized_show = normalize_show_payload(show_payload)
        catalog_show = _upsert_show(session, normalized_show)
        job.show_id = catalog_show.id
        job.status = "completed"
        job.completed_at = utc_now()
        session.add(job)
        session.commit()
        return catalog_show
    except Exception as exc:
        job.status = "failed"
        job.error_message = str(exc)
        job.completed_at = utc_now()
        session.add(job)
        session.commit()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not refresh show metadata") from exc


def _tracked_show_dashboard_item(session: Session, tracked_show: TrackedShow) -> dict:
    catalog_show = session.get(CatalogShow, tracked_show.show_id)
    if catalog_show is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracked show metadata is missing")

    availability = session.exec(select(ShowAvailability).where(ShowAvailability.show_id == catalog_show.id)).first()
    provider_name, provider_source, provider_confidence = _resolve_provider_name(tracked_show, availability)
    lookahead_limit = date.today() + timedelta(days=PLANNING_LOOKAHEAD_DAYS)
    future_episodes = session.exec(
        select(CatalogEpisode)
        .where(
            CatalogEpisode.show_id == catalog_show.id,
            CatalogEpisode.airdate.is_not(None),
            CatalogEpisode.airdate >= date.today(),
            CatalogEpisode.airdate <= lookahead_limit,
        )
        .order_by(CatalogEpisode.airdate.asc())
    ).all()

    serialized_episodes = [_serialize_episode(episode) for episode in future_episodes if episode.airdate is not None]
    windows = collapse_month_windows([date.fromisoformat(item["airdate"]) for item in serialized_episodes])
    next_episode_date = serialized_episodes[0]["airdate"] if serialized_episodes else None

    return {
        "tracked_show_id": tracked_show.id,
        "show_name": catalog_show.name,
        "summary": catalog_show.summary,
        "provider_name": provider_name,
        "provider_source": provider_source,
        "provider_confidence": provider_confidence,
        "provider_override_name": tracked_show.provider_override_name,
        "source_url": catalog_show.source_url,
        "image_url": catalog_show.image_url,
        "status": catalog_show.status,
        "premiered_on": catalog_show.premiered_on.isoformat() if catalog_show.premiered_on else None,
        "subscription_windows": windows,
        "next_episode_date": next_episode_date,
        "episodes": serialized_episodes,
        "metadata_refreshed_at": ensure_utc(catalog_show.last_refreshed_at).isoformat(),
    }


def _serialize_dashboard(session: Session, account_id: int) -> dict:
    tracked_shows = session.exec(
        select(TrackedShow)
        .where(TrackedShow.account_id == account_id)
        .order_by(TrackedShow.created_at.asc())
    ).all()
    show_cards = [_tracked_show_dashboard_item(session, tracked_show) for tracked_show in tracked_shows]
    return {
        "shows": show_cards,
        "provider_windows": build_provider_windows(show_cards),
        "calendar_months": build_calendar_months(show_cards),
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "app_host": APP_HOST, "app_port": APP_PORT}


@app.post("/auth/register", response_model=AuthResponse)
def register(payload: RegisterRequest, session: Session = Depends(get_session)) -> AuthResponse:
    username = _normalize_username(payload.username)
    _ensure_password_strength(payload.password)

    existing = session.exec(select(Account).where(Account.username == username)).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username is already taken")

    password_salt, password_hash = create_password_credentials(payload.password)
    account = Account(username=username, password_salt=password_salt, password_hash=password_hash)
    session.add(account)
    session.commit()
    session.refresh(account)

    token = create_auth_session(session, account.id)
    return AuthResponse(token=token, account=_serialize_account(account))


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, session: Session = Depends(get_session)) -> AuthResponse:
    username = _normalize_username(payload.username)
    account = session.exec(select(Account).where(Account.username == username)).first()
    if account is None or not verify_password(payload.password, account.password_salt, account.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    token = create_auth_session(session, account.id)
    return AuthResponse(token=token, account=_serialize_account(account))


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(auth: AuthContext = Depends(require_auth_context), session: Session = Depends(get_session)) -> Response:
    auth_session = session.exec(select(AuthSession).where(AuthSession.token_hash == auth.token_hash)).first()
    if auth_session is not None:
        session.delete(auth_session)
        session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/account")
def account(auth: AuthContext = Depends(require_auth_context)) -> dict:
    return _serialize_account(auth.account)


@app.get("/shows/search")
def search_shows(q: str = Query(min_length=2, max_length=100)) -> list[dict]:
    try:
        results = tvmaze_client.search_shows(q)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not search shows right now") from exc

    return [normalize_search_result(result) for result in results[:10]]


@app.post("/tracked-shows", status_code=status.HTTP_201_CREATED)
def add_tracked_show(
    payload: TrackShowRequest,
    auth: AuthContext = Depends(require_auth_context),
    session: Session = Depends(get_session),
) -> dict:
    catalog_show = _refresh_show_metadata(session, payload.source_show_id, force=False)

    existing = session.exec(
        select(TrackedShow).where(
            TrackedShow.account_id == auth.account.id,
            TrackedShow.show_id == catalog_show.id,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You are already tracking that show")

    tracked_show = TrackedShow(account_id=auth.account.id, show_id=catalog_show.id)
    session.add(tracked_show)
    session.commit()
    session.refresh(tracked_show)
    return _tracked_show_dashboard_item(session, tracked_show)


@app.patch("/tracked-shows/{tracked_show_id}")
def update_tracked_show(
    tracked_show_id: int,
    payload: TrackedShowUpdateRequest,
    auth: AuthContext = Depends(require_auth_context),
    session: Session = Depends(get_session),
) -> dict:
    tracked_show = session.get(TrackedShow, tracked_show_id)
    if tracked_show is None or tracked_show.account_id != auth.account.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracked show not found")

    tracked_show.provider_override_name = payload.provider_override_name.strip() if payload.provider_override_name else None
    tracked_show.updated_at = utc_now()
    session.add(tracked_show)
    session.commit()
    session.refresh(tracked_show)
    return _tracked_show_dashboard_item(session, tracked_show)


@app.post("/tracked-shows/{tracked_show_id}/refresh")
def refresh_tracked_show(
    tracked_show_id: int,
    auth: AuthContext = Depends(require_auth_context),
    session: Session = Depends(get_session),
) -> dict:
    tracked_show = session.get(TrackedShow, tracked_show_id)
    if tracked_show is None or tracked_show.account_id != auth.account.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracked show not found")

    catalog_show = session.get(CatalogShow, tracked_show.show_id)
    if catalog_show is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog show not found")

    _refresh_show_metadata(session, catalog_show.source_show_id, force=True)
    session.refresh(tracked_show)
    return _tracked_show_dashboard_item(session, tracked_show)


@app.delete("/tracked-shows/{tracked_show_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tracked_show(
    tracked_show_id: int,
    auth: AuthContext = Depends(require_auth_context),
    session: Session = Depends(get_session),
) -> Response:
    tracked_show = session.get(TrackedShow, tracked_show_id)
    if tracked_show is None or tracked_show.account_id != auth.account.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tracked show not found")

    session.delete(tracked_show)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/dashboard")
def dashboard(auth: AuthContext = Depends(require_auth_context), session: Session = Depends(get_session)) -> dict:
    return _serialize_dashboard(session, auth.account.id)


class SeedShow(BaseModel):
    source_show_id: str
    provider_override_name: str | None = None


class SeedRequest(BaseModel):
    username: str = "demo"
    password: str = "password123"
    shows: list[SeedShow] = PydanticField(default_factory=lambda: [SeedShow(source_show_id="526")])


@app.post("/dev/seed")
def seed_demo(payload: SeedRequest, session: Session = Depends(get_session)) -> dict:
    username = _normalize_username(payload.username)
    account = session.exec(select(Account).where(Account.username == username)).first()
    if account is None:
        password_salt, password_hash = create_password_credentials(payload.password)
        account = Account(username=username, password_salt=password_salt, password_hash=password_hash)
        session.add(account)
        session.commit()
        session.refresh(account)

    created = []
    for seed_show in payload.shows:
        catalog_show = _refresh_show_metadata(session, seed_show.source_show_id, force=False)
        tracked_show = session.exec(
            select(TrackedShow).where(TrackedShow.account_id == account.id, TrackedShow.show_id == catalog_show.id)
        ).first()
        if tracked_show is None:
            tracked_show = TrackedShow(
                account_id=account.id,
                show_id=catalog_show.id,
                provider_override_name=seed_show.provider_override_name,
            )
            session.add(tracked_show)
            session.commit()
            session.refresh(tracked_show)
        created.append(_tracked_show_dashboard_item(session, tracked_show))

    token = create_auth_session(session, account.id)
    return {"token": token, "account": _serialize_account(account), "shows": created}
