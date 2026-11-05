"""Політики зберігання та видалення (DG-7): видалення облікового запису (табл. 2.34)
та ручний запуск очищення адміністратором даних у прототипі."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from . import audit, photo_service, storage
from .config import settings
from .models import (
    AuditArchive, AuditRecord, AuthSession, CatalogVersion, Consent, ConstellationVersion, JournalEntry,
    Photo, PhotoStatus, Reward, Star, StarList, User, utcnow,
)

ANON = photo_service.ANON


def _aware(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def delete_account(db: Session, actor: audit.Actor, user: User, mode: str) -> list[dict]:
    """mode: delete — повне видалення; anonymize — знеособлення матеріалів, де це дозволено."""
    uid = user.id
    steps = []

    def step(n, action, data, result):
        steps.append({"step": n, "action": action, "data": data, "result": result})

    audit.log(actor, "AUD-15", "UserAccount", uid, audit.SUCCESS, None, {"step": 1, "mode": mode})
    step(1, "Отримання та підтвердження запиту на видалення", "DS-3", "Запит зареєстровано")

    n = db.execute(
        update(AuthSession).where(AuthSession.user_id == uid, AuthSession.revoked_at.is_(None)).values(revoked_at=utcnow())
    ).rowcount
    db.commit()
    step(2, "Завершення активних сесій і відкликання токенів", "DS-4", f"Відкликано сесій: {n}")

    lists = list(db.execute(select(StarList).where(StarList.user_id == uid)).scalars())
    if mode == "anonymize":
        for lst in lists:
            lst.user_id = None
            lst.name = "Анонімний список"
    else:
        for lst in lists:
            db.delete(lst)
    db.commit()
    step(4, "Видалення або анонімізація власних списків", "DS-6",
         f"{'Знеособлено' if mode == 'anonymize' else 'Видалено'} списків: {len(lists)}")

    entries = list(db.execute(select(JournalEntry).where(JournalEntry.user_id == uid)).scalars())
    for e in entries:
        if mode == "anonymize":
            # Нотатки та координати можуть ідентифікувати особу — вилучаються
            e.user_id, e.note, e.observer_latitude, e.observer_longitude, e.anonymized = None, "", None, None, True
        else:
            db.delete(e)
    db.commit()
    step(5, "Видалення або анонімізація журналу спостережень", "DS-7",
         f"{'Знеособлено' if mode == 'anonymize' else 'Видалено'} записів: {len(entries)}")

    photos = list(db.execute(select(Photo).where(Photo.owner_id == uid)).scalars())
    kept = 0
    for p in photos:
        if mode == "anonymize" and p.status == PhotoStatus.APPROVED and p.is_public:
            # Опублікований за відкритою ліцензією знімок залишається, але без зв'язку з автором
            if p.gps_stored:
                photo_service.on_gps_consent_revoked(db, actor, p.id)
            p.owner_id, p.author, p.anonymous, p.anonymized = None, ANON, True, True
            kept += 1
        else:
            photo_service.delete_photo(db, actor, p, "account_deletion")
    db.commit()
    step(6, "Припинення публікації знімків, видалення або анонімізація", "DS-8",
         f"Видалено: {len(photos) - kept}, знеособлено: {kept}")

    rewards = list(db.execute(select(Reward).where(Reward.user_id == uid)).scalars())
    for r in rewards:
        if mode == "anonymize":
            r.user_id = None
        else:
            db.delete(r)
    db.commit()
    step(7, "Видалення або анонімізація досягнень", "DS-9", f"Записів: {len(rewards)}")

    if user.avatar_key:
        storage.store().delete(user.avatar_key)
    db.execute(delete(Consent).where(Consent.user_id == uid))
    db.delete(user)
    db.commit()
    step(3, "Видалення персональних даних і облікових реквізитів", "DS-3, DS-4", "Обліковий запис видалено")

    anon_n = anonymize_audit_for(db, uid)
    step(8, "Анонімізація ідентифікатора користувача в аудиті", "DS-10", f"Знеособлено записів: {anon_n}")

    audit.log(audit.Actor(None, actor.role if actor.id != uid else "OBSERVER", actor.ip), "AUD-16",
              "UserAccount", None, audit.SUCCESS, None, {"audit_records": anon_n})
    audit.log(audit.Actor(None, "SYSTEM"), "AUD-15", "UserAccount", None, audit.SUCCESS, None,
              {"step": 9, "mode": mode, "completed": True})
    step(9, "Фіксація факту виконання процедури", "DS-10", "Факт видалення збережено в аудиті")
    steps.sort(key=lambda s: s["step"])
    return steps


def anonymize_audit_for(db: Session, uid: str) -> int:
    n1 = db.execute(
        update(AuditRecord).where(AuditRecord.actor_id == uid).values(actor_id=None, actor_anonymized=True)
    ).rowcount
    n2 = db.execute(update(AuditRecord).where(AuditRecord.object_id == uid).values(object_id=None)).rowcount
    db.commit()
    return n1 + n2


OPERATIONS = {
    "geolocation": "Очищення геолокації",
    "pending_photos": "Видалення знімків на модерації (> 30 днів)",
    "rejected_photos": "Видалення відхилених знімків (> 30 днів)",
    "inactive_accounts": "Неактивні облікові записи (2 роки + 30 днів після повідомлення)",
    "audit": "Очищення журналу аудиту (> 1 року, архівування)",
    "catalog": "Версії каталогу (поточна та попередня)",
}


def run(db: Session, actor: audit.Actor, as_of: datetime, operations: list[str], dry_run: bool) -> dict:
    as_of = _aware(as_of)
    out: dict[str, dict] = {}
    sys_actor = audit.Actor(id=actor.id, role=actor.role, ip=actor.ip)

    if "geolocation" in operations:
        out["geolocation"] = {"affected": 0, "note": "Координати пристрою не зберігаються на сервері після "
                                                    "завершення розрахунку (DS-5) — очищувати нічого"}

    if "pending_photos" in operations:
        lim = as_of - timedelta(days=settings.pending_photo_days)
        rows = [p for p in db.execute(select(Photo).where(Photo.status == PhotoStatus.SUBMITTED)).scalars()
                if p.submitted_at and _aware(p.submitted_at) < lim]
        if not dry_run:
            for p in rows:
                photo_service.delete_photo(db, sys_actor, p, "retention: на модерації понад 30 днів")
        out["pending_photos"] = {"affected": len(rows)}

    if "rejected_photos" in operations:
        lim = as_of - timedelta(days=settings.rejected_photo_days)
        rows = [p for p in db.execute(select(Photo).where(Photo.status == PhotoStatus.REJECTED)).scalars()
                if p.decided_at and _aware(p.decided_at) < lim]
        if not dry_run:
            for p in rows:
                photo_service.delete_photo(db, sys_actor, p, "retention: відхилено понад 30 днів тому")
        out["rejected_photos"] = {"affected": len(rows)}

    if "inactive_accounts" in operations:
        lim = as_of - timedelta(days=settings.inactive_account_days)
        notify, remove = [], []
        for u in db.execute(select(User)).scalars():
            if _aware(u.last_active_at) >= lim:
                continue
            if u.inactivity_notified_at is None:
                notify.append(u)
            elif _aware(u.inactivity_notified_at) < as_of - timedelta(days=settings.inactive_notice_days):
                remove.append(u)
        if not dry_run:
            for u in notify:
                u.inactivity_notified_at = as_of
                db.commit()
                # Демонстрація повідомлення: у прототипі лист не надсилається, факт фіксується в аудиті
                audit.log(sys_actor, "AUD-25", "UserAccount", u.id, audit.SUCCESS, None,
                          {"action": "inactivity_notice"})
            for u in remove:
                delete_account(db, sys_actor, u, "delete")
        out["inactive_accounts"] = {"affected": len(notify) + len(remove), "notified": len(notify),
                                    "deleted": len(remove)}

    if "audit" in operations:
        lim = as_of - timedelta(days=settings.audit_retention_days)
        old = list(db.execute(select(AuditRecord).where(AuditRecord.timestamp_utc < lim).order_by(AuditRecord.seq)).scalars())
        if not dry_run and old:
            payload = [{**audit.serialize(r), "actor_id": None} for r in old]  # ідентифікатори анонімізуються
            db.add(AuditArchive(period_from=old[0].timestamp_utc, period_to=old[-1].timestamp_utc,
                                records_count=len(old), last_hash=old[-1].record_hash, payload=payload))
            for r in old:
                db.delete(r)
            db.commit()
        out["audit"] = {"affected": len(old), "action": "архівовано та видалено з робочого журналу"}

    if "catalog" in operations:
        stale = list(db.execute(select(CatalogVersion).where(CatalogVersion.status.in_(["cancelled", "failed"]))).scalars())
        stale_sky = list(db.execute(select(ConstellationVersion).where(ConstellationVersion.status == "cancelled")).scalars())
        if not dry_run:
            for v in stale:
                db.execute(delete(Star).where(Star.version_id == v.id))
                db.delete(v)
            for v in stale_sky:
                db.delete(v)
            db.commit()
        out["catalog"] = {"affected": len(stale) + len(stale_sky),
                          "note": "Зберігаються поточна та попередня версії; скасовані партії та їхні звіти видаляються"}

    audit.log(actor, "AUD-25", "RetentionRun", None, audit.SUCCESS, None,
              {"dry_run": dry_run, "as_of": as_of.isoformat(), "operations": operations,
               "affected": {k: v["affected"] for k, v in out.items()}})
    return {"dry_run": dry_run, "as_of": as_of.isoformat(), "results": out}
