"""Журнал аудиту (DG-6): коди подій, маскування, ланцюжок хешів.

Правила:
* лише додавання — інтерфейсу редагування чи видалення записів немає;
* у записи не потрапляють паролі, токени, email, точні координати та вміст
  приватних нотаток (поле details містить лише службові відомості);
* record_hash = SHA-256(prev_hash + незмінні поля). Ідентифікатори actor_id
  та object_id до хешу не входять, бо DG-7 вимагає анонімізувати їх
  після видалення облікового запису; це не ламає перевірку цілісності.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import threading
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select

from .db import SessionLocal, is_postgres
from .models import AuditRecord, utcnow

# Таблиця 2.27 + розширення (AUD-17…), потрібні для подій, яких вимагають UC-01…UC-15
EVENTS: dict[str, str] = {
    "AUD-01": "Успішний вхід",
    "AUD-02": "Неуспішний вхід",
    "AUD-03": "Відмова в доступі",
    "AUD-04": "Надання згоди",
    "AUD-05": "Відкликання згоди",
    "AUD-06": "Відмова через відсутність згоди",
    "AUD-07": "Початок імпорту каталогу",
    "AUD-08": "Завершення імпорту каталогу",
    "AUD-09": "Відхилення даних через якість",
    "AUD-10": "Завантаження знімка",
    "AUD-11": "Схвалення знімка",
    "AUD-12": "Відхилення знімка",
    "AUD-13": "Нарахування винагороди",
    "AUD-14": "Зміна ролі користувача",
    "AUD-15": "Видалення даних",
    "AUD-16": "Анонімізація даних",
    # розширення
    "AUD-17": "Реєстрація облікового запису",
    "AUD-18": "Вихід / завершення сесії",
    "AUD-19": "Зміна списку зір",
    "AUD-20": "Операція з журналом спостережень",
    "AUD-21": "Подання знімка на публікацію",
    "AUD-22": "Публікація або приховування знімка",
    "AUD-23": "Розрахунок видимості зорі",
    "AUD-24": "Перегляд журналу аудиту",
    "AUD-25": "Запуск процедури очищення даних",
    "AUD-26": "Перегляд власних винагород",
    "AUD-27": "Зміна профілю користувача",
    "AUD-28": "Скарга на знімок",
    "AUD-29": "Скидання пароля",
}

SUCCESS, DENIED, ERROR = "SUCCESS", "DENIED", "ERROR"

_lock = threading.Lock()


@dataclass
class Actor:
    id: str | None
    role: str  # GUEST | OBSERVER | MODERATOR | DG_ADMIN | SYSTEM
    ip: str | None = None


SYSTEM = Actor(id="system:retention", role="SYSTEM")


def mask_ip(ip: str | None) -> str | None:
    """IPv4 → /24 (192.168.1.0), IPv6 → /48."""
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    prefix = 24 if addr.version == 4 else 48
    return str(ipaddress.ip_network(f"{ip}/{prefix}", strict=False).network_address)


_FORBIDDEN_KEYS = {"password", "token", "email", "latitude", "longitude", "lat", "lon", "note", "gps"}


def _clean_details(details: dict | None) -> dict:
    if not details:
        return {}
    out = {}
    for k, v in details.items():
        if any(f in k.lower() for f in _FORBIDDEN_KEYS):
            continue  # мінімізація: персональні значення не логуються
        out[k] = v
    return out


def _ts(dt: datetime) -> str:
    from datetime import timezone

    dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _hash(prev: str | None, r: AuditRecord) -> str:
    payload = json.dumps(
        [
            prev or "",
            r.audit_id,
            _ts(r.timestamp_utc),
            r.actor_role,
            r.event_code,
            r.object_type,
            r.result,
            r.failure_reason or "",
            r.masked_ip or "",
        ],
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def log(
    actor: Actor,
    code: str,
    object_type: str,
    object_id: str | int | None = None,
    result: str = SUCCESS,
    failure_reason: str | None = None,
    details: dict | None = None,
    at: datetime | None = None,
) -> None:
    """Записує подію в окремій транзакції, щоб відмови фіксувалися навіть після rollback."""
    assert code in EVENTS, code
    with _lock:
        db = SessionLocal()
        try:
            if is_postgres():
                db.connection().exec_driver_sql("SELECT pg_advisory_xact_lock(424242)")
            last = db.execute(
                select(AuditRecord.record_hash).order_by(AuditRecord.seq.desc()).limit(1)
            ).scalar_one_or_none()
            rec = AuditRecord(
                timestamp_utc=at or utcnow(),
                actor_id=actor.id,
                actor_role=actor.role,
                event_code=code,
                object_type=object_type,
                object_id=None if object_id is None else str(object_id),
                result=result,
                failure_reason=failure_reason,
                masked_ip=mask_ip(actor.ip),
                details=_clean_details(details),
                prev_hash=last,
            )
            from .models import new_id

            rec.audit_id = new_id()
            rec.record_hash = _hash(last, rec)
            db.add(rec)
            db.commit()
        finally:
            db.close()


def verify_chain(db) -> dict:
    """Перевіряє ланцюжок хешів; повертає перший пошкоджений запис, якщо такий є."""
    prev = None
    first = True
    count = 0
    for r in db.execute(select(AuditRecord).order_by(AuditRecord.seq)).scalars():
        if first:
            prev = r.prev_hash  # початок після архівування
            first = False
        if r.prev_hash != prev or _hash(prev, r) != r.record_hash:
            return {"valid": False, "checked": count, "broken_at": r.audit_id}
        prev = r.record_hash
        count += 1
    return {"valid": True, "checked": count, "broken_at": None}


def serialize(r: AuditRecord) -> dict:
    return {
        "audit_id": r.audit_id,
        "timestamp_utc": _ts(r.timestamp_utc),
        "actor_id": r.actor_id,
        "actor_role": r.actor_role,
        "event_code": r.event_code,
        "event_name": EVENTS.get(r.event_code, r.event_code),
        "object_type": r.object_type,
        "object_id": r.object_id,
        "result": r.result,
        "failure_reason": r.failure_reason,
        "masked_ip": r.masked_ip,
        "details": r.details or {},
        "record_hash": r.record_hash,
    }
