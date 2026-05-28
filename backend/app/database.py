from __future__ import annotations

from pathlib import Path
from typing import Iterator

from sqlmodel import Session, SQLModel, create_engine

from .config import DATABASE_URL


def _connect_args() -> dict[str, bool]:
    if DATABASE_URL.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def _prepare_database() -> None:
    if not DATABASE_URL.startswith("sqlite:///"):
        return

    database_path = DATABASE_URL.removeprefix("sqlite:///")
    if not database_path or database_path == ":memory:":
        return

    Path(database_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


_prepare_database()
engine = create_engine(DATABASE_URL, connect_args=_connect_args())


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session

