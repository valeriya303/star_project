"""Каталог і пошук зір: UC-02, UC-03, UC-04, UC-05, UC-16, UC-17 (ICatalog, ISearch)."""
from __future__ import annotations

import bisect
import math
import re

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import catalog_cache, textsearch
from ..db import get_db
from ..errors import ApiError, ValidationFailed, not_found, vf
from ..models import CatalogVersion, Star
from ..sky import ABBR_TO_LATIN

router = APIRouter(prefix="/stars", tags=["Каталог зір"])

LY_PER_PC = 3.26156
FAST_PM_MAS = 500
SPECTRAL = set("OBAFGKM")


def _require_catalog(db: Session) -> str:
    vid = catalog_cache.active_version_id(db)
    if not vid:
        raise ApiError(503, "Каталог ще не імпортовано. Зверніться до адміністратора даних", "CATALOG_UNAVAILABLE")
    return vid


def summary(db: Session, s: Star) -> dict:
    nm = catalog_cache.names(db).get(s.hip) if s.hip is not None else None
    cons = catalog_cache.constellations(db)
    c = cons.get(s.con or "")
    return {
        "hip": catalog_cache.key_of(s.hip, s.source_id),
        "name": nm["name"] if nm else None,
        "alt_names": nm["alt"] if nm else [],
        "hd": s.hd,
        "ra": s.ra,
        "dec": s.dec,
        "vmag": s.vmag,
        "bv": s.bv,
        "sp_type": s.sp_type,
        "constellation": s.con,
        "constellation_uk": c.name_uk if c else (ABBR_TO_LATIN.get(s.con or "") or None),
    }


def _get(db: Session, vid: str, key: int) -> Star | None:
    q = select(Star).where(Star.version_id == vid)
    q = q.where(Star.hip == key) if key > 0 else q.where(Star.hip.is_(None), Star.source_id == str(-key))
    return db.execute(q).scalar_one_or_none()


# ------------------------------------------------------------ UC-02 / AD-06
@router.get("/compact")
def compact(
    vmag_min: float | None = None,
    vmag_max: float = 6.5,
    ra_min: float | None = None,
    ra_max: float | None = None,
    dec_min: float = -90,
    dec_max: float = 90,
    db: Session = Depends(get_db),
):
    """Стовпцевий набір для карти. Спершу передаються яскраві зорі, слабші — для поточної області."""
    _require_catalog(db)
    if vmag_min is not None and vmag_min > vmag_max:
        raise ValidationFailed([vf(None, "vmag_min", "Нижня межа перевищує верхню")])
    cols = catalog_cache.compact(db)
    mags = cols["vmag"]
    lo = 0 if vmag_min is None else bisect.bisect_right(mags, vmag_min)
    hi = bisect.bisect_right(mags, vmag_max)
    idx = range(lo, hi)
    bbox = ra_min is not None and ra_max is not None
    if bbox or dec_min > -90 or dec_max < 90:
        ras, decs = cols["ra"], cols["dec"]

        def inside(i):
            if not (dec_min <= decs[i] <= dec_max):
                return False
            if not bbox:
                return True
            r = ras[i]
            return ra_min <= r <= ra_max if ra_min <= ra_max else (r >= ra_min or r <= ra_max)

        idx = [i for i in idx if inside(i)]
    else:
        idx = list(idx)
    out = {k: [v[i] for i in idx] for k, v in cols.items()}
    return {"count": len(idx), "version_id": catalog_cache.active_version_id(db), "columns": out}


