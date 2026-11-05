"""Правила якості зоряного каталогу (DG-5, табл. 2.30, QR-01…QR-11).

Підтримано два профілі імпорту, бо назви полів і одиниці HYG та Hipparcos
(Kaggle) не можна ототожнювати без перевірки метаданих (UC-14):

* hipparcos — головний каталог Hipparcos (ESA, 1997), файл із Kaggle:
  RAdeg/DEdeg у градусах ICRS (епоха J1991.25), Plx у мс дуги;
* hyg — HYG Database v4: ra у годинах, dist у парсеках, 100 000 пк = невідомо.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..starcolor import bv_to_hex


@dataclass(frozen=True)
class Profile:
    name: str
    required: tuple[str, ...]
    id_col: str
    hip_col: str
    ra_col: str
    ra_unit: str  # deg | hours
    dec_col: str
    mag_col: str
    ci_col: str
    numeric: tuple[str, ...]
    integer: tuple[str, ...]
    default_license: str
    default_source: str
    default_origin: str


PROFILES = {
    "hipparcos": Profile(
        name="hipparcos",
        required=("HIP", "RAdeg", "DEdeg", "Vmag"),
        id_col="HIP", hip_col="HIP", ra_col="RAdeg", ra_unit="deg", dec_col="DEdeg",
        mag_col="Vmag", ci_col="B-V",
        numeric=("RAdeg", "DEdeg", "Vmag", "Plx", "e_Plx", "pmRA", "pmDE", "B-V", "V-I"),
        integer=("HIP", "HD"),
        default_license="CC0: Public Domain",
        default_source="Hipparcos Star Astronomy Catalog (Kaggle)",
        default_origin="ESA, The Hipparcos and Tycho Catalogues (1997), I/239",
    ),
    "hyg": Profile(
        name="hyg",
        required=("id", "ra", "dec", "mag", "dist", "hip"),
        id_col="id", hip_col="hip", ra_col="ra", ra_unit="hours", dec_col="dec",
        mag_col="mag", ci_col="ci",
        numeric=("ra", "dec", "mag", "dist", "pmra", "pmdec", "ci"),
        integer=("id", "hip", "hd"),
        default_license="CC BY-SA 4.0",
        default_source="HYG Database",
        default_origin="https://github.com/astronexus/HYG-Database",
    ),
}

MESSAGES = {
    "QR-01": "Файл не відповідає формату імпорту: потрібні заголовок і записи",
    "QR-02": "Відсутнє обов'язкове значення",
    "QR-03": "Пряме піднесення поза допустимими межами",
    "QR-04": "Схилення має бути в межах −90° ≤ dec ≤ +90°",
    "QR-05": "Зоряна величина має бути скінченним числом від −30 до +30",
    "QR-06": "Відстань нечислова або від'ємна",
    "QR-07": "Запис Сонця (id = 0) виключено з карти неба",
    "QR-08": "Дублікат ідентифікатора HIP",
    "QR-09": "Показник кольору поза типовим діапазоном −0,5…+2,5 — потребує перевірки",
    "QR-10": "Тип значення не відповідає специфікації імпорту",
    "QR-11": "Версія джерела не входить до затверджених",
}


@dataclass
class RowResult:
    record: dict | None
    errors: list[tuple[str, str]] = field(default_factory=list)  # (rule, field)
    warnings: list[tuple[str, str]] = field(default_factory=list)
    transformations: list[str] = field(default_factory=list)


def _num(v: str) -> float | None:
    v = (v or "").strip()
    if v == "":
        return None
    x = float(v)  # ValueError → QR-10
    if not math.isfinite(x):
        raise ValueError("not finite")
    return x


def spectral_class(sp: str | None) -> str | None:
    if not sp:
        return None
    s = sp.strip()
    for prefix in ("sd", "d", "g", "c"):  # позначки класу світності перед літерою
        if s.startswith(prefix) and len(s) > len(prefix) and s[len(prefix)] in "OBAFGKM":
            s = s[len(prefix):]
            break
    return s[0] if s and s[0] in "OBAFGKM" else None


def check_row(p: Profile, row: dict, line_no: int) -> RowResult:
    res = RowResult(None)
    # QR-02: обов'язкові значення (для HYG hip може бути порожнім)
    for col in p.required:
        if (row.get(col) or "").strip() == "" and not (p.name == "hyg" and col == "hip"):
            res.errors.append(("QR-02", col))
    if res.errors:
        return res

    vals: dict[str, float | None] = {}
    for col in p.numeric:
        if col not in row:
            vals[col] = None
            continue
        try:
            vals[col] = _num(row[col])
        except ValueError:
            res.errors.append(("QR-06" if col == "dist" else ("QR-05" if col == p.mag_col else "QR-10"), col))
    ints: dict[str, int | None] = {}
    for col in p.integer:
        v = (row.get(col) or "").strip()
        if v == "":
            ints[col] = None
            continue
        try:
            f = float(v)
            if not f.is_integer():
                raise ValueError
            ints[col] = int(f)
        except ValueError:
            res.errors.append(("QR-10", col))
    if res.errors:
        return res

    ra, dec, mag = vals[p.ra_col], vals[p.dec_col], vals[p.mag_col]
    ra_max = 24.0 if p.ra_unit == "hours" else 360.0
    if not (0 <= ra < ra_max):
        res.errors.append(("QR-03", p.ra_col))
    if not (-90 <= dec <= 90):
        res.errors.append(("QR-04", p.dec_col))
    if not (-30 <= mag <= 30):
        res.errors.append(("QR-05", p.mag_col))

    dist_pc = None
    if p.name == "hyg":
        d = vals.get("dist")
        if d is not None and d < 0:
            res.errors.append(("QR-06", "dist"))
        elif d is not None and abs(d - 100000) < 1e-6:
            res.transformations.append("QR-06: dist = 100 000 пк (невідома відстань) → null")
        else:
            dist_pc = d
    else:
        plx = vals.get("Plx")
        if plx is None:
            res.transformations.append("QR-06: паралакс відсутній → відстань null")
        elif plx <= 0:
            res.transformations.append(f"QR-06: паралакс {plx:g} мс ≤ 0 → відстань null")
        else:
            dist_pc = 1000.0 / plx
    if res.errors:
        return res

    ci = vals.get(p.ci_col)
    if ci is not None and not (-0.5 <= ci <= 2.5):
        res.warnings.append(("QR-09", p.ci_col))

    visible = True
    source_id = ints.get(p.id_col)
    if p.name == "hyg" and source_id == 0:
        res.warnings.append(("QR-07", "id"))
        visible = False

    ra_deg = ra * 15.0 if p.ra_unit == "hours" else ra
    if p.ra_unit == "hours":
        res.transformations.append("ra: години → градуси (×15)")
    if p.name == "hipparcos":
        pm_ra, pm_dec = vals.get("pmRA"), vals.get("pmDE")
        sp = (row.get("SpType") or "").strip() or None
        vi = vals.get("V-I")
        hd = ints.get("HD")
        bd = (row.get("BD") or "").strip() or None
        e_plx = vals.get("e_Plx")
        plx = vals.get("Plx")
    else:
        pm_ra, pm_dec = vals.get("pmra"), vals.get("pmdec")
        sp = (row.get("spect") or "").strip() or None
        vi = None
        hd = ints.get("hd")
        bd = (row.get("bf") or "").strip() or None
        e_plx = None
        plx = (1000.0 / dist_pc) if dist_pc else None

    pm_total = math.hypot(pm_ra, pm_dec) if pm_ra is not None and pm_dec is not None else None
    res.record = {
        "source_id": str(source_id) if source_id is not None else str(line_no),
        "hip": ints.get(p.hip_col),
        "hd": hd,
        "bd": bd,
        "ra": ra_deg,
        "dec": dec,
        "vmag": mag,
        "bv": ci,
        "vi": vi,
        "plx": plx,
        "e_plx": e_plx,
        "pm_ra": pm_ra,
        "pm_dec": pm_dec,
        "sp_type": sp,
        "sp_class": spectral_class(sp),
        "dist_pc": dist_pc,
        "pm_total": pm_total,
        "color_hex": bv_to_hex(ci),
        "is_map_visible": visible,
        "warnings": [w[0] for w in res.warnings],
        "transformations": res.transformations,
        "proper": (row.get("proper") or "").strip() or None,
    }
    return res
