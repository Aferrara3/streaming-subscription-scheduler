# Sub Schedule Architecture

## Purpose

Sub Schedule helps a user follow a small set of TV series without carrying unnecessary streaming subscriptions. The system focuses on **newly airing episodes** in the **US market** and turns episode schedules into provider subscription windows.

## High-level architecture

```text
Next.js frontend
    |
    v
FastAPI API
    |
    +--> Auth/session logic
    +--> Show search + tracking logic
    +--> Metadata refresh + cache logic
    +--> Subscription planning logic
    |
    v
SQLite database
    |
    v
External metadata providers
    |
    +--> TVMaze search + episode schedules
    +--> Optional Ollama fallback for ambiguous provider inference
```

## Frontend responsibilities

Primary frontend entrypoint:

- `frontend/src/components/SubScheduleApp.tsx`

Responsibilities:

- Handle login and registration
- Persist the bearer token in local storage
- Search for shows
- Add and remove tracked shows
- Trigger metadata refresh
- Display:
  - provider windows
  - show-organized schedule view
  - calendar-organized schedule view
- Allow per-show manual provider overrides

The frontend is intentionally simple and thin. Most business logic lives in the backend so recommendation behavior is consistent across views.

## Backend responsibilities

Primary backend entrypoint:

- `backend/app/main.py`

Supporting modules:

- `auth.py` - password hashing, bearer token sessions, authenticated account loading
- `database.py` - SQLModel engine/session wiring
- `models.py` - SQLite-backed domain tables and UTC normalization helpers
- `planner.py` - provider window collapse and calendar grouping logic
- `tvmaze.py` - show search, episode ingestion, provider inference helpers
- `config.py` - `.env` loading and runtime configuration

The backend owns:

- account scoping
- canonical show metadata
- episode storage
- provider inference
- metadata TTL behavior
- dashboard response generation

## Data model

### `account`

Stores a user record with a username and password hash/salt pair.

### `auth_session`

Stores bearer token hashes and expiration timestamps. Tokens are created at login/registration and validated on each authenticated request.

### `catalog_show`

Canonical show metadata fetched from external sources. This is shared across accounts.

### `catalog_episode`

Upcoming and historical episode records tied to a canonical show.

### `show_availability`

Stores inferred provider information for a show in a region, currently focused on `US`.

### `tracked_show`

Account-scoped tracking state connecting a user to a canonical show, including an optional manual provider override.

### `metadata_refresh_job`

Lightweight audit trail for metadata refresh activity and failures.

## Request/data flow

## 1. Authentication

1. Frontend posts to `/auth/register` or `/auth/login`
2. Backend creates or validates the account
3. Backend creates a hashed auth session token
4. Frontend stores the raw bearer token locally
5. Future authenticated requests use `Authorization: Bearer ...`

## 2. Searching and tracking a show

1. Frontend calls `GET /shows/search?q=...`
2. Backend queries TVMaze search
3. Backend normalizes lightweight search results
4. User selects a show
5. Frontend posts `POST /tracked-shows`
6. Backend refreshes full show metadata if needed
7. Backend stores show, episodes, provider availability, and account tracking state

## 3. Building the dashboard

1. Frontend calls `GET /dashboard`
2. Backend loads account-scoped tracked shows
3. Backend resolves provider name:
   - manual override first
   - cached availability second
   - unknown fallback last
4. Backend filters episodes within the planning horizon
5. Backend uses `planner.py` to:
   - collapse provider months into subscription windows
   - build calendar buckets by month
6. Backend returns a single dashboard payload used by both frontend views

## Provider inference strategy

Current order:

1. TVMaze `webChannel`
2. deterministic mapping from traditional networks to likely US streaming homes
3. optional Ollama fallback if enabled
4. manual user override in tracked-show state

This prioritizes deterministic, inspectable behavior while still allowing a recovery path for ambiguous data.

## Time and timezone handling

SQLite may return naive datetimes even when the application created UTC-aware values. The backend normalizes persisted datetimes with `ensure_utc()` before comparing expiry or cache timestamps. This protects:

- auth session expiry checks
- metadata cache expiry checks
- serialized dashboard timestamps

## Runtime configuration

Key environment variables:

- `APP_HOST`
- `APP_PORT`
- `FRONTEND_PORT`
- `NEXT_PUBLIC_API_BASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `SESSION_TTL_DAYS`
- `METADATA_TTL_HOURS`
- `PLANNING_LOOKAHEAD_DAYS`
- `ENABLE_OLLAMA_FALLBACK`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`

Defaults are intentionally set to uncommon local ports to reduce clashes with other apps.

## Current limitations

- US-only provider planning
- No true provider entitlement API integration yet
- Provider inference is heuristic for some shows
- No background worker beyond synchronous request-driven refresh behavior
- No admin tools or conflict review queue yet

## Reasonable next steps

1. Add richer provider sources beyond TVMaze inference
2. Add a review state for low-confidence provider assignments
3. Add background refresh scheduling
4. Add import/export or shareable watchlists
5. Add stronger test coverage around auth flows and dashboard endpoints
