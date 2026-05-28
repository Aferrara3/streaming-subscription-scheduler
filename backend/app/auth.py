from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, select

from .config import SESSION_TTL_DAYS
from .database import get_session
from .models import Account, AuthSession, ensure_utc


security = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    account: Account
    token_hash: str


def hash_password(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def verify_password(password: str, salt: str, password_hash: str) -> bool:
    return hash_password(password, salt) == password_hash


def create_password_credentials(password: str) -> tuple[str, str]:
    salt = secrets.token_hex(16)
    return salt, hash_password(password, salt)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_auth_session(session: Session, account_id: int) -> str:
    raw_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    auth_session = AuthSession(
        account_id=account_id,
        token_hash=hash_token(raw_token),
        created_at=now,
        last_used_at=now,
        expires_at=now + timedelta(days=SESSION_TTL_DAYS),
    )
    session.add(auth_session)
    session.commit()
    return raw_token


def require_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
    session: Session = Depends(get_session),
) -> AuthContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    token_hash = hash_token(credentials.credentials)
    auth_session = session.exec(select(AuthSession).where(AuthSession.token_hash == token_hash)).first()
    if auth_session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    if ensure_utc(auth_session.expires_at) < datetime.now(timezone.utc):
        session.delete(auth_session)
        session.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    account = session.get(Account, auth_session.account_id)
    if account is None:
        session.delete(auth_session)
        session.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    auth_session.last_used_at = datetime.now(timezone.utc)
    session.add(auth_session)
    session.commit()
    session.refresh(account)
    return AuthContext(account=account, token_hash=token_hash)
