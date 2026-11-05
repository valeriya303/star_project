"""Пошук спостерігачів у спільноті.

Мінімізація даних (DG-8): спостерігач «видимий» лише тоді, коли він сам щось оприлюднив —
неанонімний схвалений знімок (згода C-02) або публічний журнал (згода C-04).
Показуються тільки вже публічні відомості: ім'я, під яким людина публікується, її публічні знімки
та записи журналу (місце з точністю до 1°). Анонімні знімки ніколи не пов'язуються з профілем,
e-mail, місто, обладнання та інші поля профілю не розкриваються.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import catalog_cache, photo_service, textsearch
from ..db import get_db
from ..errors import ApiError
from ..models import JournalEntry, Photo, PhotoStatus, User
from .journal import _public_users, payload

router = APIRouter(tags=["Спільнота: спостерігачі"])

DEFAULT_NAME = "Спостерігач"


def _aware(d: datetime | None) -> str:
    return d.isoformat() if d else ""


def _profiles(db: Session) -> dict[str, dict]:
    out: dict[str, dict] = {}

    def entry(u: User) -> dict:
        return out.setdefault(u.id, {
            "user": u, "aliases": [], "photos": 0, "constellations": Counter(), "journal_public": False,
            "journal_entries": 0, "last_activity": "", "latest_author": None,
        })

    photos = db.execute(
        select(Photo, User).join(User, User.id == Photo.owner_id)
        .where(Photo.is_public.is_(True), Photo.status == PhotoStatus.APPROVED, Photo.anonymous.is_(False))
        .order_by(Photo.published_at.desc())
    ).all()
    for p, u in photos:
        d = entry(u)
        d["photos"] += 1
        d["constellations"][p.constellation] += 1
        if p.author and p.author not in d["aliases"]:
            d["aliases"].append(p.author)
        d["latest_author"] = d["latest_author"] or p.author
        d["last_activity"] = max(d["last_activity"], _aware(p.published_at))

    for u in _public_users(db):
        d = entry(u)
        d["journal_public"] = True
        rows = db.execute(select(JournalEntry.observed_at).where(JournalEntry.user_id == u.id)).scalars().all()
        d["journal_entries"] = len(rows)
        if rows:
            d["last_activity"] = max(d["last_activity"], max(rows).isoformat())
    return out


def _card(db: Session, uid: str, d: dict) -> dict:
    u: User = d["user"]
    name = u.display_name or d["latest_author"] or DEFAULT_NAME
    cons = catalog_cache.constellations(db)
    by_latin = {c.latin: c.name_uk for c in cons.values()}
    return {
        "id": uid,
        "name": name,
        "also_known_as": [a for a in d["aliases"] if a != name][:3],
        "public_photos": d["photos"],
        "journal_public": d["journal_public"],
        "journal_entries": d["journal_entries"],
        "top_constellations": [by_latin.get(c, c) for c, _ in d["constellations"].most_common(3)],
        "last_activity": d["last_activity"][:10] or None,
    }


@router.get("/community/people")
def people(q: str = Query("", max_length=80), limit: int = Query(40, ge=1, le=100), db: Session = Depends(get_db)):
    """Пошук спостерігачів за ім'ям (кирилицею чи латиницею, з помилками розкладки)."""
    cards = [(_card(db, uid, d), d) for uid, d in _profiles(db).items()]
    if q.strip():
        qf = textsearch.query_forms(q)
        scored = []
        for c, _ in cards:
            sc = max(textsearch.score(qf, n) for n in [c["name"], *c["also_known_as"]])
            if sc > 0:
                scored.append((sc, c))
        scored.sort(key=lambda t: (-t[0], t[1]["name"]))
        items = [c for _, c in scored]
    else:
        items = sorted((c for c, _ in cards), key=lambda c: (-(c["public_photos"] + c["journal_entries"]), c["name"]))
    return {"total": len(cards), "items": items[:limit]}


@router.get("/community/people/{user_id}")
def person(user_id: str, db: Session = Depends(get_db)):
    d = _profiles(db).get(user_id)
    if not d:
        raise ApiError(404, "Спостерігача не знайдено або він нічого не оприлюднив", "PROFILE_NOT_PUBLIC")
    card = _card(db, user_id, d)
    photos = db.execute(
        select(Photo).where(Photo.owner_id == user_id, Photo.is_public.is_(True), Photo.status == PhotoStatus.APPROVED,
                            Photo.anonymous.is_(False)).order_by(Photo.published_at.desc())
    ).scalars()
    journal = None
    if d["journal_public"]:
        rows = db.execute(select(JournalEntry).where(JournalEntry.user_id == user_id)
                          .order_by(JournalEntry.observed_at.desc())).scalars()
        journal = [payload(db, e, public=True) for e in rows]
    return {**card, "photos": [photo_service.serialize(db, p, None, "public") for p in photos], "journal": journal}
