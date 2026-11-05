"""Налаштування сервера. Усі значення можна перевизначити змінними середовища.

Числові пороги, що в документах позначені як «потребують погодження»
(бали за знімок, денний ліміт, межа доби), винесено сюди, щоб власник
бізнес-правил міг змінити їх без зміни коду.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _db_url() -> str:
    """Хостинги (Render, Railway, Heroku) дають адресу postgres://… — переводимо на драйвер psycopg 3."""
    url = _env("DATABASE_URL", f"sqlite:///{BASE_DIR / 'star.db'}")
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@dataclass(frozen=True)
class Settings:
    # БД: PostgreSQL у продакшні (AR-1), SQLite для локального запуску без Docker
    database_url: str = _db_url()
    # Зібраний фронтенд (React): якщо тека є, FastAPI віддає сайт і API з однієї адреси
    static_dir: str = _env("STATIC_DIR", str(BASE_DIR / "static"))

    # JWT + bcrypt (табл. 4.1)
    jwt_secret: str = _env("JWT_SECRET", "dev-secret-change-me-please-0123456789")
    jwt_ttl_hours: int = int(_env("JWT_TTL_HOURS", "168"))
    file_url_secret: str = _env("FILE_URL_SECRET", "dev-file-secret-change-me")

    # Сховище знімків: local | s3 (MinIO)
    storage_backend: str = _env("STORAGE_BACKEND", "local")
    storage_dir: str = _env("STORAGE_DIR", str(BASE_DIR / "storage"))
    s3_endpoint: str = _env("S3_ENDPOINT", "http://minio:9000")
    s3_bucket: str = _env("S3_BUCKET", "star-photos")
    s3_access_key: str = _env("S3_ACCESS_KEY", "minioadmin")
    s3_secret_key: str = _env("S3_SECRET_KEY", "minioadmin")

    cors_origins: list[str] = field(
        default_factory=lambda: _env(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
    )

    # Винагороди (UC-12): значення потребують погодження власником бізнес-правил
    reward_points_per_photo: int = int(_env("REWARD_POINTS_PER_PHOTO", "50"))
    reward_daily_limit: int = int(_env("REWARD_DAILY_LIMIT", "3"))
    reward_day_timezone: str = _env("REWARD_DAY_TZ", "Europe/Kyiv")

    # Ліміти даних (DG-5)
    max_photo_bytes: int = 10 * 1024 * 1024
    max_avatar_bytes: int = 5 * 1024 * 1024
    max_import_bytes: int = int(_env("MAX_IMPORT_BYTES", str(200 * 1024 * 1024)))

    # Строки зберігання (DG-7, табл. 2.33)
    pending_photo_days: int = 30
    rejected_photo_days: int = 30
    inactive_account_days: int = 730
    inactive_notice_days: int = 30
    audit_retention_days: int = 365

    # Затверджені версії джерел (QR-11)
    approved_versions: dict[str, list[str]] = field(
        default_factory=lambda: {
            "hipparcos": ["kaggle-hipparcos-main-2026-10", "ESA-1997"],
            "hyg": ["v4", "v4.1", "v4.2"],
        }
    )

    # Автоматичний первинний імпорт під час першого запуску (зручно для демо)
    auto_import_csv: str = _env("AUTO_IMPORT_CSV", "")
    seed_demo_users: bool = _env("SEED_DEMO_USERS", "1") == "1"


settings = Settings()