# ------------------------------------------------------------ UC-04
@router.get("")
def list_stars(
    vmag_min: float | None = None,
    vmag_max: float | None = None,
    dist_min_ly: float | None = None,
    dist_max_ly: float | None = None,
    classes: str | None = Query(None, description="Наприклад: A,F,G"),
    bv_min: float | None = None,
    bv_max: float | None = None,
    pm_min: float | None = None,
    pm_max: float | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    vid = _require_catalog(db)
    errors = []
    for a, b, name in ((vmag_min, vmag_max, "vmag"), (dist_min_ly, dist_max_ly, "dist"), (bv_min, bv_max, "bv"),
                       (pm_min, pm_max, "pm")):
        if a is not None and b is not None and a > b:
            errors.append(vf(None, f"{name}_min", "Нижня межа перевищує верхню"))
    cls = None
    if classes:
        cls = {c.strip().upper() for c in classes.split(",") if c.strip()}
        if not cls <= SPECTRAL:
            errors.append(vf(None, "classes", "Допустимі спектральні класи: O, B, A, F, G, K, M"))
    if errors:
        raise ValidationFailed(errors)
    q = select(Star).where(Star.version_id == vid, Star.is_map_visible.is_(True))
    if vmag_min is not None:
        q = q.where(Star.vmag >= vmag_min)
    if vmag_max is not None:
        q = q.where(Star.vmag <= vmag_max)
    if cls:
        q = q.where(Star.sp_class.in_(cls))
    if bv_min is not None:
        q = q.where(Star.bv >= bv_min)
    if bv_max is not None:
        q = q.where(Star.bv <= bv_max)
    if pm_min is not None:
        q = q.where(Star.pm_total >= pm_min)
    if pm_max is not None:
        q = q.where(Star.pm_total <= pm_max)
    excluded = 0
    if dist_min_ly is not None or dist_max_ly is not None:
        # EX2: записи без надійної відстані виключаються й рахуються окремо
        from sqlalchemy import func

        excluded = db.execute(select(func.count()).select_from(q.where(Star.dist_pc.is_(None)).subquery())).scalar_one()
        q = q.where(Star.dist_pc.is_not(None))
        if dist_min_ly is not None:
            q = q.where(Star.dist_pc >= dist_min_ly / LY_PER_PC)
        if dist_max_ly is not None:
            q = q.where(Star.dist_pc <= dist_max_ly / LY_PER_PC)
    from sqlalchemy import func

    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = db.execute(q.order_by(Star.vmag).offset(offset).limit(limit)).scalars().all()
    return {"count": total, "excluded_no_distance": excluded, "items": [summary(db, s) for s in rows]}


# ------------------------------------------------------------ UC-03
COORD_RE = re.compile(r"^\s*(-?\d+(?:[.,]\d+)?)\s*[ ,;]\s*([+-]?\d+(?:[.,]\d+)?)\s*$")
ID_RE = re.compile(r"^\s*(hip|hd)?\s*(\d+)\s*$", re.I)


def search_names(db: Session, q: str, limit: int) -> list[tuple[int, str, str]]:
    """Багатомовний нечіткий пошук: (hip, назва, за якою знайдено, мова цієї назви)."""
    qf = textsearch.query_forms(q)
    if not qf:
        return []
    scored: list[tuple[float, int, str, str]] = []
    for hip, d in catalog_cache.names(db).items():
        best, matched, lang = 0.0, "", ""
        for n, lg in d["langs"].items():
            sc = textsearch.score(qf, n)
            # за рівної оцінки перевага українській, потім англійській назві
            sc += {"uk": 0.02, "en": 0.01}.get(lg, 0)
            if sc > best:
                best, matched, lang = sc, n, lg
        if best > 0.02:
            scored.append((best, hip, matched, lang))
    scored.sort(key=lambda t: -t[0])
    return [(h, m, lg) for _, h, m, lg in scored[:limit]]


def angular_distance(ra1, dec1, ra2, dec2) -> float:
    r1, d1, r2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    c = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(r1 - r2)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def _validate_cone(ra, dec, radius) -> list[dict]:
    errors = []
    if not (0 <= ra < 360):
        errors.append(vf(None, "ra", "Пряме піднесення: 0° ≤ α < 360°"))
    if not (-90 <= dec <= 90):
        errors.append(vf(None, "dec", "Схилення: −90° ≤ δ ≤ 90°"))
    if not (0 < radius <= 180):
        errors.append(vf(None, "radius", "Радіус: 0° < r ≤ 180°"))
    return errors


def cone_search(db: Session, ra: float, dec: float, radius: float, limit: int, vmag_max: float | None = None):
    cols = catalog_cache.compact(db)
    res = []
    for i, (r, d) in enumerate(zip(cols["ra"], cols["dec"])):
        if vmag_max is not None and cols["vmag"][i] > vmag_max:
            break
        if abs(d - dec) > radius:
            continue
        dist = angular_distance(ra, dec, r, d)
        if dist <= radius:
            res.append((dist, cols["hip"][i]))
    res.sort()
    return res[:limit]


def _summaries_by_keys(db: Session, keys: list[int]) -> list[dict]:
    vid = _require_catalog(db)
    pos = [k for k in keys if k > 0]
    rows = {s.hip: s for s in db.execute(select(Star).where(Star.version_id == vid, Star.hip.in_(pos))).scalars()} if pos else {}
    out = []
    for k in keys:
        s = rows.get(k) if k > 0 else _get(db, vid, k)
        if s:
            out.append(summary(db, s))
    return out


@router.get("/search")
def search(q: str = Query(..., max_length=100), limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    """Автодоповнення: назва (укр./англ., альтернативні назви), «HIP 32349», «HD 48915» або «RA Dec» у градусах."""
    vid = _require_catalog(db)
    if not q.strip():
        raise ValidationFailed([vf(None, "q", "Введіть пошуковий запит")])
    m = COORD_RE.match(q)
    if m:
        ra, dec = float(m.group(1).replace(",", ".")), float(m.group(2).replace(",", "."))
        errors = _validate_cone(ra, dec, 5)
        if errors:
            raise ValidationFailed(errors)
        hits = cone_search(db, ra, dec, 5, limit, vmag_max=8)
        items = _summaries_by_keys(db, [k for _, k in hits])
        for it, (dist, _) in zip(items, hits):
            it["distance_deg"] = round(dist, 3)
        return {"mode": "coordinates", "items": items}
    m = ID_RE.match(q)
    if m:
        cat = (m.group(1) or "HIP").upper()
        n = int(m.group(2))
        col = Star.hip if cat == "HIP" else Star.hd
        rows = db.execute(select(Star).where(Star.version_id == vid, col == n).limit(limit)).scalars().all()
        items = [summary(db, s) for s in rows]
        if not m.group(1):  # число без префікса: також шукаємо HD
            rows = db.execute(select(Star).where(Star.version_id == vid, Star.hd == n).limit(limit)).scalars().all()
            items += [summary(db, s) for s in rows if s.hip != n]
        return {"mode": "identifier", "items": items[:limit]}
    hits = search_names(db, q, limit)
    items = _summaries_by_keys(db, [h for h, _, _ in hits])
    by_key = {h: (m, lg) for h, m, lg in hits}
    langs = catalog_cache.i18n_names().get("languages", {})
    for it in items:
        m, lg = by_key.get(it["hip"], ("", ""))
        # Показуємо, за якою назвою знайдено, якщо вона відрізняється від основної
        if m and m != it["name"]:
            it["matched_name"] = m
            it["matched_lang"] = lg
            it["matched_lang_label"] = {"uk": "українська", "en": "англійська", **langs}.get(lg, lg)
    return {"mode": "name", "items": items}


@router.get("/by-id")
def by_id(catalog: str = Query(..., pattern="^(HIP|HD|hip|hd)$"), id: str = Query(...), db: Session = Depends(get_db)):
    """UC-03 AC1: точний збіг ідентифікатора в обраному каталозі."""
    vid = _require_catalog(db)
    if not id.strip().isdigit():
        raise ValidationFailed([vf(None, "id", "Ідентифікатор має бути цілим додатним числом")])
    col = Star.hip if catalog.upper() == "HIP" else Star.hd
    rows = db.execute(select(Star).where(Star.version_id == vid, col == int(id))).scalars().all()
    return {"items": [summary(db, s) for s in rows]}


@router.get("/cone")
def cone(ra: float, dec: float, radius: float, limit: int = Query(50, ge=1, le=500),
         vmag_max: float | None = None, db: Session = Depends(get_db)):
    """UC-03 AC2: зорі в заданому кутовому радіусі, за зростанням відстані."""
    _require_catalog(db)
    errors = _validate_cone(ra, dec, radius)
    if errors:
        raise ValidationFailed(errors)
    hits = cone_search(db, ra, dec, radius, limit, vmag_max)
    items = _summaries_by_keys(db, [k for _, k in hits])
    for it, (dist, _) in zip(items, hits):
        it["distance_deg"] = round(dist, 3)
    return {"items": items}


@router.get("/fast")
def fast(limit: int = Query(20, ge=1, le=200), pm_min: float = FAST_PM_MAS, db: Session = Depends(get_db)):
    """F10 / UC-16: зорі з великим власним рухом."""
    vid = _require_catalog(db)
    rows = db.execute(
        select(Star).where(Star.version_id == vid, Star.pm_total >= pm_min).order_by(Star.pm_total.desc()).limit(limit)
    ).scalars().all()
    out = []
    for s in rows:
        d = summary(db, s)
        d["pm_total"] = s.pm_total
        out.append(d)
    return {"threshold_mas": pm_min, "items": out}


# ------------------------------------------------------------ UC-05
def _lineage(v: CatalogVersion, s: Star, extended: bool) -> dict:
    base = {
        "source": v.source,
        "source_url": v.source_url,
        "license": v.license,
        "import_date": v.imported_at.isoformat(),
        "source_id": s.source_id,
        "hip": s.hip,
    }
    if extended:
        base |= {
            "origin": v.origin,
            "source_version": v.source_version,
            "batch_id": v.batch_id,
            "checksum_sha256": v.checksum_sha256,
            "profile": v.profile,
            "transformations": s.transformations or [],
            "quality_warnings": s.warnings or [],
        }
    return base


@router.get("/{key}")
def card(key: int, db: Session = Depends(get_db)):
    vid = _require_catalog(db)
    s = _get(db, vid, key)
    if not s:  # EX2
        raise not_found("Запис зорі недоступний у поточній версії каталогу")
    v = db.get(CatalogVersion, vid)
    d = summary(db, s)
    dist_ly = s.dist_pc * LY_PER_PC if s.dist_pc else None
    speed = 4.74 * (s.pm_total / 1000.0) * s.dist_pc if s.pm_total is not None and s.dist_pc else None
    d |= {
        "bd": s.bd,
        "coordinate_system": "ICRS",
        "epoch": "J1991.25 (епоха Hipparcos)" if v.profile == "hipparcos" else "J2000.0",
        "vi": s.vi,
        "parallax_mas": s.plx,
        "parallax_error_mas": s.e_plx,
        "dist_pc": s.dist_pc,
        "dist_ly": dist_ly,
        "pm_ra": s.pm_ra,
        "pm_dec": s.pm_dec,
        "pm_total": s.pm_total,
        "tangential_velocity_kms": speed,
        "fast": s.pm_total is not None and s.pm_total >= FAST_PM_MAS,
        "sp_class": s.sp_class,
        "color_hex": s.color_hex,
        "missing": [k for k, val in (("hd", s.hd), ("bv", s.bv), ("vi", s.vi), ("parallax_mas", s.plx),
                                      ("dist_ly", dist_ly), ("pm_ra", s.pm_ra), ("pm_dec", s.pm_dec),
                                      ("sp_type", s.sp_type)) if val is None],
        "lineage": _lineage(v, s, extended=False),
    }
    return d


@router.get("/{key}/lineage")
def lineage(key: int, db: Session = Depends(get_db)):
    """Розширений перегляд походження даних (табл. 2.29)."""
    vid = _require_catalog(db)
    s = _get(db, vid, key)
    if not s:
        raise not_found("Запис зорі недоступний у поточній версії каталогу")
    return _lineage(db.get(CatalogVersion, vid), s, extended=True)
