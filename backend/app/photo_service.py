"""Знімки сузір'їв: завантаження (UC-10, UC-21), подання (UC-22, UC-23),
модерація (UC-11), публікація (UC-24), винагороди (UC-12)."""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import audit, consent, storage
from .config import settings
from .errors import ApiError, ValidationFailed, forbidden, not_found, vf
from .models import ModerationDecision, Photo, PhotoStatus, Reward, Role, User, utcnow
from .quality.user_data import inspect_image, strip_gps, thumbnail, validate_image_metadata
from .security import Ctx, deny
from .sky import LATIN_TO_ABBR

ANON = "Анонімний спостерігач"

STATUS_LABELS = {
    PhotoStatus.INTERNAL: "Внутрішній (приватний)",
    PhotoStatus.SUBMITTED: "На модерації",
    PhotoStatus.APPROVED: "Схвалено",
    PhotoStatus.REJECTED: "Відхилено",
}


def _cons_uk(db: Session, latin: str) -> str:
    from . import catalog_cache

    c = catalog_cache.constellations(db).get(LATIN_TO_ABBR.get(latin, ""))
    return c.name_uk if c else latin


def serialize(db: Session, p: Photo, viewer: Ctx | None, scope: str) -> dict:
    """scope: owner | moderator | public."""
    viewer_id = viewer.user.id if viewer and viewer.user else "public"
    if scope == "public":
        urls = {"thumb": f"/api/files/photo/{p.id}/thumb", "full": f"/api/files/photo/{p.id}/full"}
    else:
        urls = {v: storage.sign("photo", p.id, v, viewer_id) for v in ("thumb", "full")}
    base = {
        "id": p.id,
        "title": p.title,
        "constellation": p.constellation,
        "constellation_uk": _cons_uk(db, p.constellation),
        "date_taken": p.date_taken.isoformat(),
        "author": ANON if p.anonymous else p.author,
        "anonymous": p.anonymous,
        "license": p.license,
        "description": p.description,
        "width_px": p.width_px,
        "height_px": p.height_px,
        "published_at": p.published_at.isoformat() if p.published_at else None,
        "thumb_url": urls["thumb"],
        "full_url": urls["full"],
    }
    if scope == "public":
        # Посилання на публічний профіль автора — лише для неанонімних знімків
        base["author_profile_id"] = None if p.anonymous else p.owner_id
        return base
    days_left = None
    if p.status == PhotoStatus.REJECTED and p.decided_at:
        days_left = max(0, settings.rejected_photo_days - (utcnow() - _aware(p.decided_at)).days)
    if p.status == PhotoStatus.SUBMITTED and p.submitted_at:
        days_left = max(0, settings.pending_photo_days - (utcnow() - _aware(p.submitted_at)).days)
    extra = {
        "version": p.version,
        "status": p.status,
        "status_label": STATUS_LABELS[p.status],
        "is_public": p.is_public,
        "hidden_reason": p.hidden_reason,
        "reject_reason": p.reject_reason,
        "file_name": p.file_name,
        "file_format": p.file_format,
        "file_size_bytes": p.file_size_bytes,
        "created_at": p.created_at.isoformat(),
        "submitted_at": p.submitted_at.isoformat() if p.submitted_at else None,
        "decided_at": p.decided_at.isoformat() if p.decided_at else None,
        "retention_days_left": days_left,
        "author_name": p.author,
    }
    if scope == "owner":
        extra["gps_stored"] = p.gps_stored
        extra["gps_removed"] = p.gps_removed
        extra["publication_consent"] = bool(viewer and viewer.user and consent.active(db, viewer.user.id, "C-02", p.id))
    return {**base, **extra}


def _aware(dt):
    from datetime import timezone

    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# -------------------------------------------------------------- UC-10
