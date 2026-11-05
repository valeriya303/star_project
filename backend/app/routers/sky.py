"""Сузір'я, розділ «Про дані» та астрономічні обчислення (UC-07, UC-08)."""
from __future__ import annotations

from datetime import date as Date
from datetime import datetime, time, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import astro, audit, catalog_cache, consent
from ..db import get_db
from ..errors import ApiError, ValidationFailed, not_found, vf
from ..models import CatalogVersion, ConstellationVersion, Star
from ..security import Ctx, get_ctx
from ..sky import describe

router = APIRouter(tags=["Сузір'я та обчислення"])

_desc_cache: dict = {}


def _cons_payload(db: Session, c, with_desc: bool) -> dict:
    d = {"id": c.abbr, "abbr": c.abbr, "name": c.name_uk, "latin": c.latin, "english": c.english, "lines": c.lines}
    if with_desc:
        key = (catalog_cache.active_version_id(db), catalog_cache.active_sky_version_id(db), c.abbr)
        if key not in _desc_cache:
            vid = key[0]
            decs, ras, bright = [], [], None
            if vid:
                rows = db.execute(
                    select(Star.hip, Star.ra, Star.dec, Star.vmag).where(Star.version_id == vid, Star.con == c.abbr)
                    .order_by(Star.vmag)
                ).all()
                nm = catalog_cache.names(db)
                naked = [r for r in rows if r.vmag <= 6] or rows
                decs = [r.dec for r in naked]
                ras = [r.ra for r in naked]
                if rows:
                    b = rows[0]
                    label = (nm.get(b.hip) or {}).get("name") or f"HIP {b.hip}"
                    bright = (label, b.vmag)
                _desc_cache[key] = (describe(c.abbr, c.name_uk, c.latin, decs, ras, bright), len(rows))
            else:
                _desc_cache[key] = (describe(c.abbr, c.name_uk, c.latin, [], [], None), 0)
        d["description"], d["stars_count"] = _desc_cache[key]
    return d


@router.get("/constellations")
def constellations(db: Session = Depends(get_db)):
    return [_cons_payload(db, c, False) for c in sorted(catalog_cache.constellations(db).values(), key=lambda c: c.name_uk)]


@router.get("/constellations/{abbr}")
def constellation(abbr: str, db: Session = Depends(get_db)):
    c = catalog_cache.constellations(db).get(abbr)
    if not c:
        raise not_found("Сузір'я не знайдено")
    return _cons_payload(db, c, True)


@router.get("/about-data")
def about_data(db: Session = Depends(get_db)):
    """Розділ «Про дані» (DG-4, DG-8): джерела, версії, ліцензії, перетворення."""
    cat = db.execute(select(CatalogVersion).where(CatalogVersion.status.in_(["active", "previous"]))
                     .order_by(CatalogVersion.imported_at.desc())).scalars().all()
    sky = db.execute(select(ConstellationVersion).where(ConstellationVersion.status.in_(["active", "previous"]))
                     .order_by(ConstellationVersion.imported_at.desc())).scalars().all()
    return {
        "catalog": [{
            "status": v.status, "source": v.source, "source_url": v.source_url, "origin": v.origin,
            "source_version": v.source_version, "license": v.license, "file_name": v.file_name,
            "batch_id": v.batch_id, "imported_at": v.imported_at.isoformat(),
            "checksum_sha256": v.checksum_sha256, "profile": v.profile,
            "stats": {k: v.report.get(k) for k in ("total_records", "accepted", "accepted_with_warnings", "rejected")},
            "transformations": v.report.get("transformations", {}),
        } for v in cat],
        "sky_culture": [{
            "status": v.status, "source": v.source, "source_url": v.source_url, "source_version": v.source_version,
            "license": v.license, "batch_id": v.batch_id, "imported_at": v.imported_at.isoformat(),
            "constellations": v.report.get("constellations"), "star_names": v.report.get("star_names"),
        } for v in sky],
        "boundaries": "Межі сузір'їв IAU (Delporte, 1930), епоха B1875 — з набору Stellarium (edges_18).",
        "calculations": "Колір зорі обчислено за B–V (формула Баллестероса); відстань — 1000 / паралакс; "
                        "модуль власного руху — √(μα*² + μδ²).",
    }


