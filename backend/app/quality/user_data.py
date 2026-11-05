"""Правила якості даних, що передають користувачі (DG-5, табл. 2.31, QR-12…QR-27)."""
from __future__ import annotations

import io
import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from jsonschema import Draft202012Validator, FormatChecker
from PIL import Image, UnidentifiedImageError

from ..errors import vf

SCHEMA_DIR = Path(__file__).resolve().parents[2] / "docs" / "schemas"

IMAGE_SCHEMA = json.loads((SCHEMA_DIR / "constellation-image-metadata.schema.json").read_text("utf-8"))
JOURNAL_SCHEMA = json.loads((SCHEMA_DIR / "observation-journal-entry.schema.json").read_text("utf-8"))

_image_validator = Draft202012Validator(IMAGE_SCHEMA, format_checker=FormatChecker())
_journal_validator = Draft202012Validator(JOURNAL_SCHEMA, format_checker=FormatChecker())

CONSTELLATIONS_88: list[str] = IMAGE_SCHEMA["properties"]["constellation"]["enum"]
LICENSES: list[str] = IMAGE_SCHEMA["properties"]["license"]["enum"]

_IMAGE_RULES = {
    "constellation": "QR-15",
    "license": "QR-18",
    "rights_confirmed": "QR-19",
    "file_format": "QR-12",
    "file_size_bytes": "QR-13",
    "width_px": "QR-14",
    "height_px": "QR-14",
    "title": "QR-17",
    "author": "QR-17",
    "date_taken": "QR-26",
}
_JOURNAL_RULES = {
    "brightness_rating": "QR-22",
    "conditions_rating": "QR-23",
    "note": "QR-24",
    "observer_latitude": "QR-25",
    "observer_longitude": "QR-25",
    "star_id": "QR-21",
    "observed_at": "QR-26",
}

_MESSAGES = {
    "QR-12": "Допускаються лише формати JPEG та PNG",
    "QR-13": "Розмір файлу не повинен перевищувати 10 МБ",
    "QR-14": "Ширина та висота знімка — не менше 800 × 600 пікселів",
    "QR-15": "Оберіть одне з 88 офіційно визнаних сузір'їв",
    "QR-17": "Заповніть обов'язкове поле",
    "QR-18": "Оберіть ліцензію з дозволеного переліку",
    "QR-19": "Підтвердьте право на передавання знімка та дотримання умов ліцензії",
    "QR-22": "Оцінка яскравості — ціле число від 1 до 5",
    "QR-23": "Оцінка умов спостереження — ціле число від 1 до 5",
    "QR-24": "Нотатка — не більше 2 000 символів",
    "QR-25": "Широта в межах −90°…+90°, довгота в межах −180°…+180°",
    "QR-26": "Дані не відповідають схемі",
}


def _schema_errors(validator, data: dict, rules: dict, missing_rule: str) -> list[dict]:
    out = []
    for e in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
        if e.validator == "required":
            field = e.message.split("'")[1] if "'" in e.message else None
            rule = missing_rule
            msg = "Заповніть обов'язкове поле"
        elif e.validator == "additionalProperties":
            field, rule, msg = None, "QR-26", "Передано непередбачені схемою поля"
        else:
            field = str(e.path[0]) if e.path else None
            rule = rules.get(field or "", "QR-26")
            msg = _MESSAGES.get(rule, "Некоректне значення")
            if e.validator == "format":
                msg = "Дата має бути у форматі YYYY-MM-DD"
            if field in ("title", "author") and e.validator == "maxLength":
                rule, msg = "QR-26", "Не більше 200 символів"
            if field == "description":
                msg = "Опис — не більше 2 000 символів"
        out.append(vf(rule, field, msg))
    return out


def today_in(tz_name: str | None) -> date:
    """Поточна дата в часовому поясі користувача (UC-10 EX5)."""
    try:
        tz = ZoneInfo(tz_name) if tz_name else ZoneInfo("UTC")
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("UTC")
    return datetime.now(tz).date()


def validate_image_metadata(meta: dict, tz_name: str | None) -> list[dict]:
    errors = _schema_errors(_image_validator, meta, _IMAGE_RULES, "QR-17")
    d = meta.get("date_taken")
    if isinstance(d, str):
        try:
            if date.fromisoformat(d) > today_in(tz_name):
                errors.append(vf("QR-16", "date_taken", "Дата зйомки не може бути пізнішою за поточну дату"))
        except ValueError:
            pass
    return errors


def validate_journal(entry: dict, tz_name: str | None, star_exists) -> list[dict]:
    errors = _schema_errors(_journal_validator, entry, _JOURNAL_RULES, "QR-26")
    d = entry.get("observed_at")
    if isinstance(d, str):
        try:
            if date.fromisoformat(d) > today_in(tz_name):
                errors.append(vf("QR-20", "observed_at", "Дата спостереження не може бути пізнішою за поточну дату"))
        except ValueError:
            pass
    sid = entry.get("star_id")
    if sid is not None and not any(e["field"] == "star_id" for e in errors):
        try:
            hip = int(sid)
        except (TypeError, ValueError):
            hip = None
        if hip is None or not star_exists(hip):
            errors.append(vf("QR-21", "star_id", "Зорі з таким ідентифікатором немає в каталозі"))
    return errors


# ----------------------------------------------------------------- файли
def sniff_image(data: bytes) -> str | None:
    """QR-12: тип визначається за вмістом файлу, а не за розширенням."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return None


def inspect_image(data: bytes) -> tuple[str | None, int, int, bool]:
    """Повертає (mime, ширина, висота, чи є GPS у EXIF)."""
    mime = sniff_image(data)
    if not mime:
        return None, 0, 0, False
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            w, h = im.size
            exif = im.getexif()
            has_gps = bool(exif.get_ifd(0x8825)) if exif else False
    except (UnidentifiedImageError, OSError, SyntaxError):
        return None, 0, 0, False
    return mime, w, h, has_gps


def strip_gps(data: bytes, mime: str) -> bytes:
    """Видаляє лише GPS-блок EXIF; решта метаданих зберігається (вимога DG-3 для C-03)."""
    with Image.open(io.BytesIO(data)) as im:
        exif = im.getexif()
        if not exif or not exif.get_ifd(0x8825):
            return data
        del exif[0x8825]
        buf = io.BytesIO()
        kwargs = {"exif": exif.tobytes()}
        if im.info.get("icc_profile"):
            kwargs["icc_profile"] = im.info["icc_profile"]
        if mime == "image/jpeg":
            im.save(buf, "JPEG", quality=95, subsampling="keep", **kwargs)
        else:
            im.save(buf, "PNG", **kwargs)
        return buf.getvalue()


def thumbnail(data: bytes, size: int = 720) -> bytes:
    """Мініатюра без жодних метаданих (публічна копія не містить EXIF)."""
    with Image.open(io.BytesIO(data)) as im:
        im = im.convert("RGB")
        im.thumbnail((size, size))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        return buf.getvalue()