def upload(db: Session, ctx: Ctx, data: bytes, file_name: str, meta_raw: str, tz_name: str | None) -> Photo:
    try:
        meta = json.loads(meta_raw or "{}")
        if not isinstance(meta, dict):
            raise ValueError
    except ValueError:
        raise ValidationFailed([vf("QR-26", "metadata", "Метадані мають бути JSON-об'єктом")])

    errors = []
    if len(data) > settings.max_photo_bytes:
        errors.append(vf("QR-13", "file", "Розмір файлу не повинен перевищувати 10 МБ"))
    mime, w, h, has_gps = inspect_image(data) if not errors else (None, 0, 0, False)
    if not errors and not mime:
        errors.append(vf("QR-12", "file", "Допускаються лише формати JPEG та PNG (перевірено вміст файлу)"))
    if errors:
        audit.log(ctx.actor, "AUD-10", "Photo", None, audit.DENIED, errors[0]["rule_id"], {"rules": [e["rule_id"] for e in errors]})
        raise ValidationFailed(errors)

    anonymous = bool(meta.get("anonymous"))
    author = ANON if anonymous else str(meta.get("author") or "").strip()
    checked = {
        "title": str(meta.get("title") or "").strip(),
        "constellation": meta.get("constellation"),
        "date_taken": meta.get("date_taken"),
        "author": author,
        "license": meta.get("license"),
        # Параметри файлу визначає сервер; метаданим клієнта не довіряємо
        "file_name": (file_name or "image")[:255],
        "file_format": mime,
        "file_size_bytes": len(data),
        "width_px": w,
        "height_px": h,
        "rights_confirmed": meta.get("rights_confirmed"),
    }
    desc = meta.get("description")
    if desc:
        checked["description"] = str(desc)
    errors = validate_image_metadata(checked, tz_name)
    if errors:
        audit.log(ctx.actor, "AUD-10", "Photo", None, audit.DENIED, errors[0]["rule_id"],
                  {"rules": sorted({e["rule_id"] for e in errors if e["rule_id"]})})
        raise ValidationFailed(errors)

    keep_gps = meta.get("keep_gps") is True and has_gps
    stored = data if keep_gps else strip_gps(data, mime)
    p = Photo(
        owner_id=ctx.user.id,
        title=checked["title"],
        constellation=checked["constellation"],
        date_taken=date.fromisoformat(checked["date_taken"]),
        author=author,
        anonymous=anonymous,
        license=checked["license"],
        description=checked.get("description", ""),
        file_name=checked["file_name"],
        file_format=mime,
        file_size_bytes=len(data),
        width_px=w,
        height_px=h,
        file_key="",
        thumb_key="",
        checksum_sha256=hashlib.sha256(stored).hexdigest(),
        gps_stored=keep_gps,
        gps_removed=has_gps and not keep_gps,
        rights_confirmed=True,
        status=PhotoStatus.INTERNAL,
    )
    db.add(p)
    db.flush()
    ext = "jpg" if mime == "image/jpeg" else "png"
    p.file_key = f"photos/{p.id}/original.{ext}"
    p.thumb_key = f"photos/{p.id}/thumb.jpg"
    st = storage.store()
    st.put(p.file_key, stored, mime)
    st.put(p.thumb_key, thumbnail(stored), "image/jpeg")
    db.commit()
    if keep_gps:
        # Згода C-03 надається у формі завантаження окремим вибором і стосується саме цього знімка
        consent.grant(db, ctx, "C-03", consent.CURRENT_VERSION, "web", p.id)
    audit.log(ctx.actor, "AUD-10", "Photo", p.id, audit.SUCCESS, None,
              {"version": p.version, "file_format": mime, "size": len(data), "gps_removed": p.gps_removed})
    return p


def get_owned(db: Session, ctx: Ctx, photo_id: str) -> Photo:
    p = db.get(Photo, photo_id)
    if not p:
        raise not_found("Знімок не знайдено")
    if p.owner_id != ctx.user.id:
        raise deny(ctx, "Photo", photo_id, "NOT_OWNER")
    return p


