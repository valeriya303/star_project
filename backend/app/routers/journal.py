"""UC-09: журнал спостережень (F7, DS-7) та публічні журнали за згодою C-04."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Body, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, catalog_cache, consent
from ..db import get_db
from ..errors import ApiError, ValidationFailed, not_found, vf
from ..models import Consent, JournalEntry, Star, User, utcnow
from ..quality.user_data import validate_journal
from ..security import Ctx, deny, get_ctx, personal

router = APIRouter(tags=["UC-09 Журнал спостережень"])


def payload(db: Session, e: JournalEntry, public: bool = False) -> dict:
    nm = catalog_cache.names(db).get(e.star_hip)
    d = {
        "observation_id": e.id,
        "star_id": e.star_hip,
        "star_name": nm["name"] if nm else None,
        "observed_at": e.observed_at.isoformat(),
        "brightness_rating": e.brightness_rating,
        "conditions_rating": e.conditions_rating,
        "note": e.note,
        "created_at": e.created_at.isoformat(),
        "updated_at": e.updated_at.isoformat(),
    }
    if public:
        # Мінімізація: у публічному журналі місце округлено до 1°
        if e.observer_latitude is not None:
            d["observer_area"] = f"{round(e.observer_latitude)}°, {round(e.observer_longitude)}°"
    else:
        d["observer_latitude"] = e.observer_latitude
        d["observer_longitude"] = e.observer_longitude
    return d


def _star_exists(db: Session):
    vid = catalog_cache.active_version_id(db)

    def check(hip: int) -> bool:
        return bool(vid) and db.execute(select(Star.id).where(Star.version_id == vid, Star.hip == hip)).first() is not None

    return check


def _validate(db: Session, ctx: Ctx, body: dict, tz: str | None, oid: str | None) -> None:
    errors = validate_journal(body, tz, _star_exists(db))
    if errors:
        audit.log(ctx.actor, "AUD-20", "JournalEntry", oid, audit.DENIED, "QUALITY_RULES",
                  {"rules": sorted({e["rule_id"] or "" for e in errors})})
        raise ValidationFailed(errors)


@router.get("/journal")
def my_journal(ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    rows = db.execute(select(JournalEntry).where(JournalEntry.user_id == ctx.user.id)
                      .order_by(JournalEntry.observed_at.desc(), JournalEntry.created_at.desc())).scalars()
    is_public = consent.active(db, ctx.user.id, "C-04") is not None
    return {"is_public": is_public, "entries": [payload(db, e) for e in rows]}


@router.post("/journal", status_code=201)
def create(body: dict = Body(...), ctx: Ctx = Depends(personal), db: Session = Depends(get_db),
           x_timezone: str | None = Header(None)):
    oid = str(body.get("observation_id") or "")
    _validate(db, ctx, body, x_timezone, oid or None)
    if db.get(JournalEntry, oid):
        raise ApiError(409, "Запис із таким ідентифікатором уже існує", "DUPLICATE_ID")
    e = JournalEntry(
        id=oid, user_id=ctx.user.id, star_hip=int(body["star_id"]),
        observed_at=date.fromisoformat(body["observed_at"]),
        brightness_rating=body["brightness_rating"], conditions_rating=body["conditions_rating"],
        note=body.get("note", ""), observer_latitude=body.get("observer_latitude"),
        observer_longitude=body.get("observer_longitude"),
    )
    db.add(e)
    db.commit()
    audit.log(ctx.actor, "AUD-20", "JournalEntry", e.id, audit.SUCCESS, None, {"action": "create", "hip": e.star_hip})
    return payload(db, e)


def _own(db: Session, ctx: Ctx, oid: str) -> JournalEntry:
    e = db.get(JournalEntry, oid)
    if not e:
        raise not_found("Запис не знайдено")
    if e.user_id != ctx.user.id:  # EX1: вміст чужого журналу не розкривається
        raise deny(ctx, "JournalEntry", oid, "NOT_OWNER")
    return e


@router.get("/journal/{oid}")
def view(oid: str, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    e = _own(db, ctx, oid)
    audit.log(ctx.actor, "AUD-20", "JournalEntry", oid, audit.SUCCESS, None, {"action": "view"})
    return payload(db, e)


@router.put("/journal/{oid}")
def update(oid: str, body: dict = Body(...), ctx: Ctx = Depends(personal), db: Session = Depends(get_db),
           x_timezone: str | None = Header(None)):
    e = _own(db, ctx, oid)
    body = {**body, "observation_id": oid}
    _validate(db, ctx, body, x_timezone, oid)
    e.star_hip = int(body["star_id"])
    e.observed_at = date.fromisoformat(body["observed_at"])
    e.brightness_rating = body["brightness_rating"]
    e.conditions_rating = body["conditions_rating"]
    e.note = body.get("note", "")
    e.observer_latitude = body.get("observer_latitude")
    e.observer_longitude = body.get("observer_longitude")
    e.updated_at = utcnow()
    db.commit()
    audit.log(ctx.actor, "AUD-20", "JournalEntry", oid, audit.SUCCESS, None, {"action": "update"})
    return payload(db, e)


@router.delete("/journal/{oid}", status_code=204)
def remove(oid: str, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    e = _own(db, ctx, oid)
    db.delete(e)
    db.commit()
    audit.log(ctx.actor, "AUD-15", "JournalEntry", oid, audit.SUCCESS, None, {"reason": "user_request"})


# ------------------------------------------------------------ публічні журнали (C-04)
def _public_users(db: Session) -> list[User]:
    ids = {c.user_id for c in db.execute(select(Consent).where(
        Consent.consent_code == "C-04", Consent.status == "granted",
        Consent.consent_version == consent.CURRENT_VERSION)).scalars()}
    return [u for u in db.execute(select(User).where(User.id.in_(ids))).scalars()] if ids else []


@router.get("/public/journals")
def public_journals(db: Session = Depends(get_db)):
    out = []
    for u in _public_users(db):
        n = db.execute(select(JournalEntry.id).where(JournalEntry.user_id == u.id)).all()
        out.append({"user_id": u.id, "display_name": u.display_name or "Спостерігач", "entries": len(n)})
    return sorted(out, key=lambda x: -x["entries"])


@router.get("/public/journals/{user_id}")
def public_journal(user_id: str, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    # Згода перевіряється під час кожного запиту (DG-3 §5)
    if not consent.active(db, user_id, "C-04"):
        audit.log(ctx.actor, "AUD-06", "PublicJournal", user_id, audit.DENIED, "CONSENT_MISSING",
                  {"consent_code": "C-04"})
        raise ApiError(403, "Журнал цього користувача приватний", "JOURNAL_PRIVATE")
    u = db.get(User, user_id)
    rows = db.execute(select(JournalEntry).where(JournalEntry.user_id == user_id)
                      .order_by(JournalEntry.observed_at.desc())).scalars()
    return {"display_name": (u.display_name if u else "") or "Спостерігач",
            "entries": [payload(db, e, public=True) for e in rows]}


__all__ = ["router", "vf"]
