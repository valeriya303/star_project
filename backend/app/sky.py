"""Сузір'я: межі IAU, визначення належності зорі, підготовка ліній (DS-02)."""
from __future__ import annotations

import math
from functools import lru_cache

from .astro import precess_to_b1875

ABBR = [
    "And", "Ant", "Aps", "Aqr", "Aql", "Ara", "Ari", "Aur", "Boo", "Cae", "Cam", "Cnc", "CVn", "CMa",
    "CMi", "Cap", "Car", "Cas", "Cen", "Cep", "Cet", "Cha", "Cir", "Col", "Com", "CrA", "CrB", "Crv",
    "Crt", "Cru", "Cyg", "Del", "Dor", "Dra", "Equ", "Eri", "For", "Gem", "Gru", "Her", "Hor", "Hya",
    "Hyi", "Ind", "Lac", "Leo", "LMi", "Lep", "Lib", "Lup", "Lyn", "Lyr", "Men", "Mic", "Mon", "Mus",
    "Nor", "Oct", "Oph", "Ori", "Pav", "Peg", "Per", "Phe", "Pic", "Psc", "PsA", "Pup", "Pyx", "Ret",
    "Sge", "Sgr", "Sco", "Scl", "Sct", "Ser", "Sex", "Tau", "Tel", "Tri", "TrA", "Tuc", "UMa", "UMi",
    "Vel", "Vir", "Vol", "Vul",
]
_UPPER = {a.upper(): a for a in ABBR} | {"SER1": "Ser", "SER2": "Ser"}

# Латинські назви — у порядку ABBR (збігаються з переліком QR-15)
LATIN = [
    "Andromeda", "Antlia", "Apus", "Aquarius", "Aquila", "Ara", "Aries", "Auriga", "Boötes", "Caelum",
    "Camelopardalis", "Cancer", "Canes Venatici", "Canis Major", "Canis Minor", "Capricornus", "Carina",
    "Cassiopeia", "Centaurus", "Cepheus", "Cetus", "Chamaeleon", "Circinus", "Columba", "Coma Berenices",
    "Corona Australis", "Corona Borealis", "Corvus", "Crater", "Crux", "Cygnus", "Delphinus", "Dorado",
    "Draco", "Equuleus", "Eridanus", "Fornax", "Gemini", "Grus", "Hercules", "Horologium", "Hydra",
    "Hydrus", "Indus", "Lacerta", "Leo", "Leo Minor", "Lepus", "Libra", "Lupus", "Lynx", "Lyra", "Mensa",
    "Microscopium", "Monoceros", "Musca", "Norma", "Octans", "Ophiuchus", "Orion", "Pavo", "Pegasus",
    "Perseus", "Phoenix", "Pictor", "Pisces", "Piscis Austrinus", "Puppis", "Pyxis", "Reticulum",
    "Sagitta", "Sagittarius", "Scorpius", "Sculptor", "Scutum", "Serpens", "Sextans", "Taurus",
    "Telescopium", "Triangulum", "Triangulum Australe", "Tucana", "Ursa Major", "Ursa Minor", "Vela",
    "Virgo", "Volans", "Vulpecula",
]
ABBR_TO_LATIN = dict(zip(ABBR, LATIN))
LATIN_TO_ABBR = {v: k for k, v in ABBR_TO_LATIN.items()}

# Уточнення українських назв (відсутні або неусталені в перекладі Stellarium)
UK_OVERRIDES = {
    "Ara": "Жертовник", "Carina": "Кіль", "Norma": "Косинець", "Hydra": "Гідра",
    "Cetus": "Кит", "Boötes": "Волопас", "Crux": "Південний Хрест", "Hydrus": "Південна Гідра",
}


def _hms(s: str) -> float:
    h, m, sec = (float(x) for x in s.split(":"))
    return (h + m / 60 + sec / 3600) * 15.0


def _dms(s: str) -> float:
    sign = -1 if s.startswith("-") else 1
    d, m, sec = (float(x) for x in s.lstrip("+-").split(":"))
    return sign * (d + m / 60 + sec / 3600)


def parse_edges(edges: list[str]) -> list[tuple[float, float, float, str, str]]:
    """Повертає паралельні (уздовж схилення) сегменти: (dec, ra1, span, c1, c2)."""
    out = []
    for e in edges:
        parts = e.split()
        if len(parts) < 8 or not parts[1].startswith("P"):
            continue
        ra1, dec1, ra2 = _hms(parts[2]), _dms(parts[3]), _hms(parts[4])
        span = (ra2 - ra1) % 360.0
        if span == 0 and parts[2] != parts[4]:
            span = 360.0
        c1, c2 = _UPPER.get(parts[6].upper()), _UPPER.get(parts[7].upper())
        if c1 and c2:
            out.append((dec1, ra1, span, c1, c2))
    return out


