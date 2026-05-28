# Sub Schedule

Subscription planning for newly airing TV episodes.

Users create an account, search for series to track, and the app calculates which US streaming services need to be active month by month so they can watch new episodes without carrying unnecessary subscriptions between release windows.

## Stack

- **Backend:** FastAPI + SQLModel + SQLite
- **Frontend:** Next.js + React
- **Metadata source:** TVMaze-backed show search and episode schedules, with provider inference plus optional Ollama fallback for ambiguous cases

## Repository docs

- `README.md` - setup, run commands, and product overview
- `docs/architecture.md` - system shape, data flow, and backend/frontend responsibilities

## Current MVP behavior

- US-only provider planning
- Recommendations are based on **newly airing episodes**, not back-catalog availability
- Account-scoped tracked shows and provider overrides
- Two dashboard modes:
  - **Show view** for per-series provider + upcoming schedule
  - **Calendar view** for month-grouped releases and provider badges

## Local development

Copy `.env.example` to `.env` if you want to override defaults.

### Install dependencies

```bash
make install
```

### Run the full stack

```bash
make dev
```

Default local ports:

- Backend: `http://127.0.0.1:8787`
- Frontend: `http://127.0.0.1:3107`

You can override them at runtime:

```bash
BACKEND_PORT=8899 FRONTEND_PORT=3207 make dev
```

### Run validation

```bash
make test
```

That runs:

- backend pytest suite
- frontend ESLint
- frontend production build

## Repo layout

```text
.
├── backend/
│   ├── app/
│   │   ├── auth.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── planner.py
│   │   └── tvmaze.py
│   └── tests/
├── docs/
│   └── architecture.md
├── frontend/
│   └── src/
│       ├── app/
│       └── components/
├── Makefile
├── README.md
├── pytest.ini
└── requirements.txt
```

## Product flow

1. Create an account or sign in.
2. Search for a series.
3. Add the series to your tracked list.
4. Let the backend refresh and cache episode metadata.
5. Review provider windows in the show and calendar views.
6. Override provider assignments when source metadata is fuzzy.

## Useful API endpoints

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /account`
- `GET /shows/search?q=...`
- `POST /tracked-shows`
- `PATCH /tracked-shows/{id}`
- `POST /tracked-shows/{id}/refresh`
- `DELETE /tracked-shows/{id}`
- `GET /dashboard`
- `POST /dev/seed`

## Metadata notes

- Show search and episode schedules come from TVMaze.
- Provider inference prefers explicit streaming `webChannel` metadata.
- Traditional networks are mapped to likely US streaming homes where possible.
- If provider metadata is wrong or fuzzy, each tracked show can store a **manual provider override** without affecting other accounts.
- Optional Ollama fallback is controlled by:

```bash
ENABLE_OLLAMA_FALLBACK=1
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:latest
```

## Seed helper

There is a dev-only seed endpoint for quick local bootstrapping:

```bash
curl -X POST http://127.0.0.1:8787/dev/seed
```

That returns a demo token, account, and a starter tracked show.

## Notes and limitations

- Provider mapping is currently heuristic and US-focused.
- TVMaze gives strong show and episode data, but streaming-home inference is still best-effort for some traditional networks.
- The app is intentionally MVP-lean: SQLite storage, no background worker service, and no external auth provider yet.
