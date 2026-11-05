"""Багатомовний нечіткий пошук за назвами (зорі, спостерігачі).

Запит і назва зводяться до кількох «форм», які потім порівнюються:
  • нормалізація: нижній регістр, без діакритики (é → e, ł → l, ß → ss), без апострофів і дефісів;
  • транслітерація кирилиці латиницею, щоб «Бетельгейзе» знаходило «Betelgeuse», а «Vega» — «Вега»;
  • виправлення розкладки клавіатури: «dtuf» → «вега», «руфд» → «heal».
Збіг оцінюється від 3 (точний) до 0.3 (схожість за триграмами, аналог pg_trgm).
"""
from __future__ import annotations

import unicodedata
from functools import lru_cache

_SPECIAL = str.maketrans({"ß": "ss", "ł": "l", "Ł": "l", "ø": "o", "æ": "ae", "œ": "oe", "đ": "d", "ı": "i"})
_DROP = "'’ʼ`´\"«»“”.()"

# Спрощена транслітерація (для порівняння, а не для показу): г → g, бо назви зір переважно арабські/грецькі
_CYR = {
    "а": "a", "б": "b", "в": "v", "г": "g", "ґ": "g", "д": "d", "е": "e", "є": "ye", "ж": "zh", "з": "z",
    "и": "i", "і": "i", "ї": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p",
    "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh",
    "щ": "shch", "ь": "", "ю": "yu", "я": "ya", "ы": "y", "э": "e", "ё": "e", "ъ": "",
}

# Латинські буквосполучення, що звучать однаково («ae», «eu» у Betelgeuse ≈ «ей»)
_LAT_SIMPLIFY = [("iya", "ia"), ("iyu", "iu"), ("iye", "ie"), ("kh", "h"), ("ph", "f"), ("th", "t"), ("ck", "k"), ("q", "k"), ("w", "v"), ("x", "ks"),
                 ("eu", "ei"), ("ey", "ei"), ("ej", "ei"), ("ay", "ai"), ("aj", "ai"), ("j", "y"), ("c", "k"),
                 ("ae", "e"), ("oe", "e"), ("ii", "i"), ("yy", "y"), ("z", "s")]

_EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,."
_UK = "йцукенгшщзхїфівапролджєячсмитьбю"
_EN2UK = str.maketrans(_EN, _UK)
_UK2EN = str.maketrans(_UK, _EN)


def norm(s: str) -> str:
    s = s.translate(_SPECIAL).lower()
    # NFKD розкладає «й» і «ї»: зберігаємо їх (вони значущі для української), решту діакритики прибираємо
    d = unicodedata.normalize("NFKD", s).replace("\u0438\u0306", "\u0439").replace("\u0456\u0308", "\u0457")
    s = "".join(ch for ch in d if not unicodedata.combining(ch))
    for ch in _DROP:
        s = s.replace(ch, "")
    s = s.replace("-", " ").replace("_", " ")
    return " ".join(s.split())


def translit(s: str) -> str:
    out = "".join(_CYR.get(ch, ch) for ch in s)
    for a, b in _LAT_SIMPLIFY:
        out = out.replace(a, b)
    # подвоєні приголосні: «Mizzar» ≈ «Мізар»
    res = []
    for ch in out:
        if not (res and res[-1] == ch and ch.isalpha() and ch not in "aeiouy"):
            res.append(ch)
    return "".join(res)


def _is_latin(s: str) -> bool:
    return all(ord(c) < 128 for c in s if c.isalpha())


def query_forms(q: str) -> list[str]:
    """Варіанти запиту: як є, транслітерований, а також у «правильній» розкладці."""
    n = norm(q)
    forms = [n, translit(n)]
    raw = q.lower()
    if _is_latin(raw):
        switched = norm(raw.translate(_EN2UK))  # набрано українською на англійській розкладці
    else:
        switched = norm(raw.translate(_UK2EN))  # і навпаки
    if switched and switched != n:
        forms += [switched, translit(switched)]
    seen, out = set(), []
    for f in forms:
        if f and f not in seen:
            seen.add(f)
            out.append(f)
    return out


@lru_cache(maxsize=20000)
def name_forms(name: str) -> tuple[str, ...]:
    n = norm(name)
    t = translit(n)
    return (n, t) if t != n else (n,)


def trigrams(s: str) -> frozenset[str]:
    s = f"  {s} "
    return frozenset(s[i:i + 3] for i in range(len(s) - 2))


@lru_cache(maxsize=40000)
def _tg(s: str) -> frozenset[str]:
    return trigrams(s)


def score(qforms: list[str], name: str) -> float:
    """0 — не схоже; 3 — точний збіг. Перша форма запиту (як введено) має невелику перевагу."""
    best = 0.0
    for qi, q in enumerate(qforms):
        bonus = 0.05 if qi == 0 else 0.0
        for nn in name_forms(name):
            words = nn.split()
            if nn == q:
                sc = 3.0
            elif nn.startswith(q):
                sc = 2.0 + len(q) / max(len(nn), 1)
            elif any(w.startswith(q) for w in words):
                sc = 1.8
            elif len(q) >= 3 and q in nn:
                sc = 1.5
            elif len(q) >= 3:
                tq, tn = _tg(q), _tg(nn)
                sim = len(tq & tn) / max(len(tq | tn), 1)
                sc = sim * 1.4 if sim >= 0.34 else 0.0
            else:
                sc = 0.0
            best = max(best, sc + (bonus if sc else 0))
    return best
