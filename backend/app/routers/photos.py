"""Знімки: UC-10, UC-21…UC-24; модерація UC-11; галерея; скарги; файли."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, File, Form, Header, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, photo_service, storage
from ..config import settings
from ..db import get_db
from ..errors import ApiError, ValidationFailed, not_found, vf
from ..models import Complaint, ModerationDecision, Photo, PhotoStatus, Role, User, utcnow
from ..quality.user_data import CONSTELLATIONS_88, LICENSES, strip_gps
from ..security import Ctx, get_ctx, moderator_only, personal, require_user

router = APIRouter(tags=["Знімки сузір'їв"])


@router.get("/photos/options")
def options():
    return {
        "constellations": CONSTELLATIONS_88,
        "licenses": [
            {"id": "CC0-1.0", "title": "CC0 1.0 — передача в суспільне надбання",
             "url": "https://creativecommons.org/publicdomain/zero/1.0/"},
            {"id": "CC-BY-4.0", "title": "CC BY 4.0 — із зазначенням авторства",
             "url": "https://creativecommons.org/licenses/by/4.0/"},
            {"id": "CC-BY-SA-4.0", "title": "CC BY-SA 4.0 — із зазначенням авторства, на тих самих умовах",
             "url": "https://creativecommons.org/licenses/by-sa/4.0/"},
        ],
        "max_bytes": settings.max_photo_bytes,
        "min_width": 800,
        "min_height": 600,
    }


@router.get("/photos")
def my_photos(ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    rows = db.execute(select(Photo).where(Photo.owner_id == ctx.user.id).order_by(Photo.created_at.desc())).scalars()
    return [photo_service.serialize(db, p, ctx, "owner") for p in rows]


@router.post("/photos", status_code=201)
async def upload(
    file: UploadFile = File(...),
    metadata: str = Form("{}"),
    ctx: Ctx = Depends(personal),
    db: Session = Depends(get_db),
    x_timezone: str | None = Header(None),
):
    data = await file.read(settings.max_photo_bytes + 1)
    p = photo_service.upload(db, ctx, data, file.filename or "image", metadata, x_timezone)
    return photo_service.serialize(db, p, ctx, "owner")


@router.patch("/photos/{photo_id}")
def edit(photo_id: str, body: dict = Body(...), ctx: Ctx = Depends(personal), db: Session = Depends(get_db),
         x_timezone: str | None = Header(None)):
    p = photo_service.get_owned(db, ctx, photo_id)
    p = photo_service.update_metadata(db, ctx, p, body, x_timezone)
    return photo_service.serialize(db, p, ctx, "owner")


class SubmitBody(BaseModel):
    author: str | None = None
    anonymous: bool | None = None
    license: str | None = None


@router.post("/photos/{photo_id}/submit")
def submit(photo_id: str, body: SubmitBody | None = None, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    p = photo_service.get_owned(db, ctx, photo_id)
    choice = {k: v for k, v in (body.model_dump() if body else {}).items() if v is not None}
    p = photo_service.submit(db, ctx, p, choice or None)
    return photo_service.serialize(db, p, ctx, "owner")


@router.post("/photos/{photo_id}/withdraw")
def withdraw(photo_id: str, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    p = photo_service.withdraw(db, ctx, photo_service.get_owned(db, ctx, photo_id))
    return photo_service.serialize(db, p, ctx, "owner")


@router.post("/photos/{photo_id}/republish")
def republish(photo_id: str, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    p = photo_service.republish(db, ctx, photo_service.get_owned(db, ctx, photo_id))
    return photo_service.serialize(db, p, ctx, "owner")


@router.delete("/photos/{photo_id}", status_code=204)
def delete(photo_id: str, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    photo_service.delete_photo(db, ctx.actor, photo_service.get_owned(db, ctx, photo_id))


# ------------------------------------------------------------ публічна галерея
@router.get("/gallery")
def gallery(constellation: str | None = None, limit: int = Query(60, ge=1, le=200), db: Session = Depends(get_db)):
    q = select(Photo).where(Photo.is_public.is_(True), Photo.status == PhotoStatus.APPROVED)
    if constellation:
        q = q.where(Photo.constellation == constellation)
    rows = db.execute(q.order_by(Photo.published_at.desc()).limit(limit)).scalars()
    return [photo_service.serialize(db, p, None, "public") for p in rows]


class ComplaintBody(BaseModel):
    reason: str
    comment: str = ""


COMPLAINT_REASONS = {"copyright": "Порушення авторських прав", "privacy": "Порушення приватності",
                     "inappropriate": "Недоречний вміст", "wrong_info": "Неправильні відомості"}


@router.post("/gallery/{photo_id}/complaints", status_code=201)
def complain(photo_id: str, body: ComplaintBody, ctx: Ctx = Depends(require_user), db: Session = Depends(get_db)):
    p = db.get(Photo, photo_id)
    if not p or not p.is_public:
        raise not_found("Знімок не знайдено")
    if body.reason not in COMPLAINT_REASONS:
        raise ValidationFailed([vf(None, "reason", "Оберіть причину скарги")])
    c = Complaint(photo_id=p.id, reporter_id=ctx.user.id, reason=body.reason, comment=body.comment[:1000])
    db.add(c)
    db.commit()
    audit.log(ctx.actor, "AUD-28", "Complaint", c.id, audit.SUCCESS, None, {"photo_id": p.id, "reason": body.reason})
    return {"id": c.id, "message": "Скаргу передано модераторам"}


# ------------------------------------------------------------ UC-11 модерація
@router.get("/moderation/queue")
def queue(ctx: Ctx = Depends(moderator_only), db: Session = Depends(get_db)):
    rows = db.execute(select(Photo).where(Photo.status == PhotoStatus.SUBMITTED).order_by(Photo.submitted_at)).scalars()
    out = []
    for p in rows:
        d = photo_service.serialize(db, p, ctx, "moderator")
        d["is_own"] = p.owner_id == ctx.user.id  # власні знімки модерує інший модератор (AP-02)
        out.append(d)
    return out


class DecisionBody(BaseModel):
    version: int
    reason: str = ""


@router.post("/moderation/photos/{photo_id}/approve")
def approve(photo_id: str, body: DecisionBody, ctx: Ctx = Depends(moderator_only), db: Session = Depends(get_db)):
    return photo_service.moderate(db, ctx, photo_id, "approve", body.version, body.reason)


@router.post("/moderation/photos/{photo_id}/reject")
def reject(photo_id: str, body: DecisionBody, ctx: Ctx = Depends(moderator_only), db: Session = Depends(get_db)):
    return photo_service.moderate(db, ctx, photo_id, "reject", body.version, body.reason)


@router.get("/moderation/decisions")
def decisions(ctx: Ctx = Depends(moderator_only), db: Session = Depends(get_db)):
    rows = db.execute(select(ModerationDecision).order_by(ModerationDecision.created_at.desc()).limit(100)).scalars()
    return [{"id": d.id, "photo_id": d.photo_id, "photo_version": d.photo_version, "decision": d.decision,
             "reason": d.reason, "previous_status": d.previous_status, "new_status": d.new_status,
             "by_me": d.moderator_id == ctx.user.id, "created_at": d.created_at.isoformat()} for d in rows]


@router.get("/moderation/complaints")
def complaints(ctx: Ctx = Depends(moderator_only), db: Session = Depends(get_db)):
    rows = db.execute(select(Complaint).where(Complaint.status == "open").order_by(Complaint.created_at)).scalars()
    out = []
    for c in rows:
        p = db.get(Photo, c.photo_id)
        out.append({"id": c.id, "reason": c.reason, "reason_label": COMPLAINT_REASONS.get(c.reason, c.reason),
                    "comment": c.comment, "created_at": c.created_at.isoformat(),
                    "photo": photo_service.serialize(db, p, ctx, "moderator") if p else None,
                    "is_own": bool(p and p.owner_id == ctx.user.id)})
    return out


class ResolveBody(BaseModel):
    action: str  # uphold | dismiss


@router.post("/moderation/complaints/{cid}")
def resolve(cid: str, body: ResolveBody, ctx: Ctx = Depends(moderator_only), db: Session = Depends(get_db)):
    c = db.get(Complaint, cid)
    if not c or c.status != "open":
        raise not_found("Скаргу не знайдено")
    p = db.get(Photo, c.photo_id)
    if p and p.owner_id == ctx.user.id:
        audit.log(ctx.actor, "AUD-28", "Complaint", cid, audit.DENIED, "SELF_MODERATION")
        raise ApiError(403, "Скаргу на власний знімок розглядає інший модератор", "SELF_MODERATION")
    if body.action not in ("uphold", "dismiss"):
        raise ValidationFailed([vf(None, "action", "Допустимі дії: uphold, dismiss")])
    c.status = "upheld" if body.action == "uphold" else "dismissed"
    c.resolved_by = ctx.user.id
    c.resolved_at = utcnow()
    db.commit()
    if body.action == "uphold" and p:
        photo_service.hide(db, ctx.actor, p, "complaint_upheld")
    audit.log(ctx.actor, "AUD-28", "Complaint", cid, audit.SUCCESS, None, {"action": body.action})
    return {"status": c.status}


# ------------------------------------------------------------ контрольована видача файлів
@router.get("/files/photo/{photo_id}/{variant}")
def photo_file(photo_id: str, variant: str, v: str | None = None, exp: int = 0, sig: str = "",
               db: Session = Depends(get_db)):
    if variant not in ("thumb", "full"):
        raise not_found()
    p = db.get(Photo, photo_id)
    if not p:
        raise not_found()
    allowed = p.is_public and p.status == PhotoStatus.APPROVED
    if not allowed and v and storage.check_sig("photo", photo_id, variant, v, exp, sig):
        viewer = db.get(User, v)
        allowed = bool(viewer) and (viewer.id == p.owner_id or
                                    (viewer.role == Role.MODERATOR and p.status in (PhotoStatus.SUBMITTED, PhotoStatus.APPROVED)))
    if not allowed:
        audit.log(audit.Actor(v, "UNKNOWN"), "AUD-03", "PhotoFile", photo_id, audit.DENIED, "NO_ACCESS")
        raise ApiError(403, "Доступ до файлу заборонено", "NO_ACCESS")
    st = storage.store()
    if variant == "thumb":
        return Response(st.get(p.thumb_key), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})
    data = st.get(p.file_key)
    owner_view = v is not None and v == p.owner_id
    if p.gps_stored and not owner_view:
        data = strip_gps(data, p.file_format)  # GPS не розкривається публічно навіть за згоди C-03
    return Response(data, media_type=p.file_format, headers={"Cache-Control": "private, max-age=300"})


@router.get("/files/avatar/{user_id}/img")
def avatar_file(user_id: str, v: str = "", exp: int = 0, sig: str = "", db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u or not u.avatar_key or not storage.check_sig("avatar", user_id, "img", v, exp, sig) or v != user_id:
        raise ApiError(403, "Доступ до файлу заборонено", "NO_ACCESS")
    return Response(storage.store().get(u.avatar_key), media_type="image/jpeg")


__all__ = ["router", "get_ctx"]
