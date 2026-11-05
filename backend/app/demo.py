"""Демонстраційні дані для захисту проєкту.

Усе створюється через ті самі сервісні функції, що й у реальній роботі
(завантаження → перевірка якості → згода → подання → модерація → винагорода),
тому в аудиті, звітах і статусах з'являються справжні події.

Знімки сузір'їв генеруються з реальних координат і кольорів зір каталогу:
кожне зображення — це справжнє сузір'я, «сфотографоване» з даних Hipparcos.
У описі кожного знімка зазначено, що він демонстраційний.

Запуск:  python -m app.cli seed-demo
"""
from __future__ import annotations

import io
import json
import math
import os
import random
from datetime import date, timedelta

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from sqlalchemy import select

from . import catalog_cache, consent, photo_service
from .db import SessionLocal
from .models import Complaint, JournalEntry, Photo, Role, Star, StarList, StarListItem, User, utcnow
from .security import Ctx, hash_password

DEMO_TAG = "[Демонстраційний знімок]"

PROFILES = {
    "observer@star.test": ("Олена Коваль", "Львів", "Бінокль 10×50, телескоп Sky-Watcher 130/900",
                           "Спостерігаю з 2019 року, найбільше люблю зимове небо й Оріон."),
    "observer2@star.test": ("Андрій Мельник", "Івано-Франківськ", "Телескоп Celestron NexStar 6SE",
                            "Астрофотографія з Карпат, веду публічний журнал."),
    "moderator@star.test": ("Ірина Савчук", "Львів", "Рефрактор 80/480", "Модераторка галереї."),
    "moderator2@star.test": ("Тарас Бойко", "Київ", "", "Модератор галереї."),
    "admin@star.test": ("Адміністратор даних", "", "", ""),
}

# (власник, сузір'я, назва, опис, кінцевий стан)
PHOTOS = [
    ("observer@star.test", "Ori", "Orion", "Оріон над Високим Замком",
     "Зимовий Оріон: червонувата Бетельгейзе, блакитний Рігель і три зорі Пояса.", "published"),
    ("observer@star.test", "UMa", "Ursa Major", "Великий Ківш у жовтні",
     "Сім зір Ківша низько над північним горизонтом.", "published"),
    ("observer@star.test", "Cas", "Cassiopeia", "Кассіопея в зеніті",
     "Характерна «W» серед зоряних полів Чумацького Шляху.", "published"),
    ("observer@star.test", "Lyr", "Lyra", "Ліра й Вега",
     "Невелике сузір'я з однією з найяскравіших зір неба.", "internal"),
    ("observer2@star.test", "Cyg", "Cygnus", "Північний Хрест із Карпат",
     "Лебідь у літньо-осінньому небі, Денеб угорі.", "published"),
    ("observer2@star.test", "Sco", "Scorpius", "Скорпіон низько над обрієм",
     "З України видно лише верхню частину — Антарес і клешні.", "rejected"),
    ("observer2@star.test", "Leo", "Leo", "Лев навесні",
     "«Серп» і Регул на весняному небі.", "submitted"),
    ("observer@star.test", "Tau", "Taurus", "Альдебаран і Гіади",
     "Помаранчевий Альдебаран серед скупчення Гіади.", "submitted"),
]

JOURNAL = {
    "observer@star.test": [
        (27989, 3, 5, 4, "Бетельгейзе помітно помаранчева, ясна морозна ніч."),
        (24436, 5, 5, 4, "Рігель — блакитно-білий, дуже яскравий."),
        (32349, 10, 5, 3, "Сіріус низько, сильно мерехтить різними кольорами."),
        (91262, 14, 5, 5, "Вега майже в зеніті, ідеальні умови за містом."),
        (11767, 18, 3, 4, "Полярна — орієнтир для налаштування монтування."),
        (21421, 21, 4, 3, "Альдебаран крізь легкий серпанок."),
        (69673, 27, 4, 2, "Арктур на заході, світлове забруднення міста."),
    ],
    "observer2@star.test": [
        (102098, 2, 4, 5, "Денеб над Карпатами, темне небо без засвічення."),
        (97649, 6, 4, 4, "Альтаїр і Тараз поруч добре видно в бінокль."),
        (80763, 12, 3, 2, "Антарес дуже низько, червоний відтінок."),
        (54061, 16, 4, 4, "Дубге — початок Ковша."),
        (49669, 25, 4, 3, "Регул у Леві, легка хмарність."),
    ],
}

