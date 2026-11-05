"""Службові функції DG Admin: імпорт (UC-14, UC-18), звіти якості, аудит (UC-15),
ролі (AUD-14), очищення даних (DG-7), політики доступу."""
from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, importer, retention
from ..config import settings
from ..db import get_db
from ..errors import ApiError, ValidationFailed, not_found, vf
from ..models import AuditRecord, CatalogVersion, ConstellationVersion, Role, User
from ..security import Ctx, admin_only

router = APIRouter(prefix="/admin", tags=["DG Admin"])


def _version_payload(v: CatalogVersion, with_issues: bool = False) -> dict:
    rep = dict(v.report or {})
    if not with_issues:
        rep.pop("issues", None)
    return {"id": v.id, "batch_id": v.batch_id, "status": v.status, "profile": v.profile, "source": v.source,
            "source_url": v.source_url, "origin": v.origin, "source_version": v.source_version,
            "license": v.license, "file_name": v.file_name, "checksum_sha256": v.checksum_sha256,
            "imported_at": v.imported_at.isoformat(), "activated_at": v.activated_at.isoformat() if v.activated_at else None,
            "report": rep}


# ------------------------------------------------------------ UC-14
@router.post("/catalog/imports", status_code=201)
async def import_catalog(
    file: UploadFile = File(...),
    profile: str = Form(...),
    source: str = Form(""),
    source_url: str = Form(""),
    origin: str = Form(""),
    source_version: str = Form(""),
    license: str = Form(""),
    ctx: Ctx = Depends(admin_only),
    db: Session = Depends(get_db),
):
    tmp = Path(tempfile.mkstemp(suffix=".csv")[1])
    try:
        importer.read_upload_to_temp(file.file, tmp, settings.max_import_bytes)
        v = importer.stage_catalog(db, ctx.actor, tmp, file.filename or "catalog.csv", {
            "profile": profile, "source": source, "source_url": source_url, "origin": origin,
            "source_version": source_version, "license": license,
        })
    finally:
        tmp.unlink(missing_ok=True)  # тимчасовий файл не зберігається (DG-7)
    return _version_payload(v, with_issues=True)


