"""UC-06: керування списками улюблених зір (F4, DS-6)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, catalog_cache
from ..db import get_db
from ..errors import ApiError, ValidationFailed, not_found, vf
from ..models import Star, StarList, StarListItem
from ..security import Ctx, deny, personal
from .stars import summary

router = APIRouter(prefix="/lists", tags=["UC-06 Списки"])


class NameBody(BaseModel):
    name: str


def _payload(db: Session, lst: StarList, with_stars: bool = False) -> dict:
    d = {"id": lst.id, "name": lst.name, "is_favorites": lst.is_favorites, "hips": [i.hip for i in lst.items]}
    if with_stars:
        vid = catalog_cache.active_version_id(db)
        hips = d["hips"]
        rows = {s.hip: s for s in db.execute(select(Star).where(Star.version_id == vid, Star.hip.in_(hips))).scalars()} if vid and hips else {}
        d["stars"] = [summary(db, rows[h]) if h in rows else {"hip": h, "unavailable": True} for h in hips]
    return d


def _ensure_favorites(db: Session, ctx: Ctx) -> None:
    fav = db.execute(select(StarList).where(StarList.user_id == ctx.user.id, StarList.is_favorites.is_(True))).scalar_one_or_none()
    if not fav:
        db.add(StarList(user_id=ctx.user.id, name="Улюблені зорі", is_favorites=True))
        db.commit()


def _own(db: Session, ctx: Ctx, list_id: str) -> StarList:
    lst = db.get(StarList, list_id)
    if not lst:
        raise not_found("Список не знайдено")
    if lst.user_id != ctx.user.id:  # EX2 / AP-01
        raise deny(ctx, "StarList", list_id, "NOT_OWNER")
    return lst


def _clean_name(name: str) -> str:
    n = name.strip()
    if not n:  # EX4
        raise ValidationFailed([vf(None, "name", "Введіть назву списку")])
    if len(n) > 100:
        raise ValidationFailed([vf(None, "name", "Назва не довша за 100 символів")])
    return n


@router.get("")
def my_lists(ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    _ensure_favorites(db, ctx)
    rows = db.execute(select(StarList).where(StarList.user_id == ctx.user.id)
                      .order_by(StarList.is_favorites.desc(), StarList.created_at)).scalars()
    return [_payload(db, lst) for lst in rows]


@router.post("", status_code=201)
def create(body: NameBody, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    lst = StarList(user_id=ctx.user.id, name=_clean_name(body.name))
    db.add(lst)
    db.commit()
    audit.log(ctx.actor, "AUD-19", "StarList", lst.id, audit.SUCCESS, None, {"action": "create"})
    return _payload(db, lst)


@router.get("/{list_id}")
def get_list(list_id: str, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    return _payload(db, _own(db, ctx, list_id), with_stars=True)


@router.patch("/{list_id}")
def rename(list_id: str, body: NameBody, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    lst = _own(db, ctx, list_id)
    lst.name = _clean_name(body.name)
    db.commit()
    audit.log(ctx.actor, "AUD-19", "StarList", lst.id, audit.SUCCESS, None, {"action": "rename"})
    return _payload(db, lst)


@router.delete("/{list_id}", status_code=204)
def remove(list_id: str, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    lst = _own(db, ctx, list_id)
    if lst.is_favorites:
        raise ApiError(409, "Список «Улюблені зорі» не можна видалити", "PROTECTED_LIST")
    db.delete(lst)
    db.commit()
    audit.log(ctx.actor, "AUD-19", "StarList", list_id, audit.SUCCESS, None, {"action": "delete"})


@router.put("/{list_id}/stars/{hip}", status_code=201)
def add_star(list_id: str, hip: int, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    lst = _own(db, ctx, list_id)
    vid = catalog_cache.active_version_id(db)
    if not vid or not db.execute(select(Star.id).where(Star.version_id == vid, Star.hip == hip)).first():
        raise ValidationFailed([vf("QR-21", "hip", "Зорі з таким ідентифікатором немає в каталозі")])
    if any(i.hip == hip for i in lst.items):  # EX3
        raise ApiError(409, "Зоря вже є у цьому списку", "ALREADY_IN_LIST")
    lst.items.append(StarListItem(hip=hip))
    db.commit()
    audit.log(ctx.actor, "AUD-19", "StarList", lst.id, audit.SUCCESS, None, {"action": "add_star", "hip": hip})
    return _payload(db, lst)


@router.delete("/{list_id}/stars/{hip}", status_code=204)
def remove_star(list_id: str, hip: int, ctx: Ctx = Depends(personal), db: Session = Depends(get_db)):
    lst = _own(db, ctx, list_id)
    item = next((i for i in lst.items if i.hip == hip), None)
    if not item:
        raise not_found("Зорі немає в цьому списку")
    lst.items.remove(item)
    db.commit()
    audit.log(ctx.actor, "AUD-19", "StarList", lst.id, audit.SUCCESS, None, {"action": "remove_star", "hip": hip})
