"""Профіль, «Мої згоди» (UC-13), винагороди (UC-12 AC1), доступ до даних і видалення облікового запису."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, consent, photo_service, retention, storage
from ..config import settings
from ..db import get_db
from ..errors import ValidationFailed, vf
from ..models import Consent, JournalEntry, Photo, Reward, Role, StarList
from ..quality.user_data import inspect_image, thumbnail
from ..security import Ctx, deny, get_ctx, personal, require_user

router = APIRouter(tags=["Профіль і згоди"])


# ------------------------------------------------------------ профіль
def _profile(u) -> dict:
    return {
        "id": u.id, "email": u.email, "role": u.role, "name": u.display_name, "city": u.city,
        "equipment": u.equipment, "bio": u.bio,
        "avatar_url": storage.sign("avatar", u.id, "img", u.id) if u.avatar_key else None,
        "created_at": u.created_at.isoformat(),
    }


@router.get("/me/profile")
def profile(ctx: Ctx = Depends(require_user)):
    return _profile(ctx.user)


class ProfileBody(BaseModel):
    name: str = ""
    city: str = ""
    equipment: str = ""
    bio: str = ""


@router.patch("/me/profile")
def update_profile(body: ProfileBody, ctx: Ctx = Depends(require_user), db: Session = Depends(get_db)):
    errors = []
    limits = {"name": 50, "city": 80, "equipment": 120, "bio": 300}
    data = body.model_dump()
    for k, lim in limits.items():
        if len(data[k].strip()) > lim:
            errors.append(vf(None, k, f"Не більше {lim} символів"))
    if errors:
        raise ValidationFailed(errors)
    u = ctx.user
    u.display_name, u.city, u.equipment, u.bio = (data[k].strip() for k in ("name", "city", "equipment", "bio"))
    db.merge(u)
    db.commit()
    audit.log(ctx.actor, "AUD-27", "UserProfile", u.id, audit.SUCCESS, None, {"fields": list(limits)})
    return _profile(u)


@router.post("/me/avatar")
async def avatar(file: UploadFile = File(...), ctx: Ctx = Depends(require_user), db: Session = Depends(get_db)):
    data = await file.read(settings.max_avatar_bytes + 1)
    if len(data) > settings.max_avatar_bytes:
        raise ValidationFailed([vf("QR-13", "file", "Аватарка не більша за 5 МБ")])
    mime, *_ = inspect_image(data)
    if not mime:
        raise ValidationFailed([vf("QR-12", "file", "Аватарка: лише JPG або PNG")])
    u = ctx.user
    u.avatar_key = f"avatars/{u.id}.jpg"
    storage.store().put(u.avatar_key, thumbnail(data, 256), "image/jpeg")  # без EXIF
    db.merge(u)
    db.commit()
    audit.log(ctx.actor, "AUD-27", "UserProfile", u.id, audit.SUCCESS, None, {"fields": ["avatar"]})
    return _profile(u)


@router.delete("/me/avatar")
def delete_avatar(ctx: Ctx = Depends(require_user), db: Session = Depends(get_db)):
    u = ctx.user
    if u.avatar_key:
        storage.store().delete(u.avatar_key)
        u.avatar_key = None
        db.merge(u)
        db.commit()
    return _profile(u)


@router.get("/me/stats")
def stats(ctx: Ctx = Depends(require_user), db: Session = Depends(get_db)):
    uid = ctx.user.id
    points = photo_service.user_points(db, uid)
    journal = db.execute(select(JournalEntry.star_hip).where(JournalEntry.user_id == uid)).all()
    return {
        **photo_service.level_info(points),
        "journal_entries": len(journal),
        "unique_stars": len({h for (h,) in journal}),
        "lists": len(db.execute(select(StarList.id).where(StarList.user_id == uid)).all()),
        "photos": len(db.execute(select(Photo.id).where(Photo.owner_id == uid)).all()),
        "published_photos": len(db.execute(select(Photo.id).where(Photo.owner_id == uid, Photo.is_public.is_(True))).all()),
    }


@router.get("/me/rewards")
def rewards(ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    rows = db.execute(select(Reward).where(Reward.user_id == ctx.user.id).order_by(Reward.created_at.desc())).scalars()
    audit.log(ctx.actor, "AUD-26", "Reward", None, audit.SUCCESS)
    points = photo_service.user_points(db, ctx.user.id)
    return {**photo_service.level_info(points), "daily_limit": settings.reward_daily_limit,
            "points_per_photo": settings.reward_points_per_photo,
            "history": [photo_service.reward_payload(r) for r in rows]}


@router.get("/me/export")
def export(ctx: Ctx = Depends(require_user), db: Session = Depends(get_db)):
    """Право доступу до власних персональних даних (DG-8)."""
    from .journal import payload as jp
    from .lists import _payload as lp

    uid = ctx.user.id
    data = {
        "profile": {k: v for k, v in _profile(ctx.user).items() if k != "avatar_url"},
        "lists": [lp(db, lst) for lst in db.execute(select(StarList).where(StarList.user_id == uid)).scalars()],
        "journal": [jp(db, e) for e in db.execute(select(JournalEntry).where(JournalEntry.user_id == uid)).scalars()],
        "photos": [photo_service.serialize(db, p, ctx, "owner") for p in db.execute(select(Photo).where(Photo.owner_id == uid)).scalars()],
        "rewards": [photo_service.reward_payload(r) for r in db.execute(select(Reward).where(Reward.user_id == uid)).scalars()],
        "consents": [consent.serialize(c) for c in db.execute(select(Consent).where(Consent.user_id == uid)).scalars()],
    }
    for p in data["photos"]:
        p.pop("thumb_url", None)
        p.pop("full_url", None)
    return data


class DeleteBody(BaseModel):
    mode: str  # delete | anonymize
    confirm_email: str


@router.delete("/me")
def delete_me(body: DeleteBody, ctx: Ctx = Depends(require_user), db: Session = Depends(get_db)):
    """DG-7, табл. 2.34: видалення облікового запису з вибором видалення або анонімізації."""
    if body.mode not in ("delete", "anonymize"):
        raise ValidationFailed([vf(None, "mode", "Оберіть: видалити або знеособити матеріали")])
    if body.confirm_email.strip().lower() != ctx.user.email:
        raise ValidationFailed([vf(None, "confirm_email", "Для підтвердження введіть свою електронну адресу")])
    user = db.get(type(ctx.user), ctx.user.id)
    steps = retention.delete_account(db, ctx.actor, user, body.mode)
    return {"message": "Обліковий запис видалено", "steps": steps}


# ------------------------------------------------------------ UC-13 згоди
@router.get("/consents/texts")
def texts():
    return [consent.text_payload(c) for c in consent.CODES]


@router.get("/consents")
def my_consents(ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    rows = list(db.execute(select(Consent).where(Consent.user_id == ctx.user.id).order_by(Consent.updated_at.desc())).scalars())
    current = {}
    for code in consent.CODES:
        if consent.TEXTS[code]["scope"] == "function":
            c = consent.active(db, ctx.user.id, code)
            current[code] = consent.serialize(c) if c else None
    photos = {p.id: p.title for p in db.execute(select(Photo).where(Photo.owner_id == ctx.user.id)).scalars()}
    per_object = []
    for c in rows:
        if c.related_object_id and c.status == "granted":
            per_object.append({**consent.serialize(c), "object_title": photos.get(c.related_object_id)})
    return {"current": current, "per_object": per_object, "history": [consent.serialize(c) for c in rows],
            "texts": [consent.text_payload(c) for c in consent.CODES]}


class GrantBody(BaseModel):
    consent_code: str
    consent_version: str
    channel: str = "web"
    related_object_id: str | None = None


def _check_object(db: Session, ctx: Ctx, related: str | None):
    if related:
        p = db.get(Photo, related)
        if not p or p.owner_id != ctx.user.id:  # EX2: чужа згода/об'єкт
            raise deny(ctx, "Consent", related, "NOT_OWNER")


@router.post("/consents", status_code=201)
def grant(body: GrantBody, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    _check_object(db, ctx, body.related_object_id)
    c = consent.grant(db, ctx, body.consent_code, body.consent_version, body.channel, body.related_object_id)
    return consent.serialize(c)


class RevokeBody(BaseModel):
    consent_code: str
    related_object_id: str | None = None


@router.post("/consents/revoke")
def revoke(body: RevokeBody, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    _check_object(db, ctx, body.related_object_id)
    rows = consent.revoke(db, ctx, body.consent_code, body.related_object_id)
    return {"revoked": len(rows)}


__all__ = ["router", "get_ctx", "Role"]
