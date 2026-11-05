"""In-memory кеш чинного каталогу (AR-1: кешування для швидкої віддачі).

Кеш тримає стовпцевий набір зір активної версії, відсортований за яскравістю,
та довідник назв. Інвалідовується після активації нової версії каталогу
або даних сузір'їв.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CatalogVersion, Constellation, ConstellationVersion, Star, StarName

_lock = threading.Lock()
_state: dict = {}


def invalidate() -> None:
    with _lock:
        _state.clear()


def active_version_id(db: Session) -> str | None:
    if "vid" not in _state:
        v = db.execute(select(CatalogVersion.id).where(CatalogVersion.status == "active")).scalar_one_or_none()
        _state["vid"] = v
    return _state["vid"]


def active_sky_version_id(db: Session) -> str | None:
    if "skyid" not in _state:
        v = db.execute(select(ConstellationVersion.id).where(ConstellationVersion.status == "active")).scalar_one_or_none()
        _state["skyid"] = v
    return _state["skyid"]


I18N_FILE = Path(__file__).resolve().parent.parent / "data" / "stellarium" / "i18n_names.json"


def i18n_names() -> dict:
    """Переклади назв зір іншими мовами (Stellarium): {"languages": {...}, "stars": {english: {lang: [..]}}}."""
    if "i18n" not in _state:
        try:
            _state["i18n"] = json.loads(I18N_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _state["i18n"] = {"languages": {}, "stars": {}}
    return _state["i18n"]


def names(db: Session) -> dict[int, dict]:
    """hip → {"name": основна (укр.), "en": англ., "alt": [...], "langs": {назва: мова}}"""
    if "names" in _state:
        return _state["names"]
    sky = active_sky_version_id(db)
    out: dict[int, dict] = {}
    if sky:
        rows = db.execute(
            select(StarName.hip, StarName.name, StarName.lang, StarName.is_primary)
            .where(StarName.version_id == sky).order_by(StarName.id)
        ).all()
        for hip, name, lang, primary in rows:
            d = out.setdefault(hip, {"name": None, "en": None, "alt": [], "langs": {}})
            if lang == "uk" and d["name"] is None:
                d["name"] = name
            if lang == "en" and d["en"] is None:
                d["en"] = name
            if name not in d["alt"]:
                d["alt"].append(name)
            d["langs"].setdefault(name, lang)
        tr = i18n_names().get("stars", {})
        for d in out.values():
            d["name"] = d["name"] or d["en"]
            # Пошукові назви іншими мовами (у картці не показуються, лише для пошуку)
            for en in [n for n, lg in d["langs"].items() if lg == "en"]:
                for lang, variants in tr.get(en, {}).items():
                    for v in variants:
                        d["langs"].setdefault(v, lang)
    _state["names"] = out
    return out


def constellations(db: Session) -> dict[str, Constellation]:
    if "cons" in _state:
        return _state["cons"]
    sky = active_sky_version_id(db)
    out = {}
    if sky:
        for c in db.execute(select(Constellation).where(Constellation.version_id == sky)).scalars():
            out[c.abbr] = c
    _state["cons"] = out
    return out


def key_of(hip: int | None, source_id: str) -> int:
    """Ключ зорі в API: HIP або від'ємний ідентифікатор джерела (для записів HYG без HIP)."""
    if hip is not None:
        return hip
    try:
        return -abs(int(source_id))
    except ValueError:
        return -1


def compact(db: Session) -> dict:
    """Стовпцевий набір для карти, відсортований за зростанням Vmag."""
    if "compact" in _state:
        return _state["compact"]
    vid = active_version_id(db)
    cols = {k: [] for k in ("hip", "ra", "dec", "vmag", "bv", "pm_ra", "pm_dec", "dist_ly", "sp", "color", "con", "name")}
    if vid:
        nm = names(db)
        rows = db.execute(
            select(Star.hip, Star.source_id, Star.ra, Star.dec, Star.vmag, Star.bv, Star.pm_ra, Star.pm_dec,
                   Star.dist_pc, Star.sp_class, Star.color_hex, Star.con)
            .where(Star.version_id == vid, Star.is_map_visible.is_(True))
            .order_by(Star.vmag)
        ).all()
        for hip, sid, ra, dec, vmag, bv, pmra, pmde, dist, sp, color, con in rows:
            k = key_of(hip, sid)
            cols["hip"].append(k)
            cols["ra"].append(round(ra, 5))
            cols["dec"].append(round(dec, 5))
            cols["vmag"].append(round(vmag, 2))
            cols["bv"].append(None if bv is None else round(bv, 3))
            cols["pm_ra"].append(None if pmra is None else round(pmra, 2))
            cols["pm_dec"].append(None if pmde is None else round(pmde, 2))
            cols["dist_ly"].append(None if dist is None else round(dist * 3.26156, 1))
            cols["sp"].append(sp)
            cols["color"].append(int(color[1:], 16))
            cols["con"].append(con)
            n = nm.get(hip) if hip is not None else None
            cols["name"].append(n["name"] if n else None)
    _state["compact"] = cols
    return cols
