"""Автентифікація (JWT + bcrypt) і контроль доступу RBAC/ABAC (DG-2)."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import timedelta

import bcrypt
import jwt
from fastapi import Depends, Request
from sqlalchemy.orm import Session

from . import audit
from .config import settings
from .db import get_db
from .errors import ApiError, forbidden, unauthorized
from .models import AuthSession, Role, User, utcnow

GUEST = "GUEST"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except ValueError:
        return False


def issue_token(db: Session, user: User) -> str:
    now = utcnow()
    sess = AuthSession(user_id=user.id, expires_at=now + timedelta(hours=settings.jwt_ttl_hours))
    db.add(sess)
    db.flush()
    payload = {
        "sub": user.id,
        "role": user.role,
        "jti": sess.jti,
        "iat": int(now.timestamp()),
        "exp": int(sess.expires_at.timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


@dataclass
class Ctx:
    user: User | None
    session_jti: str | None
    ip: str | None
    token_error: str | None = None

    @property
    def role(self) -> str:
        return self.user.role if self.user else GUEST

    @property
    def actor(self) -> audit.Actor:
        return audit.Actor(id=self.user.id if self.user else None, role=self.role, ip=self.ip)


def get_ctx(request: Request, db: Session = Depends(get_db)) -> Ctx:
    ip = client_ip(request)
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return Ctx(None, None, ip)
    token = header[7:].strip()
    try:
        data = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        return Ctx(None, None, ip, "SESSION_EXPIRED")
    except jwt.PyJWTError:
        return Ctx(None, None, ip, "INVALID_TOKEN")
    sess = db.get(AuthSession, data.get("jti"))
    now = utcnow()
    if not sess or sess.revoked_at is not None or _aware(sess.expires_at) < now:
        return Ctx(None, None, ip, "SESSION_REVOKED")
    user = db.get(User, data.get("sub"))
    if not user:
        return Ctx(None, None, ip, "SESSION_REVOKED")
    if (now - _aware(user.last_active_at)).total_seconds() > 600:
        user.last_active_at = now
        user.inactivity_notified_at = None
        db.commit()
    return Ctx(user, sess.jti, ip)


def _aware(dt):
    from datetime import timezone

    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def deny(ctx: Ctx, object_type: str, object_id=None, reason: str = "INSUFFICIENT_PERMISSIONS",
         message: str = "Доступ заборонено") -> ApiError:
    """Фіксує відмову (AUD-03) і повертає 403."""
    audit.log(ctx.actor, "AUD-03", object_type, object_id, audit.DENIED, reason)
    return forbidden(message, reason)


def require_user(ctx: Ctx = Depends(get_ctx)) -> Ctx:
    """AP-07: операції, що потребують входу, повертають 401 і фіксуються в аудиті."""
    if ctx.user is None:
        reason = ctx.token_error or "UNAUTHENTICATED"
        audit.log(ctx.actor, "AUD-03", "ProtectedResource", None, audit.DENIED, reason)
        msg = "Сесія закінчилася. Увійдіть повторно" if ctx.token_error else "Потрібна автентифікація"
        raise unauthorized(msg)
    return ctx


def require_roles(*roles: str):
    def dep(ctx: Ctx = Depends(require_user)) -> Ctx:
        if ctx.role not in roles:
            raise deny(ctx, "RoleProtectedResource", None, "INSUFFICIENT_PERMISSIONS")
        return ctx

    return dep


# Матриця 2.21: особисті ресурси (списки, журнал, знімки, винагороди, згоди) — 🔸
# для Спостерігача й Модератора; DG Admin — ❌.
personal = require_roles(Role.OBSERVER, Role.MODERATOR)
moderator_only = require_roles(Role.MODERATOR)
admin_only = require_roles(Role.DG_ADMIN)


def ensure_owner(ctx: Ctx, owner_id: str | None, object_type: str, object_id) -> None:
    """AP-01: доступ лише до власних записів."""
    if ctx.user is None or owner_id != ctx.user.id:
        raise deny(ctx, object_type, object_id, "NOT_OWNER")


# ----------------------------------------------------------- обмеження частоти
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(key: str, limit: int, window_s: int) -> None:
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > window_s:
        q.popleft()
    if len(q) >= limit:
        raise ApiError(429, "Забагато спроб. Спробуйте пізніше", "RATE_LIMITED")
    q.append(now)
