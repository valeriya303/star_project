"""UC-01: реєстрація та вхід (F1)."""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..errors import ApiError, ValidationFailed, vf
from ..models import AuthSession, Role, StarList, User, utcnow
from ..security import Ctx, get_ctx, hash_password, issue_token, rate_limit, require_user, verify_password

router = APIRouter(prefix="/auth", tags=["UC-01 Автентифікація"])

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class Credentials(BaseModel):
    email: str
    password: str


def user_payload(u: User) -> dict:
    return {"id": u.id, "email": u.email, "role": u.role, "display_name": u.display_name}


def _validate(email: str, password: str) -> list[dict]:
    errors = []
    if not EMAIL_RE.match(email) or len(email) > 254:
        errors.append(vf(None, "email", "Введіть коректну електронну адресу"))
    if len(password) < 8:
        errors.append(vf(None, "password", "Пароль має містити щонайменше 8 символів"))
    if len(password) > 128:
        errors.append(vf(None, "password", "Пароль не довший за 128 символів"))
    return errors


@router.post("/register", status_code=201)
def register(body: Credentials, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    rate_limit(f"reg:{ctx.ip}", 10, 600)
    email = body.email.strip().lower()
    errors = _validate(email, body.password)
    if errors:  # EX3
        audit.log(ctx.actor, "AUD-17", "UserAccount", None, audit.DENIED, "INVALID_INPUT")
        raise ValidationFailed(errors)
    if db.execute(select(User).where(User.email == email)).scalar_one_or_none():  # EX2
        audit.log(ctx.actor, "AUD-17", "UserAccount", None, audit.DENIED, "EMAIL_TAKEN")
        raise ApiError(409, "Цей email уже використовується. Увійдіть у наявний обліковий запис", "EMAIL_TAKEN")
    u = User(email=email, password_hash=hash_password(body.password), role=Role.OBSERVER)
    db.add(u)
    db.flush()
    db.add(StarList(user_id=u.id, name="Улюблені зорі", is_favorites=True))
    db.commit()
    audit.log(audit.Actor(u.id, u.role, ctx.ip), "AUD-17", "UserAccount", u.id, audit.SUCCESS)
    # Крок 9: показуємо форму входу з повідомленням — токен не видається автоматично
    return {"message": "Обліковий запис створено. Увійдіть, щоб продовжити", "user": user_payload(u)}


@router.post("/login")
def login(body: Credentials, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    rate_limit(f"login:{ctx.ip}", 10, 60)
    email = body.email.strip().lower()
    u = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not u or not verify_password(body.password, u.password_hash):  # EX1
        audit.log(ctx.actor, "AUD-02", "LoginAttempt", u.id if u else None, audit.DENIED, "INVALID_CREDENTIALS")
        raise ApiError(401, "Неправильний email або пароль", "INVALID_CREDENTIALS")
    token = issue_token(db, u)
    u.last_active_at = utcnow()
    u.inactivity_notified_at = None
    db.commit()
    audit.log(audit.Actor(u.id, u.role, ctx.ip), "AUD-01", "UserAccount", u.id, audit.SUCCESS)
    return {"token": token, "user": user_payload(u)}


@router.post("/logout", status_code=204)
def logout(ctx: Ctx = Depends(require_user), db: Session = Depends(get_db)):
    s = db.get(AuthSession, ctx.session_jti)
    if s:
        s.revoked_at = utcnow()
        db.commit()
    audit.log(ctx.actor, "AUD-18", "AuthSession", None, audit.SUCCESS)


@router.get("/me")
def me(ctx: Ctx = Depends(require_user)):
    return user_payload(ctx.user)


class ForgotBody(BaseModel):
    email: str


@router.post("/forgot-password", status_code=204)
def forgot(body: ForgotBody, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    """Відповідь однакова незалежно від наявності адреси (не розкриває облікові записи).
    У прототипі поштового сервісу немає: посилання з токеном пишеться в консоль сервера."""
    rate_limit(f"forgot:{ctx.ip}", 5, 600)
    u = db.execute(select(User).where(User.email == body.email.strip().lower())).scalar_one_or_none()
    if u:
        token = secrets.token_urlsafe(32)
        u.password_reset_hash = hashlib.sha256(token.encode()).hexdigest()
        u.password_reset_expires = utcnow() + timedelta(minutes=30)
        db.commit()
        print(f"[outbox] Скидання пароля: /reset-password?token={token}  (дійсне 30 хв)")
        audit.log(ctx.actor, "AUD-29", "UserAccount", u.id, audit.SUCCESS, None, {"stage": "requested"})


class ResetBody(BaseModel):
    token: str
    password: str


@router.post("/reset-password", status_code=204)
def reset(body: ResetBody, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    h = hashlib.sha256(body.token.encode()).hexdigest()
    u = db.execute(select(User).where(User.password_reset_hash == h)).scalar_one_or_none()
    from ..retention import _aware

    if not u or not u.password_reset_expires or _aware(u.password_reset_expires) < utcnow():
        audit.log(ctx.actor, "AUD-29", "UserAccount", None, audit.DENIED, "INVALID_TOKEN")
        raise ApiError(400, "Посилання недійсне або прострочене", "INVALID_TOKEN")
    if len(body.password) < 8:
        raise ValidationFailed([vf(None, "password", "Пароль має містити щонайменше 8 символів")])
    u.password_hash = hash_password(body.password)
    u.password_reset_hash = None
    u.password_reset_expires = None
    for s in db.execute(select(AuthSession).where(AuthSession.user_id == u.id, AuthSession.revoked_at.is_(None))).scalars():
        s.revoked_at = utcnow()
    db.commit()
    audit.log(audit.Actor(u.id, u.role, ctx.ip), "AUD-29", "UserAccount", u.id, audit.SUCCESS, None, {"stage": "completed"})