def update_metadata(db: Session, ctx: Ctx, p: Photo, meta: dict, tz_name: str | None) -> Photo:
    if p.status not in (PhotoStatus.INTERNAL, PhotoStatus.REJECTED):
        raise ApiError(409, "Редагувати можна лише внутрішній або відхилений знімок", "INVALID_STATE")
    anonymous = bool(meta.get("anonymous", p.anonymous))
    checked = {
        "title": str(meta.get("title", p.title)).strip(),
        "constellation": meta.get("constellation", p.constellation),
        "date_taken": meta.get("date_taken", p.date_taken.isoformat()),
        "author": ANON if anonymous else str(meta.get("author", p.author)).strip(),
        "license": meta.get("license", p.license),
        "file_name": p.file_name, "file_format": p.file_format, "file_size_bytes": p.file_size_bytes,
        "width_px": p.width_px, "height_px": p.height_px, "rights_confirmed": True,
    }
    desc = meta.get("description", p.description)
    if desc:
        checked["description"] = desc
    errors = validate_image_metadata(checked, tz_name)
    if errors:
        raise ValidationFailed(errors)
    p.title, p.constellation, p.author, p.license = checked["title"], checked["constellation"], checked["author"], checked["license"]
    p.date_taken = date.fromisoformat(checked["date_taken"])
    p.description = desc or ""
    p.anonymous = anonymous
    p.version += 1
    p.updated_at = utcnow()
    if p.status == PhotoStatus.REJECTED:
        p.status = PhotoStatus.INTERNAL
        p.reject_reason = None
    db.commit()
    return p


# -------------------------------------------------------------- UC-22 / UC-23
def submit(db: Session, ctx: Ctx, p: Photo, author_choice: dict | None) -> Photo:
    if p.status not in (PhotoStatus.INTERNAL, PhotoStatus.REJECTED):
        raise ApiError(409, "Знімок уже подано або опрацьовано", "INVALID_STATE")
    if author_choice:
        # C-02: вибір авторства та ліцензії перед підтвердженням публікації
        p = update_metadata(db, ctx, p, author_choice, None)
    consent.require(db, ctx, "C-02", "submit_for_publication", p.id)  # UC-23 (EX2)
    if not storage.store().exists(p.file_key):
        raise ApiError(409, "Файл знімка недоступний", "QUALITY_NOT_CONFIRMED")
    p.status = PhotoStatus.SUBMITTED
    p.submitted_version = p.version
    p.submitted_at = utcnow()
    p.reject_reason = None
    db.commit()
    audit.log(ctx.actor, "AUD-21", "Photo", p.id, audit.SUCCESS, None, {"version": p.version})
    return p


def withdraw(db: Session, ctx: Ctx, p: Photo) -> Photo:
    if p.status != PhotoStatus.SUBMITTED:
        raise ApiError(409, "Знімок не перебуває на модерації", "INVALID_STATE")
    p.status = PhotoStatus.INTERNAL
    p.submitted_version = None
    db.commit()
    audit.log(ctx.actor, "AUD-21", "Photo", p.id, audit.SUCCESS, None, {"action": "withdrawn"})
    return p


# -------------------------------------------------------------- UC-24
def _publish(db: Session, actor: audit.Actor, p: Photo) -> bool:
    owner_ctx_ok = p.owner_id and consent.active(db, p.owner_id, "C-02", p.id)
    if not owner_ctx_ok:
        audit.log(actor, "AUD-06", "Photo", p.id, audit.DENIED, "CONSENT_MISSING",
                  {"consent_code": "C-02", "action": "publish"})
        return False
    if p.approved_version != p.version:
        return False
    p.is_public = True
    p.hidden_reason = None
    p.published_at = utcnow()
    db.commit()
    audit.log(actor, "AUD-22", "Photo", p.id, audit.SUCCESS, None, {"action": "published", "version": p.version})
    return True


def republish(db: Session, ctx: Ctx, p: Photo) -> Photo:
    if p.status != PhotoStatus.APPROVED or p.is_public:
        raise ApiError(409, "Повторно опублікувати можна лише схвалений прихований знімок", "INVALID_STATE")
    if p.hidden_reason == "complaint_upheld":
        raise ApiError(409, "Знімок приховано модератором за скаргою", "HIDDEN_BY_MODERATOR")
    consent.require(db, ctx, "C-02", "republish", p.id)
    if not _publish(db, ctx.actor, p):
        raise ApiError(409, "Опублікувати можна лише схвалену версію", "VERSION_MISMATCH")
    return p


def hide(db: Session, actor: audit.Actor, p: Photo, reason: str) -> None:
    if p.is_public:
        p.is_public = False
        p.hidden_reason = reason
        db.commit()
        audit.log(actor, "AUD-22", "Photo", p.id, audit.SUCCESS, None, {"action": "hidden", "reason": reason})


