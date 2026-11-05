"""Початкове наповнення: тексти згод, тестові облікові записи QA (DG-2 §5), первинний імпорт."""
from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import select

from . import audit, consent, importer
from .config import BASE_DIR, settings
from .db import SessionLocal
from .models import CatalogVersion, ConstellationVersion, Role, StarList, User
from .security import hash_password

CLI = audit.Actor(id="system:cli-import", role="DG_ADMIN")

# Паролі передаються QA захищеним каналом (DG-2); тут — лише для локального тестового середовища
DEMO_USERS = [
    ("observer@star.test", Role.OBSERVER, "QA-02 Спостерігач"),
    ("observer2@star.test", Role.OBSERVER, "QA-02b Спостерігач"),
    ("moderator@star.test", Role.MODERATOR, "QA-03 Модератор"),
    ("moderator2@star.test", Role.MODERATOR, "QA-03b Модератор"),
    ("admin@star.test", Role.DG_ADMIN, "QA-04 DG Admin"),
]


def seed_users(db) -> None:
    password = os.environ.get("DEMO_PASSWORD", "Star-demo-2026")
    for email, role, name in DEMO_USERS:
        if db.execute(select(User).where(User.email == email)).scalar_one_or_none():
            continue
        u = User(email=email, password_hash=hash_password(password), role=role, display_name=name)
        db.add(u)
        db.flush()
        db.add(StarList(user_id=u.id, name="Улюблені зорі", is_favorites=True))
    db.commit()


def import_sky_bundle(db, confirm: bool = True) -> None:
    path = BASE_DIR / "data" / "stellarium" / "index.json"
    v = importer.stage_constellations(db, CLI, path.read_bytes(), "index.json", {
        "source_version": "stellarium-master-2026-11 (modern)",
    })
    if confirm:
        importer.confirm_constellations(db, CLI, v.id)


def import_catalog_file(db, csv_path: Path, profile: str = "hipparcos", confirm: bool = True, **meta) -> CatalogVersion:
    v = importer.stage_catalog(db, CLI, csv_path, csv_path.name, {
        "profile": profile,
        "source": meta.get("source") or "Hipparcos Star Astronomy Catalog (Kaggle)",
        "source_url": meta.get("source_url") or "https://www.kaggle.com/datasets/konivat/hipparcos-star-catalog",
        "origin": meta.get("origin") or "ESA, The Hipparcos and Tycho Catalogues (1997), CDS I/239",
        "source_version": meta.get("source_version") or "kaggle-hipparcos-main-2026-10",
        "license": meta.get("license") or "CC0: Public Domain",
    })
    if confirm:
        importer.confirm_catalog(db, CLI, v.id)
    return v


def bootstrap() -> None:
    db = SessionLocal()
    try:
        consent.seed_texts(db)
        if settings.seed_demo_users:
            seed_users(db)
        has_cat = db.execute(select(CatalogVersion.id).where(CatalogVersion.status == "active")).first()
        if not has_cat and settings.auto_import_csv and Path(settings.auto_import_csv).exists():
            print(f"[bootstrap] Первинний імпорт каталогу: {settings.auto_import_csv}")
            import_catalog_file(db, Path(settings.auto_import_csv))
        has_sky = db.execute(select(ConstellationVersion.id).where(ConstellationVersion.status == "active")).first()
        if not has_sky:
            print("[bootstrap] Імпорт ліній сузір'їв Stellarium (modern)")
            import_sky_bundle(db)
    finally:
        db.close()