LISTS = {
    "observer@star.test": {
        "Улюблені зорі": [32349, 91262, 11767, 27989],
        "Мої цілі на вихідні": [91262, 97649, 102098, 69673, 24608],
        "Червоні гіганти": [27989, 80763, 21421, 69673],
    },
    "observer2@star.test": {
        "Улюблені зорі": [102098, 97649, 80763],
        "Зимове небо": [27989, 24436, 32349, 37279, 24608],
    },
}


# Додаткові публічні спостерігачі для демонстрації пошуку людей у «Спільноті»
# (email, ім'я, [знімки: (abbr, latin, назва, опис)], [журнал: (hip, днів тому, яскравість, умови, нотатка)], публічний журнал)
COMMUNITY = [
    ("marko@star.test", "Марко Шевчук",
     [("Gem", "Gemini", "Близнюки над Стрийським парком", "Кастор і Поллукс поруч, як дві очі."),
      ("Aql", "Aquila", "Орел і Альтаїр", "Літній трикутник, нижня вершина — Альтаїр.")],
     [(37826, 4, 5, 4, "Поллукс яскравіший за Кастора, теплий жовтуватий відтінок."),
      (97649, 9, 4, 4, "Альтаїр високо на півдні.")], True),
    ("zofia@star.test", "Zofia Kowalska",
     [("And", "Andromeda", "Туманність Андромеди з Бещад", "Ледь помітна пляма поруч із Мірахом.")],
     [], False),
    ("nadia@star.test", "Надія Гнатюк",
     [], [(32349, 1, 5, 5, "Сіріус над обрієм, мороз і чисте небо."),
          (37279, 3, 4, 4, "Проціон у Малому Псі, легко знайти від Оріона."),
          (113368, 8, 3, 3, "Фомальгаут дуже низько на півдні.")], True),
]


def seed_community(db, mod: User) -> int:
    """Ідемпотентно: створює обліковий запис, лише якщо його ще немає."""
    password = hash_password(os.environ.get("DEMO_PASSWORD", "Star-demo-2026"))
    vid = catalog_cache.active_version_id(db)
    known = {h for (h,) in db.execute(select(Star.hip).where(Star.version_id == vid, Star.hip.is_not(None)))}
    today = date.today()
    created = 0
    for n, (email, name, photos, entries, public) in enumerate(COMMUNITY):
        if db.execute(select(User.id).where(User.email == email)).first():
            continue
        u = User(email=email, password_hash=password, role=Role.OBSERVER, display_name=name)
        db.add(u)
        db.flush()
        db.add(StarList(user_id=u.id, name="Улюблені зорі", is_favorites=True))
        for i, (hip, days_ago, bright, cond, note) in enumerate(entries):
            if hip in known:
                db.add(JournalEntry(id=f"demo-{u.id[:8]}-{i}", user_id=u.id, star_hip=hip,
                                    observed_at=today - timedelta(days=days_ago), brightness_rating=bright,
                                    conditions_rating=cond, note=note, observer_latitude=49.8, observer_longitude=24.0))
        db.commit()
        ctx = _ctx(u)
        if public:
            consent.grant(db, ctx, "C-04", consent.CURRENT_VERSION, "web")
        for i, (abbr, latin, title, desc) in enumerate(photos):
            meta = {
                "title": title, "constellation": latin, "date_taken": (today - timedelta(days=2 + i * 5 + n)).isoformat(),
                "author": name, "anonymous": False, "license": ["CC-BY-4.0", "CC-BY-SA-4.0"][i % 2],
                "description": f"{desc} {DEMO_TAG} Згенеровано з координат і кольорів зір каталогу Hipparcos.",
                "rights_confirmed": True, "keep_gps": False,
            }
            p = photo_service.upload(db, ctx, render_constellation(db, abbr, seed=40 + n * 3 + i), f"{abbr.lower()}-demo.jpg",
                                     json.dumps(meta, ensure_ascii=False), "Europe/Kyiv")
            consent.grant(db, ctx, "C-02", consent.CURRENT_VERSION, "web", p.id)
            p = photo_service.submit(db, ctx, p, None)
            photo_service.moderate(db, _ctx(mod), p.id, "approve", p.version, "")
        created += 1
    return created


