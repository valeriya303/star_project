"""Астрономічні обчислення на сервері (IAstro, UC-08).

Сервер виконує розрахунок сходу, кульмінації й заходу та горизонтальних
координат на заданий момент. Враховано власний рух від епохи Hipparcos
(J1991.25) та прецесію J2000 → дата (Meeus, гл. 21), атмосферну рефракцію
на горизонті (h0 = −0,5667°). Погода та місцеві перешкоди не враховуються.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date as Date
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SIDEREAL_RATE = 360.98564736629  # °/добу
H0 = -0.5667  # висота центру зорі в момент сходу з урахуванням рефракції
HIPPARCOS_EPOCH_JD = 2448349.0625  # J1991.25

LVIV = {"lat": 49.8397, "lon": 24.0297, "name": "Львів", "timezone": "Europe/Kyiv"}

DISCLAIMER = (
    "Розраховано геометричне положення зорі. Погода, засвічення та місцеві "
    "перешкоди (будинки, рельєф) не враховуються."
)


class TimeError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def julian_day(dt: datetime) -> float:
    dt = dt.astimezone(timezone.utc)
    return dt.timestamp() / 86400.0 + 2440587.5


def gmst_deg(jd: float) -> float:
    t = (jd - 2451545.0) / 36525.0
    g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - t**3 / 38710000.0
    return g % 360.0


def apply_proper_motion(ra: float, dec: float, pm_ra: float | None, pm_dec: float | None, jd: float):
    if pm_ra is None or pm_dec is None:
        return ra, dec
    years = (jd - HIPPARCOS_EPOCH_JD) / 365.25
    cosd = math.cos(math.radians(dec)) or 1e-9
    ra2 = ra + (pm_ra * years / 3.6e6) / cosd
    dec2 = max(-90.0, min(90.0, dec + pm_dec * years / 3.6e6))
    return ra2 % 360.0, dec2


def precess_from_j2000(ra: float, dec: float, jd: float):
    t = (jd - 2451545.0) / 36525.0
    zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t**3) / 3600.0
    z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t**3) / 3600.0
    theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t**3) / 3600.0
    a, d = math.radians(ra), math.radians(dec)
    zt, zz, th = math.radians(zeta), math.radians(z), math.radians(theta)
    A = math.cos(d) * math.sin(a + zt)
    B = math.cos(th) * math.cos(d) * math.cos(a + zt) - math.sin(th) * math.sin(d)
    C = math.sin(th) * math.cos(d) * math.cos(a + zt) + math.cos(th) * math.sin(d)
    ra2 = (math.degrees(math.atan2(A, B)) + math.degrees(zz)) % 360.0
    dec2 = math.degrees(math.asin(max(-1.0, min(1.0, C))))
    return ra2, dec2


def apparent_radec(ra, dec, pm_ra, pm_dec, jd):
    ra1, dec1 = apply_proper_motion(ra, dec, pm_ra, pm_dec, jd)
    return precess_from_j2000(ra1, dec1, jd)


def precess_to_b1875(ra: float, dec: float):
    """Для визначення сузір'я за межами IAU (епоха B1875)."""
    jd_b1875 = 2405889.258550475
    # Прецесія «назад»: формули Meeus з від'ємним t
    return precess_from_j2000(ra, dec, jd_b1875)


def altaz(ra: float, dec: float, lat: float, lon: float, jd: float):
    lst = (gmst_deg(jd) + lon) % 360.0
    h = math.radians((lst - ra) % 360.0)
    phi, d = math.radians(lat), math.radians(dec)
    sin_alt = math.sin(phi) * math.sin(d) + math.cos(phi) * math.cos(d) * math.cos(h)
    alt = math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))
    az = math.degrees(
        math.atan2(-math.sin(h) * math.cos(d), math.sin(d) * math.cos(phi) - math.cos(d) * math.sin(phi) * math.cos(h))
    ) % 360.0
    return alt, az


def resolve_local_time(d: Date, t: time, tz_name: str, fold: int | None = None) -> datetime:
    """Визначає однозначний момент часу (UC-07 AC3, EX3)."""
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise TimeError("INVALID_TIMEZONE", "Невідомий часовий пояс")
    naive = datetime.combine(d, t)
    a = naive.replace(tzinfo=tz, fold=0)
    b = naive.replace(tzinfo=tz, fold=1)
    if a.utcoffset() == b.utcoffset():
        return a
    # Неіснуючий час: після переходу «вперед» перетворення не повертає той самий локальний час
    back = a.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None)
    if back != naive:
        raise TimeError("NONEXISTENT_LOCAL_TIME",
                        "Такого місцевого часу не існує (перехід на літній час). Вкажіть інший час")
    if fold is None:
        raise TimeError("AMBIGUOUS_LOCAL_TIME",
                        "Місцевий час неоднозначний (перехід на зимовий час). Уточніть, який саме момент")
    return b if fold == 1 else a