class Boundaries:
    def __init__(self, edges: list[str]):
        self.par = parse_edges(edges)
        self.bins: list[list[int]] = [[] for _ in range(360)]
        for i, (_, ra1, span, _, _) in enumerate(self.par):
            start = int(math.floor(ra1))
            for k in range(int(math.ceil(span)) + 1):
                self.bins[(start + k) % 360].append(i)
        for b in self.bins:
            b.sort(key=lambda i: self.par[i][0])

    def _spans(self, i: int, ra: float) -> bool:
        _, ra1, span, _, _ = self.par[i]
        return (ra - ra1) % 360.0 < span

    def find(self, ra_j2000: float, dec_j2000: float) -> str | None:
        ra, dec = precess_to_b1875(ra_j2000, dec_j2000)
        cand = [i for i in self.bins[int(ra) % 360] if self._spans(i, ra)]
        above = [i for i in cand if self.par[i][0] > dec]
        if not above:
            return "UMi"  # північна полярна шапка
        first = above[0]
        c1, c2 = self.par[first][3], self.par[first][4]
        crossings = sum(1 for i in above if c1 in (self.par[i][3], self.par[i][4]))
        inside_c1 = (crossings % 2 == 0) if c1 == "UMi" else (crossings % 2 == 1)
        return c1 if inside_c1 else c2


@lru_cache(maxsize=4)
def _cached(key: tuple) -> Boundaries:
    return Boundaries(list(key))


def boundaries(edges: list[str]) -> Boundaries:
    return _cached(tuple(edges))


def polylines_to_pairs(lines: list[list[int]]) -> list[list[int]]:
    pairs = []
    seen = set()
    for poly in lines:
        for a, b in zip(poly, poly[1:]):
            key = (min(a, b), max(a, b))
            if a != b and key not in seen:
                seen.add(key)
                pairs.append([a, b])
    return pairs


MONTHS = ["січні", "лютому", "березні", "квітні", "травні", "червні", "липні", "серпні",
          "вересні", "жовтні", "листопаді", "грудні"]

# Короткі довідки для найвідоміших сузір'їв
CURATED = {
    "Ori": "Одне з найвідоміших сузір'їв екваторіальної області неба, добре видиме взимку в Північній "
           "півкулі. Містить яскраві Бетельгейзе та Рігель і «пояс Оріона» з трьох зір.",
    "UMa": "Сім найяскравіших зір утворюють астеризм «Великий Ківш». Дві крайні зорі ковша вказують "
           "напрямок на Полярну зорю.",
    "UMi": "Містить Полярну зорю, яка розташована менш ніж за 1° від північного полюса світу і "
           "слугує орієнтиром для визначення півночі.",
    "Cas": "П'ять яскравих зір утворюють характерну фігуру у формі літери W. Для Львова сузір'я "
           "незахідне.",
    "Cyg": "Найяскравіші зорі утворюють «Північний Хрест». Денеб разом із Вегою та Альтаїром "
           "складає «Літньо-осінній трикутник».",
    "Lyr": "Невелике сузір'я з Вегою — однією з найяскравіших зір неба й вершиною «Літньо-осіннього "
           "трикутника».",
    "Leo": "Зодіакальне сузір'я з яскравим Регулом. Голову Лева позначає астеризм «Серп».",
    "Sco": "Зодіакальне сузір'я з червоним надгігантом Антаресом. Із Львова видно низько над "
           "південним горизонтом улітку.",
    "Tau": "Зодіакальне сузір'я з Альдебараном та розсіяними скупченнями Плеяди й Гіади.",
    "Gem": "Зодіакальне сузір'я, найяскравіші зорі якого — Кастор і Поллукс.",
    "CMa": "Містить Сіріус — найяскравішу зорю нічного неба.",
    "And": "Містить галактику Андромеди (M31) — найвіддаленіший об'єкт, видимий неозброєним оком.",
    "Per": "Містить змінну зорю Алголь і радіант метеорного потоку Персеїди.",
    "Boo": "Містить Арктур — одну з найяскравіших зір неба, червоний гігант.",
    "Cru": "Найменше за площею сузір'я неба; з території України не видно.",
    "Aql": "Містить Альтаїр — одну з вершин «Літньо-осіннього трикутника».",
}


def describe(abbr: str, name_uk: str, latin: str, decs: list[float], ras: list[float],
             brightest: tuple[str, float] | None, lat: float = 49.8397) -> str:
    parts = [CURATED[abbr]] if abbr in CURATED else []
    if decs:
        max_dec, min_dec = max(decs), min(decs)
        if min_dec > 90 - lat:
            vis = "З Львова сузір'я незахідне — видно протягом усього року."
        elif max_dec < lat - 90:
            vis = "З Львова сузір'я не видно: воно не піднімається над горизонтом."
        elif min_dec < lat - 90:
            vis = "З Львова видно лише частину сузір'я."
        else:
            vis = "З Львова сузір'я видно повністю."
        # середнє RA (кругове) → місяць, коли сузір'я кульмінує близько 21:00
        sx = sum(math.cos(math.radians(r)) for r in ras)
        sy = sum(math.sin(math.radians(r)) for r in ras)
        ra_mean_h = (math.degrees(math.atan2(sy, sx)) % 360) / 15.0
        month = int(round(((ra_mean_h - 9.0) % 24) / 2.0 + 2)) % 12  # RA Сонця 0h ≈ березень
        if max_dec >= lat - 90:
            vis += f" Найкраще спостерігати ввечері в {MONTHS[month]}."
        parts.append(vis)
    if brightest:
        parts.append(f"Найяскравіша зоря — {brightest[0]} ({brightest[1]:.2f}".replace(".", ",") + "m).")
    if not parts:
        parts.append(f"Сузір'я {name_uk} ({latin}).")
    return " ".join(parts)
