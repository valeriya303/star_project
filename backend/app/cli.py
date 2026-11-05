"""CLI імпорту каталогу уповноваженою особою (AR-1, діаграма розгортання «CLI імпорту»).

Приклади:
    python -m app.cli import-catalog data/hipparcos-voidmain.csv --profile hipparcos --confirm
    python -m app.cli import-sky data/stellarium/index.json --version stellarium-2026-11
    python -m app.cli retention --ops pending_photos rejected_photos --apply
    python -m app.cli seed-demo
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from . import importer, retention
from .db import SessionLocal, init_db
from .seed import CLI, bootstrap, import_catalog_file


def main() -> None:
    ap = argparse.ArgumentParser(prog="star-cli")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("import-catalog", help="UC-14: імпорт CSV зоряного каталогу")
    c.add_argument("csv", type=Path)
    c.add_argument("--profile", default="hipparcos", choices=["hipparcos", "hyg"])
    c.add_argument("--source", default="")
    c.add_argument("--source-url", default="")
    c.add_argument("--origin", default="")
    c.add_argument("--source-version", default="")
    c.add_argument("--license", default="")
    c.add_argument("--confirm", action="store_true", help="одразу активувати версію після перевірки")

    s = sub.add_parser("import-sky", help="UC-18: імпорт index.json Stellarium")
    s.add_argument("json", type=Path)
    s.add_argument("--version", required=True)
    s.add_argument("--confirm", action="store_true")

    r = sub.add_parser("retention", help="DG-7: очищення даних")
    r.add_argument("--ops", nargs="+", default=list(retention.OPERATIONS))
    r.add_argument("--apply", action="store_true", help="без цього прапорця — лише перегляд (dry run)")

    sub.add_parser("bootstrap", help="тексти згод, тестові облікові записи, лінії сузір'їв")
    sub.add_parser("seed-demo", help="демонстраційні дані для захисту: списки, журнали, знімки, модерація")
    sub.add_parser("deploy-init", help="перед стартом сервера: таблиці, каталог, сузір'я, (за SEED_DEMO=1) демо-дані")

    a = ap.parse_args()
    init_db()
    db = SessionLocal()
    try:
        if a.cmd == "import-catalog":
            v = import_catalog_file(db, a.csv, a.profile, a.confirm, source=a.source, source_url=a.source_url,
                                    origin=a.origin, source_version=a.source_version, license=a.license)
            rep = {k: v.report[k] for k in ("report_id", "total_records", "accepted", "accepted_with_warnings",
                                            "rejected", "violations", "status", "duration_seconds")}
            print(json.dumps(rep, ensure_ascii=False, indent=2))
            print("Статус версії:", db.get(type(v), v.id).status)
        elif a.cmd == "import-sky":
            v = importer.stage_constellations(db, CLI, a.json.read_bytes(), a.json.name, {"source_version": a.version})
            if a.confirm:
                importer.confirm_constellations(db, CLI, v.id)
            print(json.dumps(v.report, ensure_ascii=False, indent=2)[:2000])
        elif a.cmd == "retention":
            res = retention.run(db, CLI, datetime.now(timezone.utc), a.ops, not a.apply)
            print(json.dumps(res, ensure_ascii=False, indent=2))
        elif a.cmd == "bootstrap":
            bootstrap()
        elif a.cmd == "deploy-init":
            import os

            bootstrap()  # тексти згод, тестові акаунти, первинний імпорт каталогу (AUTO_IMPORT_CSV) і сузір'їв
            if os.environ.get("SEED_DEMO", "0") == "1":
                from .demo import seed_demo

                print(json.dumps(seed_demo(), ensure_ascii=False))
            print("[deploy-init] готово")
        elif a.cmd == "seed-demo":
            from .demo import seed_demo

            bootstrap()
            print(json.dumps(seed_demo(), ensure_ascii=False, indent=2))
    finally:
        db.close()


if __name__ == "__main__":
    main()
