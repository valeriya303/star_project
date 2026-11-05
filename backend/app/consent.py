"""Керування згодами (DG-3, UC-13)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .errors import ApiError, ValidationFailed, vf
from .models import Consent, ConsentText, utcnow
from .security import Ctx

CURRENT_VERSION = "1.0"

# Тексти з п. 2.4 DG-3 (без змін) + мета обробки з табл. 2.23
TEXTS: dict[str, dict] = {
    "C-01": {
        "title": "Дозволити використання геолокації",
        "text": (
            "Дозволяю системі використовувати мої поточні географічні координати для визначення "
            "місця спостереження, відображення неба над моїм місцем перебування та оцінювання "
            "видимості зорі. Без цієї згоди я зможу вказати місце вручну або використовувати "
            "Львів за замовчуванням."
        ),
        "purpose": "Визначення місця спостереження для відображення неба та оцінювання видимості зорі",
        "accept": "Надати згоду",
        "decline": "Не дозволяти",
        "scope": "function",
    },
    "C-02": {
        "title": "Дозволити публікацію знімка",
        "text": (
            "Погоджуюся на публікацію вибраного мною знімка в системі з можливістю перегляду "
            "іншими користувачами. Перед публікацією я можу вибрати, чи відображатиметься моє "
            "ім'я, чи знімок буде опубліковано анонімно, а також обрати ліцензію. Я розумію, що "
            "після відкликання згоди знімок буде приховано від інших користувачів системи."
        ),
        "purpose": "Надання іншим користувачам доступу до знімка, завантаженого в систему",
        "accept": "Надати згоду",
        "decline": "Не дозволяти",
        "scope": "object",
    },
    "C-03": {
        "title": "Зберегти GPS-координати зі знімка",
        "text": (
            "Дозволяю зберегти GPS-координати, що містяться в EXIF-метаданих мого знімка. Ці "
            "координати можуть вказувати місце створення фотографії. Якщо я не надам згоду, "
            "система видалить GPS-координати з файлу перед його збереженням."
        ),
        "purpose": "Збереження географічного місця створення знімка для можливого використання в системі",
        "accept": "Дозволити збереження координат",
        "decline": "Видалити координати",
        "scope": "object",
    },
    "C-04": {
        "title": "Зробити журнал спостережень публічним",
        "text": (
            "Погоджуюся на надання іншим користувачам доступу до записів мого журналу "
            "спостережень. Я розумію, що записи можуть містити інформацію про мої спостереження "
            "та пов'язані з ними місця й дати. Без цієї згоди мій журнал залишатиметься "
            "приватним. Я можу відкликати згоду в розділі «Мої згоди»."
        ),
        "purpose": "Надання іншим користувачам доступу до записів журналу спостережень",
        "accept": "Зробити журнал публічним",
        "decline": "Залишити приватним",
        "scope": "function",
    },
}

CODES = tuple(TEXTS)
CHANNELS = ("web", "mobile")


def seed_texts(db: Session) -> None:
    for code, t in TEXTS.items():
        exists = db.execute(
            select(ConsentText).where(ConsentText.code == code, ConsentText.version == CURRENT_VERSION)
        ).scalar_one_or_none()
        if not exists:
            db.add(
                ConsentText(
                    code=code,
                    version=CURRENT_VERSION,
                    title=t["title"],
                    text=t["text"],
                    purpose=t["purpose"],
                    accept_label=t["accept"],
                    decline_label=t["decline"],
                    is_current=True,
                )
            )
    db.commit()


def text_payload(code: str) -> dict:
    t = TEXTS[code]
    return {
        "code": code,
        "version": CURRENT_VERSION,
        "title": t["title"],
        "text": t["text"],
        "purpose": t["purpose"],
        "accept_label": t["accept"],
        "decline_label": t["decline"],
        "scope": t["scope"],
    }


def active(db: Session, user_id: str, code: str, related_object_id: str | None = None) -> Consent | None:
    """Чинна згода: статус granted і актуальна версія тексту."""
    q = select(Consent).where(
        Consent.user_id == user_id,
        Consent.consent_code == code,
        Consent.status == "granted",
        Consent.consent_version == CURRENT_VERSION,
    )
    if TEXTS[code]["scope"] == "object":
        q = q.where(Consent.related_object_id == related_object_id)
    return db.execute(q.order_by(Consent.updated_at.desc())).scalars().first()


def require(db: Session, ctx: Ctx, code: str, action: str, related_object_id: str | None = None) -> Consent:
    """Перевірка згоди перед обробкою; відмова фіксується як AUD-06."""
    c = active(db, ctx.user.id, code, related_object_id) if ctx.user else None
    if c is None:
        audit.log(
            ctx.actor, "AUD-06", "ProtectedOperation", related_object_id, audit.DENIED,
            "CONSENT_MISSING", {"consent_code": code, "action": action},
        )
        raise ApiError(
            403,
            f"Для цієї дії потрібна згода «{TEXTS[code]['title']}»",
            "CONSENT_REQUIRED",
            {"consent_code": code},
        )
    return c


def serialize(c: Consent) -> dict:
    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    return {
        "consent_id": c.consent_id,
        "consent_code": c.consent_code,
        "consent_version": c.consent_version,
        "status": c.status,
        "granted_at": iso(c.granted_at),
        "revoked_at": iso(c.revoked_at),
        "channel": c.channel,
        "purpose": c.purpose,
        "related_object_id": c.related_object_id,
        "updated_at": iso(c.updated_at),
        "is_current_version": c.consent_version == CURRENT_VERSION,
    }


def grant(db: Session, ctx: Ctx, code: str, version: str, channel: str,
          related_object_id: str | None = None) -> Consent:
    errors = []
    if code not in TEXTS:
        errors.append(vf(None, "consent_code", "Невідомий код згоди"))
    if channel not in CHANNELS:
        errors.append(vf(None, "channel", "Невідомий канал отримання згоди"))
    if not errors and version != CURRENT_VERSION:
        errors.append(vf(None, "consent_version", "Текст згоди змінився. Ознайомтеся з актуальною редакцією"))
    if not errors and TEXTS[code]["scope"] == "object" and not related_object_id:
        errors.append(vf(None, "related_object_id", "Для цієї згоди потрібно вказати знімок"))
    if errors:
        audit.log(ctx.actor, "AUD-04", "Consent", related_object_id, audit.ERROR, "INVALID_REQUEST",
                  {"consent_code": code})
        raise ValidationFailed(errors)

    existing = active(db, ctx.user.id, code, related_object_id)
    if existing:
        return existing
    now = utcnow()
    c = Consent(
        user_id=ctx.user.id,
        consent_code=code,
        consent_version=version,
        status="granted",
        granted_at=now,
        revoked_at=None,
        channel=channel,
        purpose=TEXTS[code]["purpose"],
        related_object_id=related_object_id,
        updated_at=now,
    )
    db.add(c)
    db.commit()
    audit.log(ctx.actor, "AUD-04", "Consent", c.consent_id, audit.SUCCESS, None,
              {"consent_code": code, "consent_version": version, "channel": channel,
               "related_object_id": related_object_id})
    return c


def revoke(db: Session, ctx: Ctx, code: str, related_object_id: str | None = None) -> list[Consent]:
    if code not in TEXTS:
        raise ValidationFailed([vf(None, "consent_code", "Невідомий код згоди")])
    q = select(Consent).where(
        Consent.user_id == ctx.user.id, Consent.consent_code == code, Consent.status == "granted"
    )
    if TEXTS[code]["scope"] == "object":
        if not related_object_id:
            raise ValidationFailed([vf(None, "related_object_id", "Для цієї згоди потрібно вказати знімок")])
        q = q.where(Consent.related_object_id == related_object_id)
    rows = list(db.execute(q).scalars())
    now = utcnow()
    for c in rows:
        # Новий стан фіксується в тому самому записі (status, revoked_at); історія
        # попередніх рішень зберігається, бо кожне нове надання — окремий запис.
        c.status = "revoked"
        c.revoked_at = now
        c.updated_at = now
    db.commit()
    for c in rows:
        audit.log(ctx.actor, "AUD-05", "Consent", c.consent_id, audit.SUCCESS, None,
                  {"consent_code": code, "related_object_id": related_object_id})
    # Застосування відкликання до залежних операцій
    from . import photo_service

    if code == "C-02" and related_object_id:
        photo_service.on_publication_consent_revoked(db, ctx.actor, related_object_id)
    if code == "C-03" and related_object_id:
        photo_service.on_gps_consent_revoked(db, ctx.actor, related_object_id)
    return rows
