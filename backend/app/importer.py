"""Імпорт зоряного каталогу (UC-14) та ліній сузір'їв (UC-18).

Імпорт двоетапний: файл перевіряється й розміщується як версія зі статусом
pending разом зі звітом якості; адміністратор переглядає звіт і підтверджує
(активація) або скасовує (AC2). Чинний каталог не змінюється до підтвердження.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.orm import Session

from . import audit, catalog_cache
from .config import BASE_DIR, settings
from .errors import ApiError
from .models import CatalogVersion, Constellation, ConstellationVersion, Star, StarName, utcnow
from .quality.catalog import MESSAGES, PROFILES, check_row
from .sky import ABBR, ABBR_TO_LATIN, UK_OVERRIDES, boundaries, polylines_to_pairs

csv.field_size_limit(10_000_000)

UK_NAMES_FILE = BASE_DIR / "data" / "stellarium" / "uk_names.json"


def _batch_id(prefix: str) -> str:
    return f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')[:-3]}"


def _report_id(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    n = db.execute(select(func.count()).select_from(CatalogVersion)).scalar_one() + 1
    return f"QRPT-{year}-{n:03d}"


def file_checksum(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------- каталог
def stage_catalog(db: Session, actor: audit.Actor, path: Path, file_name: str, meta: dict) -> CatalogVersion:
    profile = PROFILES.get(meta.get("profile", ""))
    batch = _batch_id("IMP")
    audit.log(actor, "AUD-07", "ImportBatch", batch, audit.SUCCESS, None,
              {"profile": meta.get("profile"), "file_name": file_name})
    started = time.perf_counter()

    def fail(rule: str, message: str, status: int = 422):
        audit.log(actor, "AUD-08", "ImportBatch", batch, audit.ERROR, rule, {"message": message})
        raise ApiError(status, message, rule, {"batch_id": batch})

    # Повнота метаданих (UC-14 крок 4, EX2)
    missing = [k for k in ("profile", "source", "source_url", "source_version") if not str(meta.get(k) or "").strip()]
    if profile is None:
        fail("INVALID_PROFILE", "Невідомий профіль імпорту. Допустимі: hipparcos, hyg")
    if missing:
        fail("METADATA_INCOMPLETE", "Неповні метадані джерела: " + ", ".join(missing))

    checksum = file_checksum(path)
    # QR-01: структура файлу
    try:
        fh = open(path, encoding="utf-8-sig", newline="")
        sample = fh.read(4096)
        fh.seek(0)
        reader = csv.DictReader(fh)
        header = reader.fieldnames or []
    except UnicodeDecodeError:
        fail("QR-01", MESSAGES["QR-01"] + " (кодування не UTF-8)")
    if not header or "," not in sample:
        fh.close()
        fail("QR-01", MESSAGES["QR-01"])
    # QR-02: обов'язкові колонки
    absent = [c for c in profile.required if c not in header]
    if absent:
        fh.close()
        fail("QR-02", "Відсутні обов'язкові колонки: " + ", ".join(absent) +
             ". Перевірте, чи обрано правильний профіль імпорту")

    approved = settings.approved_versions.get(profile.name, [])
    import_warnings = []
    if meta["source_version"] not in approved:
        import_warnings.append({"rule_id": "QR-11", "message": MESSAGES["QR-11"] +
                                f": «{meta['source_version']}». Затверджені: {', '.join(approved)}"})

    # Перший прохід: перевірка рядків
    results = []
    hip_counter: Counter = Counter()
    total = 0
    try:
        for i, row in enumerate(reader, start=2):
            total += 1
            r = check_row(profile, row, i)
            results.append((i, r))
            if r.record and r.record["hip"] is not None:
                hip_counter[r.record["hip"]] += 1
    except csv.Error as e:
        fh.close()
        fail("QR-01", f"{MESSAGES['QR-01']}: {e}")
    fh.close()
    if total == 0:
        fail("QR-01", MESSAGES["QR-01"] + " (немає записів)")

    # QR-08: дублікати HIP — відхиляються всі записи з дубльованим HIP
    dups = {h for h, n in hip_counter.items() if n > 1}

    cv = db.execute(select(ConstellationVersion).where(ConstellationVersion.status == "active")).scalar_one_or_none()
    bnd = boundaries(cv.edges) if cv and cv.edges else None

    report_id = _report_id(db)
    version = CatalogVersion(
        batch_id=batch,
        profile=profile.name,
        source=meta["source"].strip(),
        source_url=meta["source_url"].strip(),
        origin=(meta.get("origin") or profile.default_origin).strip(),
        source_version=meta["source_version"].strip(),
        license=(meta.get("license") or profile.default_license).strip(),
        file_name=file_name,
        checksum_sha256=checksum,
        imported_by=actor.id,
        status="pending",
    )
    db.add(version)
    db.flush()

    violations: dict[str, dict] = defaultdict(lambda: {"count": 0, "records": 0})
    issues = []
    accepted = accepted_w = rejected = 0
    transformations = Counter()
    rows_to_insert = []
    rejected_rows: list[tuple[int, str, str]] = []

    for line, r in results:
        if r.record and r.record["hip"] in dups:
            r.errors.append(("QR-08", profile.hip_col))
        seen_rules = set()
        for rule, fld in r.errors + r.warnings:
            violations[rule]["count"] += 1
            if rule not in seen_rules:
                violations[rule]["records"] += 1
                seen_rules.add(rule)
            if len(issues) < 500:
                issues.append({
                    "row": line, "field": fld, "rule_id": rule,
                    "level": "error" if (rule, fld) in r.errors else "warning",
                    "message": MESSAGES[rule],
                })
        if r.errors:
            rejected += 1
            rejected_rows.append((line, r.errors[0][0], r.errors[0][1]))
            continue
        rec = r.record
        rec.pop("proper", None)
        for t in rec["transformations"]:
            transformations[t.split(":")[0]] += 1
        rec["version_id"] = version.id
        rec["con"] = bnd.find(rec["ra"], rec["dec"]) if bnd else None
        rows_to_insert.append(rec)
        if r.warnings:
            accepted_w += 1
        else:
            accepted += 1

    for i in range(0, len(rows_to_insert), 5000):
        db.execute(insert(Star), rows_to_insert[i:i + 5000])

    duration = round(time.perf_counter() - started, 1)
    status = "completed" if rejected == 0 else "completed_with_errors"
    assert total == accepted + accepted_w + rejected
    version.report = {
        "report_id": report_id,
        "import_date": utcnow().isoformat().replace("+00:00", "Z"),
        "source": version.source,
        "source_version": version.source_version,
        "file_name": file_name,
        "total_records": total,
        "accepted": accepted,
        "accepted_with_warnings": accepted_w,
        "rejected": rejected,
        "violations": dict(sorted(violations.items())),
        "status": status,
        "duration_seconds": duration,
        # додаткові поля
        "batch_id": batch,
        "profile": profile.name,
        "checksum_sha256": checksum,
        "import_warnings": import_warnings,
        "transformations": dict(transformations),
        "issues": issues,
        "issues_truncated": sum(v["count"] for v in violations.values()) > len(issues),
        "constellations_assigned": bnd is not None,
    }
    db.commit()

    # Аудит відхилень через якість (AUD-09): кожен відхилений запис, до 1000 подій на партію
    for line, rule, fld in rejected_rows[:1000]:
        audit.log(actor, "AUD-09", "CatalogRecord", f"{batch}:row{line}", audit.DENIED, rule,
                  {"rule_id": rule, "field": fld, "batch_id": batch})
    if len(rejected_rows) > 1000:
        audit.log(actor, "AUD-09", "ImportBatch", batch, audit.DENIED, "MANY_REJECTIONS",
                  {"not_logged_individually": len(rejected_rows) - 1000})
    audit.log(actor, "AUD-08", "ImportBatch", batch, audit.SUCCESS, None,
              {"stage": "validated", "status": status, "total": total, "accepted": accepted,
               "accepted_with_warnings": accepted_w, "rejected": rejected})
    return version


def confirm_catalog(db: Session, actor: audit.Actor, version_id: str) -> CatalogVersion:
    v = db.get(CatalogVersion, version_id)
    if not v or v.status != "pending":
        raise ApiError(409, "Підтвердити можна лише версію, що очікує рішення", "INVALID_STATE")
    if v.report.get("accepted", 0) + v.report.get("accepted_with_warnings", 0) == 0:
        raise ApiError(409, "У версії немає прийнятих записів", "NOTHING_ACCEPTED")
    # DS-1: зберігаються поточна та попередня версії
    for old in db.execute(select(CatalogVersion).where(CatalogVersion.status == "previous")).scalars():
        db.execute(delete(Star).where(Star.version_id == old.id))
        db.delete(old)
        audit.log(actor, "AUD-15", "CatalogVersion", old.batch_id, audit.SUCCESS, None,
                  {"reason": "retention: застаріла версія каталогу"})
    db.execute(update(CatalogVersion).where(CatalogVersion.status == "active").values(status="previous"))
    v.status = "active"
    v.activated_at = utcnow()
    db.commit()
    catalog_cache.invalidate()
    audit.log(actor, "AUD-08", "ImportBatch", v.batch_id, audit.SUCCESS, None, {"stage": "activated"})
    return v


def cancel_catalog(db: Session, actor: audit.Actor, version_id: str) -> CatalogVersion:
    v = db.get(CatalogVersion, version_id)
    if not v or v.status != "pending":
        raise ApiError(409, "Скасувати можна лише версію, що очікує рішення", "INVALID_STATE")
    db.execute(delete(Star).where(Star.version_id == v.id))
    v.status = "cancelled"
    db.commit()
    audit.log(actor, "AUD-08", "ImportBatch", v.batch_id, audit.SUCCESS, None, {"stage": "cancelled"})
    return v


# ------------------------------------------------------------ сузір'я (UC-18)
def _uk_names() -> dict:
    try:
        return json.loads(UK_NAMES_FILE.read_text("utf-8"))
    except FileNotFoundError:
        return {"stars": {}, "constellations": {}}


def _norm(s: str) -> str:
    return " ".join(s.lower().replace("'", "").replace("’", "").replace("ʼ", "").split())


def stage_constellations(db: Session, actor: audit.Actor, data: bytes, file_name: str, meta: dict) -> ConstellationVersion:
    batch = _batch_id("SKY")
    audit.log(actor, "AUD-07", "SkyCultureImport", batch, audit.SUCCESS, None, {"file_name": file_name})

    def fail(code: str, message: str):
        audit.log(actor, "AUD-08", "SkyCultureImport", batch, audit.ERROR, code, {"message": message})
        raise ApiError(422, message, code, {"batch_id": batch})

    try:
        doc = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("QR-01", "Файл не є коректним JSON (index.json Stellarium)")
    if not isinstance(doc, dict) or not isinstance(doc.get("constellations"), list):
        fail("QR-01", "Невідома схема: очікується index.json із полем constellations")
    if not str(meta.get("source_version") or "").strip():
        fail("METADATA_INCOMPLETE", "Вкажіть версію набору даних")

    active_cat = catalog_cache.active_version_id(db)
    known_hips = set()
    if active_cat:
        known_hips = {h for (h,) in db.execute(select(Star.hip).where(Star.version_id == active_cat, Star.hip.is_not(None)))}

    uk = _uk_names()
    v = ConstellationVersion(
        batch_id=batch,
        source=meta.get("source") or "Stellarium Sky Cultures Archive (modern)",
        source_url=meta.get("source_url") or "https://github.com/Stellarium/stellarium/tree/master/skycultures/modern",
        source_version=meta["source_version"],
        license=meta.get("license") or "Уточнюється (Stellarium, GPL-2.0-or-later для перекладів)",
        file_name=file_name,
        checksum_sha256=hashlib.sha256(data).hexdigest(),
        imported_by=actor.id,
        status="pending",
        edges=[e for e in doc.get("edges", []) if isinstance(e, str)],
    )
    db.add(v)
    db.flush()

    matched, unmatched, invalid = set(), set(), []
    seen_abbr = set()
    for c in doc["constellations"]:
        cid = str(c.get("id", ""))
        abbr = cid.split()[-1] if cid else ""
        lines = c.get("lines") or []
        ok_lines = isinstance(lines, list) and all(isinstance(p, list) and all(isinstance(h, int) for h in p) for p in lines)
        if abbr not in ABBR or not ok_lines:
            invalid.append(cid or "?")
            continue
        seen_abbr.add(abbr)
        pairs = polylines_to_pairs(lines)
        for a, b in pairs:
            for h in (a, b):
                (matched if (not known_hips or h in known_hips) else unmatched).add(h)
        latin = ABBR_TO_LATIN[abbr]
        name = c.get("common_name") or {}
        db.add(Constellation(
            version_id=v.id, abbr=abbr, latin=latin, english=name.get("english") or latin,
            name_uk=UK_OVERRIDES.get(latin) or uk["constellations"].get(latin) or latin,
            lines=pairs,
        ))

    names_count = 0
    for key, variants in (doc.get("common_names") or {}).items():
        if not key.startswith("HIP "):
            continue
        try:
            hip = int(key[4:])
        except ValueError:
            continue
        for idx, nm in enumerate(variants):
            en = nm.get("english") or nm.get("native")
            if not en:
                continue
            ukn = uk["stars"].get(en)
            if ukn:
                db.add(StarName(version_id=v.id, hip=hip, name=ukn, lang="uk", is_primary=idx == 0, normalized=_norm(ukn)))
            db.add(StarName(version_id=v.id, hip=hip, name=en, lang="en", is_primary=idx == 0 and not ukn,
                            normalized=_norm(en)))
            names_count += 1

    v.report = {
        "batch_id": batch,
        "import_date": utcnow().isoformat().replace("+00:00", "Z"),
        "source": v.source,
        "source_version": v.source_version,
        "file_name": file_name,
        "constellations": len(seen_abbr),
        "missing_constellations": sorted(set(ABBR) - seen_abbr),
        "invalid_entries": invalid,
        "hip_matched": len(matched),
        "hip_unmatched": len(unmatched),
        "unmatched_hips": sorted(unmatched)[:200],
        "star_names": names_count,
        "boundary_edges": len(v.edges),
        "checked_against_catalog": bool(known_hips),
        "status": "completed" if not invalid and not unmatched else "completed_with_errors",
    }
    db.commit()
    audit.log(actor, "AUD-08", "SkyCultureImport", batch, audit.SUCCESS, None,
              {"stage": "validated", "matched": len(matched), "unmatched": len(unmatched)})
    return v


def confirm_constellations(db: Session, actor: audit.Actor, version_id: str) -> ConstellationVersion:
    v = db.get(ConstellationVersion, version_id)
    if not v or v.status != "pending":
        raise ApiError(409, "Підтвердити можна лише версію, що очікує рішення", "INVALID_STATE")
    for old in db.execute(select(ConstellationVersion).where(ConstellationVersion.status == "previous")).scalars():
        db.delete(old)
    db.execute(update(ConstellationVersion).where(ConstellationVersion.status == "active").values(status="previous"))
    v.status = "active"
    db.commit()
    # Належність зір до сузір'їв (обчислюване поле, AD-05) для чинної та очікуваних версій
    if v.edges:
        bnd = boundaries(v.edges)
        for cat in db.execute(select(CatalogVersion).where(CatalogVersion.status.in_(["active", "pending"]))).scalars():
            rows = db.execute(select(Star.id, Star.ra, Star.dec).where(Star.version_id == cat.id)).all()
            updates = [{"id": i, "con": bnd.find(ra, dec)} for i, ra, dec in rows]
            for k in range(0, len(updates), 5000):
                db.execute(update(Star), updates[k:k + 5000])
            cat.report = {**cat.report, "constellations_assigned": True}
        db.commit()
    catalog_cache.invalidate()
    audit.log(actor, "AUD-08", "SkyCultureImport", v.batch_id, audit.SUCCESS, None, {"stage": "activated"})
    return v


def cancel_constellations(db: Session, actor: audit.Actor, version_id: str) -> ConstellationVersion:
    v = db.get(ConstellationVersion, version_id)
    if not v or v.status != "pending":
        raise ApiError(409, "Скасувати можна лише версію, що очікує рішення", "INVALID_STATE")
    db.execute(delete(Constellation).where(Constellation.version_id == v.id))
    db.execute(delete(StarName).where(StarName.version_id == v.id))
    v.status = "cancelled"
    db.commit()
    audit.log(actor, "AUD-08", "SkyCultureImport", v.batch_id, audit.SUCCESS, None, {"stage": "cancelled"})
    return v


def read_upload_to_temp(data_stream, dest: Path, limit: int) -> int:
    size = 0
    with open(dest, "wb") as out:
        while chunk := data_stream.read(1 << 20):
            size += len(chunk)
            if size > limit:
                raise ApiError(413, "Файл перевищує допустимий розмір імпорту", "TOO_LARGE")
            out.write(chunk)
    return size


__all__ = ["stage_catalog", "confirm_catalog", "cancel_catalog", "stage_constellations",
           "confirm_constellations", "cancel_constellations", "io"]
