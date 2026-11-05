"""Схема бази даних. Набори даних позначено кодами реєстру DG-1 (DS-01…DS-10)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class Role:
    OBSERVER = "OBSERVER"
    MODERATOR = "MODERATOR"
    DG_ADMIN = "DG_ADMIN"
    ALL = (OBSERVER, MODERATOR, DG_ADMIN)


# ---------------------------------------------------------------- DS-01 каталог
class CatalogVersion(Base):
    """Партія імпорту / версія каталогу (lineage, табл. 2.29; звіт табл. 2.32)."""

    __tablename__ = "catalog_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(String(40), unique=True)
    profile: Mapped[str] = mapped_column(String(20))  # hipparcos | hyg
    source: Mapped[str] = mapped_column(String(200))
    source_url: Mapped[str] = mapped_column(String(500))  # сторінка завантаження
    origin: Mapped[str] = mapped_column(String(500), default="")  # першоджерело
    source_version: Mapped[str] = mapped_column(String(100))
    license: Mapped[str] = mapped_column(String(100))
    file_name: Mapped[str] = mapped_column(String(255))
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    imported_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # pending → active → previous → (видаляється); pending → cancelled; failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    report: Mapped[dict] = mapped_column(JSON, default=dict)


class Star(Base):
    __tablename__ = "stars"
    __table_args__ = (
        UniqueConstraint("version_id", "hip", name="uq_star_version_hip"),
        Index("ix_star_version_vmag", "version_id", "vmag"),
        Index("ix_star_version_hd", "version_id", "hd"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("catalog_versions.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(String(40))  # ідентифікатор у джерелі
    hip: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    ra: Mapped[float] = mapped_column(Float)  # градуси, ICRS
    dec: Mapped[float] = mapped_column(Float)
    vmag: Mapped[float] = mapped_column(Float)
    bv: Mapped[float | None] = mapped_column(Float, nullable=True)
    vi: Mapped[float | None] = mapped_column(Float, nullable=True)
    plx: Mapped[float | None] = mapped_column(Float, nullable=True)  # мс дуги
    e_plx: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm_ra: Mapped[float | None] = mapped_column(Float, nullable=True)  # μα* мс/рік
    pm_dec: Mapped[float | None] = mapped_column(Float, nullable=True)
    sp_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # Обчислювані поля (AD-05)
    sp_class: Mapped[str | None] = mapped_column(String(1), nullable=True)
    dist_pc: Mapped[float | None] = mapped_column(Float, nullable=True)
    pm_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    color_hex: Mapped[str] = mapped_column(String(7), default="#ffffff")
    con: Mapped[str | None] = mapped_column(String(3), nullable=True, index=True)
    is_map_visible: Mapped[bool] = mapped_column(Boolean, default=True)  # QR-07
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    transformations: Mapped[list] = mapped_column(JSON, default=list)


# --------------------------------------------------------- DS-02 сузір'я та назви
class ConstellationVersion(Base):
    __tablename__ = "constellation_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    batch_id: Mapped[str] = mapped_column(String(40), unique=True)
    source: Mapped[str] = mapped_column(String(200))
    source_url: Mapped[str] = mapped_column(String(500))
    source_version: Mapped[str] = mapped_column(String(100))
    license: Mapped[str] = mapped_column(String(200))
    file_name: Mapped[str] = mapped_column(String(255))
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    imported_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    report: Mapped[dict] = mapped_column(JSON, default=dict)
    edges: Mapped[list] = mapped_column(JSON, default=list)  # межі IAU (B1875)


class Constellation(Base):
    __tablename__ = "constellations"
    __table_args__ = (UniqueConstraint("version_id", "abbr"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("constellation_versions.id", ondelete="CASCADE"), index=True
    )
    abbr: Mapped[str] = mapped_column(String(3))
    latin: Mapped[str] = mapped_column(String(60))
    english: Mapped[str] = mapped_column(String(80))
    name_uk: Mapped[str] = mapped_column(String(80))
    lines: Mapped[list] = mapped_column(JSON, default=list)  # пари HIP


class StarName(Base):
    __tablename__ = "star_names"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("constellation_versions.id", ondelete="CASCADE"), index=True
    )
    hip: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String(120))
    lang: Mapped[str] = mapped_column(String(5))  # uk | en
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    normalized: Mapped[str] = mapped_column(String(120), index=True)


# ------------------------------------------------------------ DS-03 / DS-04
class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20), default=Role.OBSERVER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    inactivity_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Мінімальний профіль (DG-8: мінімізація полів)
    display_name: Mapped[str] = mapped_column(String(50), default="")
    city: Mapped[str] = mapped_column(String(80), default="")
    equipment: Mapped[str] = mapped_column(String(120), default="")
    bio: Mapped[str] = mapped_column(String(300), default="")
    avatar_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    password_reset_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    password_reset_expires: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    jti: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ----------------------------------------------------------- DS-06 списки
class StarList(Base):
    __tablename__ = "star_lists"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    is_favorites: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    items: Mapped[list["StarListItem"]] = relationship(
        cascade="all, delete-orphan", order_by="StarListItem.added_at"
    )


class StarListItem(Base):
    __tablename__ = "star_list_items"
    __table_args__ = (UniqueConstraint("list_id", "hip"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    list_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("star_lists.id", ondelete="CASCADE"), index=True
    )
    hip: Mapped[int] = mapped_column(Integer)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ----------------------------------------------------------- DS-07 журнал
class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)  # observation_id
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    star_hip: Mapped[int] = mapped_column(Integer)
    observed_at: Mapped[date] = mapped_column(Date)
    brightness_rating: Mapped[int] = mapped_column(Integer)
    conditions_rating: Mapped[int] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(Text, default="")
    observer_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    observer_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)  # QR-27
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    anonymized: Mapped[bool] = mapped_column(Boolean, default=False)


# ----------------------------------------------------------- DS-08 знімки
class PhotoStatus:
    INTERNAL = "internal"  # завантажено, приватний
    SUBMITTED = "submitted"  # подано на публікацію, у черзі модерації
    APPROVED = "approved"
    REJECTED = "rejected"


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(200))
    constellation: Mapped[str] = mapped_column(String(40))
    date_taken: Mapped[date] = mapped_column(Date)
    author: Mapped[str] = mapped_column(String(200))
    anonymous: Mapped[bool] = mapped_column(Boolean, default=False)
    license: Mapped[str] = mapped_column(String(20))
    description: Mapped[str] = mapped_column(Text, default="")
    file_name: Mapped[str] = mapped_column(String(255))
    file_format: Mapped[str] = mapped_column(String(20))
    file_size_bytes: Mapped[int] = mapped_column(Integer)
    width_px: Mapped[int] = mapped_column(Integer)
    height_px: Mapped[int] = mapped_column(Integer)
    file_key: Mapped[str] = mapped_column(String(200))
    thumb_key: Mapped[str] = mapped_column(String(200))
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    gps_stored: Mapped[bool] = mapped_column(Boolean, default=False)
    gps_removed: Mapped[bool] = mapped_column(Boolean, default=False)
    rights_confirmed: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default=PhotoStatus.INTERNAL)
    submitted_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    approved_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    hidden_reason: Mapped[str | None] = mapped_column(String(60), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    anonymized: Mapped[bool] = mapped_column(Boolean, default=False)


class ModerationDecision(Base):
    __tablename__ = "moderation_decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    photo_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("photos.id", ondelete="CASCADE"), index=True
    )
    photo_version: Mapped[int] = mapped_column(Integer)
    moderator_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    decision: Mapped[str] = mapped_column(String(10))  # approve | reject
    reason: Mapped[str] = mapped_column(String(500), default="")
    previous_status: Mapped[str] = mapped_column(String(20))
    new_status: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Complaint(Base):
    """Скарги на опубліковані знімки (RR-02)."""

    __tablename__ = "complaints"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    photo_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("photos.id", ondelete="CASCADE"), index=True
    )
    reporter_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reason: Mapped[str] = mapped_column(String(40))
    comment: Mapped[str] = mapped_column(String(1000), default="")
    status: Mapped[str] = mapped_column(String(20), default="open")  # open|upheld|dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ----------------------------------------------------------- DS-09 винагороди
class Reward(Base):
    __tablename__ = "rewards"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    photo_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    photo_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Ключ ідемпотентності: одне схвалення — одна обробка (UC-12 AC2)
    decision_id: Mapped[str] = mapped_column(String(36), unique=True)
    points: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))  # credited | limit_reached
    reason: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ----------------------------------------------------------- згоди (DG-3)
class ConsentText(Base):
    __tablename__ = "consent_texts"
    __table_args__ = (UniqueConstraint("code", "version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(5))
    version: Mapped[str] = mapped_column(String(10))
    title: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    purpose: Mapped[str] = mapped_column(String(300))
    accept_label: Mapped[str] = mapped_column(String(80))
    decline_label: Mapped[str] = mapped_column(String(80))
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)


class Consent(Base):
    """Структура запису згоди (табл. 2.24)."""

    __tablename__ = "consents"

    consent_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    consent_code: Mapped[str] = mapped_column(String(5))
    consent_version: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10))  # granted | revoked
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    channel: Mapped[str] = mapped_column(String(20), default="web")
    purpose: Mapped[str] = mapped_column(String(300))
    related_object_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ----------------------------------------------------------- DS-10 аудит
class AuditRecord(Base):
    """Структура запису журналу аудиту (табл. 2.28). Лише додавання."""

    __tablename__ = "audit_log"

    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    audit_id: Mapped[str] = mapped_column(String(36), unique=True, default=new_id)
    timestamp_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    actor_role: Mapped[str] = mapped_column(String(20))
    event_code: Mapped[str] = mapped_column(String(10), index=True)
    object_type: Mapped[str] = mapped_column(String(40))
    object_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    result: Mapped[str] = mapped_column(String(10), index=True)  # SUCCESS|DENIED|ERROR
    failure_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    masked_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)  # лише службові відомості
    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    record_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_anonymized: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditArchive(Base):
    """Архів записів аудиту, строк яких минув (DG-7: архівування з обмеженим доступом)."""

    __tablename__ = "audit_archive"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    period_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_to: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    records_count: Mapped[int] = mapped_column(Integer)
    last_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[list] = mapped_column(JSON, default=list)


# ------------------------------------------------------------ сховище файлів у БД
class StoredFile(Base):
    """Файли знімків у PostgreSQL (STORAGE_BACKEND=db): для хостингів без постійного диска."""
    __tablename__ = "stored_files"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(60))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