@dataclass
class Visibility:
    altitude: float
    azimuth: float
    above: bool
    case: str  # normal | circumpolar | never_rises
    rise: datetime | None
    transit: datetime | None
    set: datetime | None
    transit_altitude: float
    ra_date: float
    dec_date: float


def _event_after(start_jd: float, target_lst: float, lon: float) -> float:
    lst0 = (gmst_deg(start_jd) + lon) % 360.0
    delta = (target_lst - lst0) % 360.0
    return start_jd + delta / SIDEREAL_RATE


def visibility(ra, dec, pm_ra, pm_dec, lat, lon, moment: datetime) -> Visibility:
    jd = julian_day(moment)
    ra_d, dec_d = apparent_radec(ra, dec, pm_ra, pm_dec, jd)
    alt, az = altaz(ra_d, dec_d, lat, lon, jd)
    phi, d = math.radians(lat), math.radians(dec_d)
    transit_alt = 90.0 - abs(lat - dec_d)
    cos_h0 = (math.sin(math.radians(H0)) - math.sin(phi) * math.sin(d)) / (math.cos(phi) * math.cos(d) or 1e-12)

    to_dt = lambda j: datetime.fromtimestamp((j - 2440587.5) * 86400.0, tz=timezone.utc)  # noqa: E731
    sidereal_day = 360.0 / SIDEREAL_RATE  # ≈ 0,99727 доби
    # Найближча кульмінація: у межах ±½ зоряної доби від моменту
    transit = _event_after(jd - sidereal_day / 2, ra_d, lon)
    if cos_h0 < -1:  # AC2: зоря не заходить
        return Visibility(alt, az, True, "circumpolar", None, to_dt(transit), None, transit_alt, ra_d, dec_d)
    if cos_h0 > 1:  # AC2: зоря не сходить
        return Visibility(alt, az, False, "never_rises", None, None, None, transit_alt, ra_d, dec_d)
    h0 = math.degrees(math.acos(cos_h0))
    next_rise = _event_after(jd, (ra_d - h0) % 360.0, lon)
    next_set = _event_after(jd, (ra_d + h0) % 360.0, lon)
    # Над горизонтом — показуємо схід, що вже відбувся, і найближчий захід;
    # під горизонтом — найближчий схід і захід після нього.
    rise = next_rise - sidereal_day if alt > H0 else next_rise
    return Visibility(alt, az, alt > 0, "normal", to_dt(rise), to_dt(transit), to_dt(next_set),
                      transit_alt, ra_d, dec_d)


def compass(az: float) -> str:
    names = ["Пн", "Пн-Сх", "Сх", "Пд-Сх", "Пд", "Пд-Зх", "Зх", "Пн-Зх"]
    return names[int(((az % 360) + 22.5) // 45) % 8]


def local_str(dt: datetime | None, tz: ZoneInfo, ref: datetime) -> dict | None:
    if dt is None:
        return None
    loc = dt.astimezone(tz)
    ref_loc = ref.astimezone(tz)
    day_shift = (loc.date() - ref_loc.date()).days
    label = loc.strftime("%H:%M")
    if day_shift == 1:
        label += " (завтра)"
    elif day_shift == -1:
        label += " (учора)"
    return {"utc": dt.isoformat().replace("+00:00", "Z"), "local": loc.isoformat(), "label": label}


def describe(v: Visibility, tz: ZoneInfo, moment: datetime) -> str:
    if v.case == "circumpolar":
        return "Незахідна зоря: на цій широті завжди над горизонтом"
    if v.case == "never_rises":
        return "Ця зоря не сходить на цій широті"
    if v.above:
        s = local_str(v.set, tz, moment)
        return f"Над горизонтом, {round(v.altitude)}° ({compass(v.azimuth)})" + (f", зайде о {s['label']}" if s else "")
    r = local_str(v.rise, tz, moment)
    return "Під горизонтом" + (f", зійде о {r['label']}" if r else "")


def lst_deg(moment: datetime, lon: float) -> float:
    return (gmst_deg(julian_day(moment)) + lon) % 360.0


def tz_or_utc(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def today_local(tz_name: str) -> datetime:
    return datetime.now(tz_or_utc(tz_name))


__all__ = [
    "LVIV", "DISCLAIMER", "TimeError", "visibility", "describe", "local_str", "resolve_local_time",
    "precess_to_b1875", "apparent_radec", "altaz", "lst_deg", "tz_or_utc", "timedelta",
]
