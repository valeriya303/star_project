"""Збирає переклади назв зір з po-файлів Stellarium (домен stellarium-sky) кількома мовами.

Використання:
    python tools/build_i18n_names.py data/stellarium/index.json data/stellarium/i18n_names.json de=sky-de.po fr=sky-fr.po ...
Зберігаються лише назви зір, що є в index.json, і лише ті переклади, що відрізняються від англійської.
Результат: {"languages": {код: назва}, "stars": {english: {код: [назви]}}}.
"""
import json
import re
import sys

import polib

LANGS = {"de": "німецька", "fr": "французька", "es": "іспанська", "it": "італійська", "pl": "польська", "cs": "чеська"}


def split_variants(s: str) -> list[str]:
    # «Polaris (Polárka)» → ["Polaris", "Polárka"]; «A / B» → ["A", "B"]
    parts = re.split(r"\s*[()/;]\s*", s)
    return [p.strip() for p in parts if p.strip()]


def main(index: str, out: str, *pairs: str) -> None:
    idx = json.load(open(index, encoding="utf-8"))
    wanted = set()
    for v in (idx.get("common_names") or {}).values():
        for nm in v:
            en = nm.get("english") or nm.get("native")
            if en:
                wanted.add(en)
    stars: dict[str, dict[str, list[str]]] = {}
    for pair in pairs:
        lang, path = pair.split("=", 1)
        for e in polib.pofile(path):
            if e.obsolete or not e.msgstr or e.msgid not in wanted:
                continue
            names = [n for n in split_variants(e.msgstr) if n.lower() != e.msgid.lower()]
            if names:
                stars.setdefault(e.msgid, {})[lang] = names
    langs = {p.split("=")[0]: LANGS.get(p.split("=")[0], p.split("=")[0]) for p in pairs}
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"languages": langs, "stars": stars}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(stars)} зір із перекладами")


if __name__ == "__main__":
    main(*sys.argv[1:])