# ------------------------------------------------------------ UC-08
class VisibilityRequest(BaseModel):
    hip: int
    date: str  # YYYY-MM-DD
    time: str  # HH:MM
    timezone: str = "Europe/Kyiv"
    fold: int | None = None  # уточнення неоднозначного часу: 0 — раніше, 1 — пізніше
    location_source: str = "lviv"  # lviv | manual | device
    latitude: float | None = None
    longitude: float | None = None
    guest_consent: bool = False  # згода Гостя в межах сеансу (UC-13: без облікового запису)


@router.post("/astro/visibility")
def visibility(body: VisibilityRequest, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)):
    """Висота, азимут, схід, кульмінація й захід. Координати не зберігаються й не потрапляють в аудит."""
    errors = []
    if body.location_source not in ("lviv", "manual", "device"):
        errors.append(vf(None, "location_source", "Невідомий спосіб визначення місця"))
    if body.location_source == "lviv":
        lat, lon = astro.LVIV["lat"], astro.LVIV["lon"]
    else:
        lat, lon = body.latitude, body.longitude
        if lat is None or lon is None:
            errors.append(vf("QR-25", "latitude", "Вкажіть широту й довготу"))
        else:
            if not (-90 <= lat <= 90):
                errors.append(vf("QR-25", "latitude", "Широта від −90° до +90°"))
            if not (-180 <= lon <= 180):
                errors.append(vf("QR-25", "longitude", "Довгота від −180° до +180°"))
    try:
        d = Date.fromisoformat(body.date)
        t = time.fromisoformat(body.time)
    except ValueError:
        errors.append(vf(None, "date", "Некоректна дата або час"))
        d = t = None
    if errors:
        audit.log(ctx.actor, "AUD-23", "Visibility", body.hip, audit.ERROR, "INVALID_PARAMETERS")
        raise ValidationFailed(errors)

    if body.location_source == "device":
        # DG-3: перевірка згоди C-01 перед обробкою координат пристрою
        if ctx.user:
            consent.require(db, ctx, "C-01", "visibility_device_location")
        elif not body.guest_consent:
            audit.log(ctx.actor, "AUD-06", "Visibility", body.hip, audit.DENIED, "CONSENT_MISSING",
                      {"consent_code": "C-01"})
            raise ApiError(403, "Геолокацію не надано. Використайте координати Львова або введіть місце вручну",
                           "CONSENT_REQUIRED", {"consent_code": "C-01"})

    try:
        moment = astro.resolve_local_time(d, t, body.timezone, body.fold)
    except astro.TimeError as e:
        audit.log(ctx.actor, "AUD-23", "Visibility", body.hip, audit.ERROR, e.code)
        raise ApiError(422, e.message, e.code)

    vid = catalog_cache.active_version_id(db)
    s = db.execute(select(Star).where(Star.version_id == vid, Star.hip == body.hip)).scalar_one_or_none() if vid else None
    if not s:
        audit.log(ctx.actor, "AUD-23", "Visibility", body.hip, audit.ERROR, "STAR_NOT_FOUND")
        raise ValidationFailed([vf("QR-21", "hip", "Зорі з таким ідентифікатором немає в каталозі")])

    v = astro.visibility(s.ra, s.dec, s.pm_ra, s.pm_dec, lat, lon, moment)
    tz = astro.tz_or_utc(body.timezone)
    audit.log(ctx.actor, "AUD-23", "Visibility", body.hip, audit.SUCCESS, None,
              {"location_source": body.location_source})
    return {
        "hip": body.hip,
        "moment_local": moment.isoformat(),
        "moment_utc": moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "timezone": body.timezone,
        "location_source": body.location_source,
        "place_label": "Львів (49,8397° пн. ш., 24,0297° сх. д.)" if body.location_source == "lviv"
        else ("Ваше місце (геолокація)" if body.location_source == "device" else "Введене вручну місце"),
        "altitude": round(v.altitude, 2),
        "azimuth": round(v.azimuth, 2),
        "compass": astro.compass(v.azimuth),
        "above_horizon": v.above,
        "case": v.case,
        "rise": astro.local_str(v.rise, tz, moment),
        "transit": astro.local_str(v.transit, tz, moment),
        "set": astro.local_str(v.set, tz, moment),
        "transit_altitude": round(v.transit_altitude, 1),
        "text": astro.describe(v, tz, moment),
        "disclaimer": astro.DISCLAIMER,
        "algorithm": "server-v1: власний рух + прецесія (Meeus), рефракція h0 = −0,5667°",
    }


@router.get("/astro/lviv")
def lviv():
    return astro.LVIV