# ------------------------------------------------------------------ зображення
def _radec_to_xyz(ra, dec):
    ra, dec = np.radians(ra), np.radians(dec)
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], axis=-1)


def render_constellation(db, abbr: str, w: int = 1600, h: int = 1067, seed: int = 1, gps: bool = False) -> bytes:
    """«Астрофото» сузір'я: гномонічна проєкція справжніх зір каталогу з кольором за B–V."""
    rng = random.Random(seed)
    cons = catalog_cache.constellations(db).get(abbr)
    vid = catalog_cache.active_version_id(db)
    hips = sorted({h for pair in cons.lines for h in pair}) if cons else []
    line_stars = db.execute(select(Star.ra, Star.dec).where(Star.version_id == vid, Star.hip.in_(hips))).all()
    v = _radec_to_xyz(np.array([r for r, _ in line_stars]), np.array([d for _, d in line_stars])).mean(axis=0)
    v /= np.linalg.norm(v)
    ra0 = math.degrees(math.atan2(v[1], v[0])) % 360
    dec0 = math.degrees(math.asin(v[2]))
    pts = _radec_to_xyz(np.array([r for r, _ in line_stars]), np.array([d for _, d in line_stars]))
    radius = math.degrees(math.acos(np.clip(pts @ v, -1, 1).min())) * 1.12 + 2

    rows = db.execute(select(Star.ra, Star.dec, Star.vmag, Star.color_hex)
                      .where(Star.version_id == vid, Star.vmag <= 8.0)).all()
    ra = np.array([r.ra for r in rows])
    dec = np.array([r.dec for r in rows])
    xyz = _radec_to_xyz(ra, dec)
    cosc = xyz @ v
    keep = cosc > math.cos(math.radians(min(85.0, radius * 2.2)))
    a0, d0 = math.radians(ra0), math.radians(dec0)
    ra_r, dec_r = np.radians(ra[keep]), np.radians(dec[keep])
    c = cosc[keep]
    x = np.cos(dec_r) * np.sin(ra_r - a0) / c
    y = (math.cos(d0) * np.sin(dec_r) - math.sin(d0) * np.cos(dec_r) * np.cos(ra_r - a0)) / c
    scale = min(w, h) / 2 / math.tan(math.radians(radius))
    px = w / 2 - x * scale
    py = h / 2 - y * scale
    mags = np.array([r.vmag for r in rows])[keep]
    colors = [r.color_hex for r, k in zip(rows, keep) if k]

    # Тло: глибоке нічне небо з легким градієнтом і «туманністю»
    yy, xx = np.mgrid[0:h, 0:w]
    base = np.zeros((h, w, 3), dtype=np.float32)
    base[..., 0], base[..., 1], base[..., 2] = 9, 8, 22
    for _ in range(3):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        sig = rng.uniform(0.25, 0.45) * w
        g = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sig ** 2)))
        tint = rng.choice([(38, 20, 58), (18, 24, 52), (44, 26, 40)])
        for k in range(3):
            base[..., k] += g * tint[k] * 0.32
    noise = np.random.default_rng(seed).normal(0, 2.2, (h, w, 1))
    base = np.clip(base + noise, 0, 255).astype(np.uint8)
    img = Image.fromarray(base, "RGB")

    glow = Image.new("RGB", (w, h), (0, 0, 0))
    core = Image.new("RGB", (w, h), (0, 0, 0))
    gd, cd = ImageDraw.Draw(glow), ImageDraw.Draw(core)
    for x0, y0, m, col in zip(px, py, mags, colors):
        if not (-20 < x0 < w + 20 and -20 < y0 < h + 20):
            continue
        r = max(0.6, 5.2 - 0.72 * m)
        rgb = tuple(int(col[i:i + 2], 16) for i in (1, 3, 5))
        bright = max(0.25, min(1.0, 1.15 - m * 0.12))
        crgb = tuple(int(255 * bright * 0.55 + c_ * bright * 0.45) for c_ in rgb)
        cd.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=crgb)
        if m < 4.5:
            gr = r * 3.2
            gd.ellipse([x0 - gr, y0 - gr, x0 + gr, y0 + gr], fill=tuple(int(c_ * 0.55) for c_ in rgb))
        if m < 1.6:  # дифракційні промені найяскравіших зір
            L = 18 + (1.6 - m) * 22
            for dx, dy in ((L, 0), (0, L)):
                cd.line([x0 - dx, y0 - dy, x0 + dx, y0 + dy], fill=tuple(int(c_ * 0.8) for c_ in crgb), width=1)
    glow = glow.filter(ImageFilter.GaussianBlur(9))
    core = core.filter(ImageFilter.GaussianBlur(0.8))
    arr = np.asarray(img, dtype=np.float32) + np.asarray(glow, dtype=np.float32) * 0.7 + np.asarray(core, dtype=np.float32)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    buf = io.BytesIO()
    exif = Image.Exif()
    exif[0x010F] = "Star demo"
    exif[0x0110] = "Synthetic render from Hipparcos"
    if gps:  # демонстрація видалення GPS (згода C-03 не надається)
        exif[0x8825] = {1: "N", 2: (49.0, 50.0, 23.0), 3: "E", 4: (24.0, 1.0, 47.0)}
    img.save(buf, "JPEG", quality=90, exif=exif.tobytes())
    return buf.getvalue()


