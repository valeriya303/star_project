"""Витягує українські переклади назв зір і сузір'їв із po-файлів Stellarium.

Використання:
    python tools/build_uk_names.py stellarium-sky-uk.po stellarium-skycultures-uk.po data/stellarium/uk_names.json
Результат — словник {"stars": {english: uk}, "constellations": {latin: uk}}.
"""
import json
import sys

import polib


def main(stars_po: str, cultures_po: str, out: str) -> None:
    stars = {}
    for e in polib.pofile(stars_po):
        if e.msgstr and not e.obsolete:
            stars.setdefault(e.msgid, e.msgstr)
    cons = {}
    for e in polib.pofile(cultures_po):
        if e.msgstr and not e.obsolete and not e.msgctxt:
            cons.setdefault(e.msgid, e.msgstr)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"stars": stars, "constellations": cons}, f, ensure_ascii=False)


if __name__ == "__main__":
    main(*sys.argv[1:4])