@router.get("/catalog/versions")
def versions(ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.execute(select(CatalogVersion).order_by(CatalogVersion.imported_at.desc())).scalars()
    return [_version_payload(v) for v in rows]


@router.get("/catalog/versions/{vid}")
def version(vid: str, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    v = db.get(CatalogVersion, vid)
    if not v:
        raise not_found("Версію не знайдено")
    return _version_payload(v, with_issues=True)


@router.post("/catalog/versions/{vid}/confirm")
def confirm(vid: str, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    return _version_payload(importer.confirm_catalog(db, ctx.actor, vid))


@router.post("/catalog/versions/{vid}/cancel")
def cancel(vid: str, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    return _version_payload(importer.cancel_catalog(db, ctx.actor, vid))


# ------------------------------------------------------------ UC-18
def _sky_payload(v: ConstellationVersion) -> dict:
    return {"id": v.id, "batch_id": v.batch_id, "status": v.status, "source": v.source, "source_url": v.source_url,
            "source_version": v.source_version, "license": v.license, "file_name": v.file_name,
            "imported_at": v.imported_at.isoformat(), "report": v.report}


@router.post("/constellations/imports", status_code=201)
async def import_sky(
    file: UploadFile = File(...),
    source_version: str = Form(""),
    source_url: str = Form(""),
    license: str = Form(""),
    ctx: Ctx = Depends(admin_only),
    db: Session = Depends(get_db),
):
    data = await file.read(20 * 1024 * 1024)
    v = importer.stage_constellations(db, ctx.actor, data, file.filename or "index.json",
                                      {"source_version": source_version, "source_url": source_url, "license": license})
    return _sky_payload(v)


@router.get("/constellations/versions")
def sky_versions(ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    return [_sky_payload(v) for v in db.execute(select(ConstellationVersion).order_by(ConstellationVersion.imported_at.desc())).scalars()]


@router.post("/constellations/versions/{vid}/confirm")
def sky_confirm(vid: str, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    return _sky_payload(importer.confirm_constellations(db, ctx.actor, vid))


@router.post("/constellations/versions/{vid}/cancel")
def sky_cancel(vid: str, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    return _sky_payload(importer.cancel_constellations(db, ctx.actor, vid))


# ------------------------------------------------------------ UC-15
def _parse_dt(s: str | None, field: str, errors: list) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        errors.append(vf(None, field, "Дата має бути у форматі ISO 8601"))
        return None


@router.get("/audit")
def audit_log(
    date_from: str | None = None,
    date_to: str | None = None,
    actor_id: str | None = None,
    event_code: str | None = None,
    result: str | None = None,
    object_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    ctx: Ctx = Depends(admin_only),
    db: Session = Depends(get_db),
):
    errors: list = []
    dfrom, dto = _parse_dt(date_from, "date_from", errors), _parse_dt(date_to, "date_to", errors)
    if dfrom and dto and dfrom > dto:
        errors.append(vf(None, "date_to", "Кінець періоду раніший за початок"))
    if event_code and event_code not in audit.EVENTS:
        errors.append(vf(None, "event_code", "Невідомий код події"))
    if result and result not in (audit.SUCCESS, audit.DENIED, audit.ERROR):
        errors.append(vf(None, "result", "Допустимі результати: SUCCESS, DENIED, ERROR"))
    if errors:  # EX3
        audit.log(ctx.actor, "AUD-24", "AuditLog", None, audit.ERROR, "INVALID_FILTERS")
        raise ValidationFailed(errors)
    q = select(AuditRecord)
    if dfrom:
        q = q.where(AuditRecord.timestamp_utc >= dfrom)
    if dto:
        q = q.where(AuditRecord.timestamp_utc <= dto)
    if actor_id:
        q = q.where(AuditRecord.actor_id == actor_id)
    if event_code:
        q = q.where(AuditRecord.event_code == event_code)
    if result:
        q = q.where(AuditRecord.result == result)
    if object_id:
        q = q.where(AuditRecord.object_id == object_id)
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = db.execute(q.order_by(AuditRecord.seq.desc()).offset((page - 1) * page_size).limit(page_size)).scalars()
    # Подія перегляду фіксується один раз на запит і не створює рекурсивних записів
    audit.log(ctx.actor, "AUD-24", "AuditLog", None, audit.SUCCESS, None, {"page": page, "filtered": bool(
        date_from or date_to or actor_id or event_code or result or object_id)})
    return {"total": total, "page": page, "page_size": page_size, "items": [audit.serialize(r) for r in rows],
            "events": audit.EVENTS,
            "empty_message": "За заданими фільтрами записів немає" if total == 0 else None}


@router.get("/audit/verify")
def audit_verify(ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    return audit.verify_chain(db)


# ------------------------------------------------------------ ролі (AP-06)
@router.get("/users")
def users(q: str = "", ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    stmt = select(User).order_by(User.created_at)
    if q:
        stmt = stmt.where(User.email.ilike(f"%{q.strip()}%"))
    # AP-04: лише облікові дані, необхідні для керування ролями, без журналів і координат
    return [{"id": u.id, "email": u.email, "role": u.role, "created_at": u.created_at.isoformat(),
             "last_active_at": u.last_active_at.isoformat()} for u in db.execute(stmt.limit(200)).scalars()]


class RoleBody(BaseModel):
    role: str


@router.patch("/users/{uid}/role")
def change_role(uid: str, body: RoleBody, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u:
        raise not_found("Користувача не знайдено")
    if body.role not in Role.ALL:
        audit.log(ctx.actor, "AUD-14", "UserRole", uid, audit.ERROR, "INVALID_ROLE")
        raise ValidationFailed([vf(None, "role", "Невідома роль")])
    if u.id == ctx.user.id:
        audit.log(ctx.actor, "AUD-14", "UserRole", uid, audit.DENIED, "SELF_ROLE_CHANGE")
        raise ApiError(403, "Не можна змінювати власну роль", "SELF_ROLE_CHANGE")
    prev = u.role
    u.role = body.role
    db.commit()
    audit.log(ctx.actor, "AUD-14", "UserRole", uid, audit.SUCCESS, None, {"from": prev, "to": body.role})
    return {"id": u.id, "role": u.role}


# ------------------------------------------------------------ DG-7
class RetentionBody(BaseModel):
    operations: list[str]
    dry_run: bool = True
    as_of: str | None = None


@router.get("/retention/operations")
def retention_ops(ctx: Ctx = Depends(admin_only)):
    return [{"id": k, "title": v} for k, v in retention.OPERATIONS.items()]


@router.post("/retention/run")
def retention_run(body: RetentionBody, ctx: Ctx = Depends(admin_only), db: Session = Depends(get_db)):
    errors: list = []
    bad = [o for o in body.operations if o not in retention.OPERATIONS]
    if bad or not body.operations:
        errors.append(vf(None, "operations", "Оберіть операції з переліку"))
    as_of = _parse_dt(body.as_of, "as_of", errors) or datetime.now(timezone.utc)
    if errors:
        raise ValidationFailed(errors)
    return retention.run(db, ctx.actor, as_of, body.operations, body.dry_run)


# ------------------------------------------------------------ політики (DG-2)
RBAC = [
    ("Перегляд зоряної карти", "DS-1", "✅", "✅", "✅", "✅"),
    ("Пошук зір", "DS-1", "✅", "✅", "✅", "✅"),
    ("Фільтрація зір", "DS-1", "✅", "✅", "✅", "✅"),
    ("Перегляд картки зорі", "DS-1", "✅", "✅", "✅", "✅"),
    ("Керування списками зір", "DS-6", "❌", "🔸", "🔸", "❌"),
    ("Журнал спостережень", "DS-7", "❌", "🔸", "🔸", "❌"),
    ("Режим «Небо над Львовом»", "DS-1, DS-5", "🔸", "✅", "✅", "✅"),
    ("Перевірка видимості зорі", "DS-1, DS-5", "🔸", "✅", "✅", "✅"),
    ("Завантаження знімків", "DS-8", "❌", "🔸", "🔸", "❌"),
    ("Модерація знімків", "DS-8", "❌", "❌", "✅", "❌"),
    ("Перегляд винагород", "DS-9", "❌", "🔸", "🔸", "❌"),
    ("Керування згодами", "DS-3", "❌", "🔸", "🔸", "❌"),
    ("Імпорт астрономічного каталогу", "DS-1", "❌", "❌", "❌", "✅"),
    ("Перегляд звітів про якість даних", "DS-1, DS-10", "❌", "❌", "❌", "✅"),
    ("Перегляд журналу аудиту", "DS-10", "❌", "❌", "❌", "✅"),
    ("Керування ролями користувачів", "DS-3", "❌", "❌", "❌", "✅"),
    ("Керування політиками доступу", "DS-10", "❌", "❌", "❌", "✅"),
]
ABAC = [
    ("AP-01", "Користувач може переглядати, змінювати й видаляти лише власні списки, записи журналу та згоди.", "403 + аудит"),
    ("AP-02", "Модератор не може схвалювати або відхиляти власні знімки.", "403 + аудит"),
    ("AP-03", "Гість використовує режим неба лише з ручним місцем або координатами Львова; геолокація — лише за явним вибором і згодою в межах сеансу.", "Координати Львова"),
    ("AP-04", "DG Admin не має доступу до точних координат і вмісту журналів спостережень.", "Дані приховано"),
    ("AP-05", "Модератор не переглядає журнал аудиту й не змінює політики доступу.", "403 + аудит"),
    ("AP-06", "Зміна ролей дозволена лише DG Admin; підвищення власних привілеїв заборонено.", "403 + аудит"),
    ("AP-07", "Операції зміни даних — лише після автентифікації.", "401 + аудит"),
]


@router.get("/policies")
def policies(ctx: Ctx = Depends(admin_only)):
    return {
        "roles": ["Гість", "Спостерігач", "Модератор", "DG Admin"],
        "rbac": [{"action": a, "data": d, "guest": g, "observer": o, "moderator": m, "admin": ad} for a, d, g, o, m, ad in RBAC],
        "abac": [{"id": i, "rule": r, "on_violation": v} for i, r, v in ABAC],
        "settings": {
            "reward_points_per_photo": settings.reward_points_per_photo,
            "reward_daily_limit": settings.reward_daily_limit,
            "pending_photo_days": settings.pending_photo_days,
            "rejected_photo_days": settings.rejected_photo_days,
            "inactive_account_days": settings.inactive_account_days,
            "audit_retention_days": settings.audit_retention_days,
        },
        "note": "Політики реалізовано на сервері (AD-03) як код; зміна порогів виконується через конфігурацію.",
    }