def on_publication_consent_revoked(db: Session, actor: audit.Actor, photo_id: str) -> None:
    p = db.get(Photo, photo_id)
    if not p:
        return
    if p.is_public:
        hide(db, actor, p, "consent_revoked")
    elif p.status == PhotoStatus.SUBMITTED:
        # Без згоди матеріал не може залишатися в черзі публікації
        p.status = PhotoStatus.INTERNAL
        p.submitted_version = None
        db.commit()


def on_gps_consent_revoked(db: Session, actor: audit.Actor, photo_id: str) -> None:
    p = db.get(Photo, photo_id)
    if not p or not p.gps_stored:
        return
    st = storage.store()
    data = st.get(p.file_key)
    cleaned = strip_gps(data, p.file_format)
    st.put(p.file_key, cleaned, p.file_format)
    p.gps_stored = False
    p.gps_removed = True
    p.checksum_sha256 = hashlib.sha256(cleaned).hexdigest()
    db.commit()
    audit.log(actor, "AUD-15", "PhotoGpsMetadata", p.id, audit.SUCCESS, None, {"action": "gps_removed"})


def delete_photo(db: Session, actor: audit.Actor, p: Photo, reason: str = "user_request") -> None:
    st = storage.store()
    for k in (p.file_key, p.thumb_key):
        if k:
            st.delete(k)
    pid = p.id
    db.delete(p)
    db.commit()
    audit.log(actor, "AUD-15", "Photo", pid, audit.SUCCESS, None, {"reason": reason})


# -------------------------------------------------------------- UC-11
def moderate(db: Session, ctx: Ctx, photo_id: str, decision: str, version: int | None, reason: str) -> dict:
    p = db.get(Photo, photo_id)
    code = "AUD-11" if decision == "approve" else "AUD-12"
    if not p:
        raise not_found("Знімок не знайдено")
    if p.owner_id == ctx.user.id:  # AP-02, EX1
        audit.log(ctx.actor, code, "Photo", p.id, audit.DENIED, "SELF_MODERATION")
        raise forbidden("Модератор не може ухвалювати рішення щодо власного знімка", "SELF_MODERATION")
    if p.status != PhotoStatus.SUBMITTED:
        audit.log(ctx.actor, code, "Photo", p.id, audit.DENIED, "NOT_IN_QUEUE")
        raise ApiError(409, "Знімок не перебуває в черзі модерації", "NOT_IN_QUEUE")
    if version is None or version != p.version or p.submitted_version != p.version:  # EX3
        audit.log(ctx.actor, code, "Photo", p.id, audit.DENIED, "VERSION_CHANGED")
        raise ApiError(409, "Версія знімка змінилася. Перевірте актуальну версію", "VERSION_CHANGED")
    if not storage.store().exists(p.file_key):
        audit.log(ctx.actor, code, "Photo", p.id, audit.ERROR, "QUALITY_NOT_CONFIRMED")
        raise ApiError(409, "Якість знімка не підтверджено: файл недоступний", "QUALITY_NOT_CONFIRMED")
    if decision == "reject":
        reason = (reason or "").strip()
        if len(reason) < 3:
            raise ValidationFailed([vf(None, "reason", "Зазначте причину відхилення")])
    else:
        # Крок 3: перевірка згоди автора на подання й публікацію (EX2)
        if not (p.owner_id and consent.active(db, p.owner_id, "C-02", p.id)):
            audit.log(ctx.actor, "AUD-06", "Photo", p.id, audit.DENIED, "CONSENT_MISSING",
                      {"consent_code": "C-02", "action": "approve"})
            raise ApiError(409, "Автор відкликав згоду на публікацію. Публікацію заблоковано", "CONSENT_MISSING")

    prev = p.status
    new = PhotoStatus.APPROVED if decision == "approve" else PhotoStatus.REJECTED
    d = ModerationDecision(photo_id=p.id, photo_version=p.version, moderator_id=ctx.user.id, decision=decision,
                           reason=reason or "", previous_status=prev, new_status=new)
    db.add(d)
    p.status = new
    p.decided_at = utcnow()
    if decision == "approve":
        p.approved_version = p.version
    else:
        p.reject_reason = reason
    db.commit()
    audit.log(ctx.actor, code, "Photo", p.id, audit.SUCCESS, None,
              {"version": p.version, "decision_id": d.id, "previous_status": prev, "new_status": new})
    result = {"decision_id": d.id, "status": new, "published": False, "reward": None}
    if decision == "approve":
        result["published"] = _publish(db, ctx.actor, p)  # UC-24 з повторною перевіркою згоди (UC-23)
        result["reward"] = process_reward(db, d.id)
    return result