# ------------------------------------------------------------------ наповнення
def _ctx(user: User) -> Ctx:
    return Ctx(user, None, "127.0.0.1")


def seed_demo() -> dict:
    db = SessionLocal()
    report = {"users": 0, "lists": 0, "journal": 0, "photos": {}, "complaints": 0}
    try:
        if not catalog_cache.active_version_id(db) or not catalog_cache.constellations(db):
            raise SystemExit("Спершу імпортуйте каталог і лінії сузір'їв (import-catalog, import-sky)")
        if db.execute(select(Photo.id).where(Photo.description.like(f"%{DEMO_TAG}%"))).first():
            mod = db.execute(select(User).where(User.email == "moderator@star.test")).scalar_one()
            report["community_observers"] = seed_community(db, mod)
            print("Основні демо-дані вже створено; додано спостерігачів спільноти:", report["community_observers"])
            return report

        users = {u.email: u for u in db.execute(select(User).where(User.email.in_(list(PROFILES)))).scalars()}
        missing = set(PROFILES) - set(users)
        if missing:
            raise SystemExit(f"Немає тестових облікових записів: {', '.join(sorted(missing))}. Запустіть бекенд хоча б раз.")
        for email, (name, city, equipment, bio) in PROFILES.items():
            u = users[email]
            u.display_name, u.city, u.equipment, u.bio = name, city, equipment, bio
            report["users"] += 1
        db.commit()

        # Списки (UC-06)
        vid = catalog_cache.active_version_id(db)
        known = {h for (h,) in db.execute(select(Star.hip).where(Star.version_id == vid, Star.hip.is_not(None)))}
        for email, lists in LISTS.items():
            u = users[email]
            for name, hips in lists.items():
                lst = db.execute(select(StarList).where(StarList.user_id == u.id, StarList.name == name)).scalar_one_or_none()
                if not lst:
                    lst = StarList(user_id=u.id, name=name, is_favorites=name == "Улюблені зорі")
                    db.add(lst)
                    db.flush()
                have = {i.hip for i in lst.items}
                for h in hips:
                    if h in known and h not in have:
                        lst.items.append(StarListItem(hip=h))
                report["lists"] += 1
        db.commit()

        # Журнал (UC-09)
        today = date.today()
        for email, entries in JOURNAL.items():
            u = users[email]
            for i, (hip, days_ago, bright, cond, note) in enumerate(entries):
                oid = f"demo-{u.id[:8]}-{i}"
                if hip in known and not db.get(JournalEntry, oid):
                    db.add(JournalEntry(
                        id=oid, user_id=u.id, star_hip=hip, observed_at=today - timedelta(days=days_ago),
                        brightness_rating=bright, conditions_rating=cond, note=note,
                        observer_latitude=49.84 if email.startswith("observer@") else 48.92,
                        observer_longitude=24.03 if email.startswith("observer@") else 24.71,
                    ))
                    report["journal"] += 1
        db.commit()
        # Публічний журнал за згодою C-04
        consent.grant(db, _ctx(users["observer2@star.test"]), "C-04", consent.CURRENT_VERSION, "web")

        # Знімки (UC-10 → UC-22 → UC-11 → UC-24 → UC-12)
        mod_a, mod_b = users["moderator@star.test"], users["moderator2@star.test"]
        created: list[Photo] = []
        for i, (email, abbr, latin, title, desc, final) in enumerate(PHOTOS):
            owner = users[email]
            ctx = _ctx(owner)
            data = render_constellation(db, abbr, seed=i + 7, gps=(abbr == "Ori"))
            meta = {
                "title": title, "constellation": latin,
                "date_taken": (today - timedelta(days=3 + i * 4)).isoformat(),
                "author": owner.display_name, "anonymous": abbr == "Cyg",
                "license": ["CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0"][i % 3],
                "description": f"{desc} {DEMO_TAG} Згенеровано з координат і кольорів зір каталогу Hipparcos.",
                "rights_confirmed": True, "keep_gps": False,
            }
            p = photo_service.upload(db, ctx, data, f"{abbr.lower()}-demo.jpg", json.dumps(meta, ensure_ascii=False), "Europe/Kyiv")
            if final != "internal":
                consent.grant(db, ctx, "C-02", consent.CURRENT_VERSION, "web", p.id)
                p = photo_service.submit(db, ctx, p, None)
            if final in ("published", "rejected"):
                mod = mod_b if owner.role == Role.MODERATOR else mod_a
                photo_service.moderate(
                    db, _ctx(mod), p.id, "approve" if final == "published" else "reject", p.version,
                    "" if final == "published" else "Знімок нечіткий: зорі розмиті, сузір'я важко впізнати. Спробуйте коротшу витримку.",
                )
            created.append(p)
            report["photos"][final] = report["photos"].get(final, 0) + 1

        # Скарга на опублікований знімок (RR-02) — для демонстрації модерації скарг
        target = next((p for p in created if db.get(Photo, p.id).is_public and p.owner_id == users["observer@star.test"].id), None)
        if target:
            db.add(Complaint(photo_id=target.id, reporter_id=users["observer2@star.test"].id, reason="wrong_info",
                             comment="Здається, сузір'я вказано правильно, але дата зйомки викликає сумнів.",
                             created_at=utcnow()))
            db.commit()
            report["complaints"] = 1
        report["community_observers"] = seed_community(db, mod_a)
        return report
    finally:
        db.close()