# -------------------------------------------------------------- UC-12
def _day_bounds(now: datetime):
    from zoneinfo import ZoneInfo

    tz = ZoneInfo(settings.reward_day_timezone)
    loc = now.astimezone(tz)
    from datetime import timezone

    start = loc.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def process_reward(db: Session, decision_id: str) -> dict:
    actor = audit.Actor(id="system:rewards", role="SYSTEM")
    existing = db.execute(select(Reward).where(Reward.decision_id == decision_id)).scalar_one_or_none()
    if existing:  # AC2: повторна доставка
        audit.log(actor, "AUD-13", "Reward", existing.id, audit.SUCCESS, None, {"duplicate": True})
        return reward_payload(existing)
    d = db.get(ModerationDecision, decision_id)
    p = db.get(Photo, d.photo_id) if d else None
    if not d or d.decision != "approve" or not p or not p.owner_id or d.moderator_id == p.owner_id:  # EX2
        audit.log(actor, "AUD-13", "ModerationDecision", decision_id, audit.DENIED, "INVALID_EVENT")
        raise ApiError(422, "Немає підстави для нарахування: відсутнє коректне схвалення", "INVALID_EVENT")
    moderator = db.get(User, d.moderator_id) if d.moderator_id else None
    if not moderator or moderator.role != Role.MODERATOR:
        audit.log(actor, "AUD-13", "ModerationDecision", decision_id, audit.DENIED, "INVALID_APPROVER")
        raise ApiError(422, "Схвалення виконано без повноважень модератора", "INVALID_APPROVER")
    start, end = _day_bounds(utcnow())
    today = db.execute(
        select(func.count()).select_from(Reward).where(
            Reward.user_id == p.owner_id, Reward.status == "credited",
            Reward.created_at >= start, Reward.created_at < end,
        )
    ).scalar_one()
    if today >= settings.reward_daily_limit:  # EX1
        r = Reward(user_id=p.owner_id, photo_id=p.id, photo_version=d.photo_version, decision_id=d.id, points=0,
                   status="limit_reached", reason=f"Досягнуто денного ліміту ({settings.reward_daily_limit} нарахувань)")
        db.add(r)
        db.commit()
        audit.log(actor, "AUD-13", "Reward", r.id, audit.DENIED, "DAILY_LIMIT")
        return reward_payload(r)
    r = Reward(user_id=p.owner_id, photo_id=p.id, photo_version=d.photo_version, decision_id=d.id,
               points=settings.reward_points_per_photo, status="credited",
               reason=f"Схвалено знімок «{p.title}»")
    db.add(r)
    db.commit()
    audit.log(actor, "AUD-13", "Reward", r.id, audit.SUCCESS, None,
              {"points": r.points, "photo_id": p.id, "decision_id": d.id})
    return reward_payload(r)


def reward_payload(r: Reward) -> dict:
    return {
        "id": r.id, "photo_id": r.photo_id, "photo_version": r.photo_version, "points": r.points,
        "status": r.status, "reason": r.reason, "created_at": r.created_at.isoformat(),
    }


LEVELS = [(0, "Новачок"), (100, "Спостерігач"), (300, "Дослідник"), (700, "Астроном"), (1500, "Майстер неба")]


def level_info(points: int) -> dict:
    name, prev_min, nxt = LEVELS[0][1], 0, None
    for i, (threshold, n) in enumerate(LEVELS):
        if points >= threshold:
            name, prev_min = n, threshold
            nxt = LEVELS[i + 1][0] if i + 1 < len(LEVELS) else None
    return {"points": points, "level_name": name, "prev_min": prev_min, "next": nxt}


def user_points(db: Session, user_id: str) -> int:
    return db.execute(
        select(func.coalesce(func.sum(Reward.points), 0)).where(Reward.user_id == user_id, Reward.status == "credited")
    ).scalar_one()
