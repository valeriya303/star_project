import csv
import io
import os
import sys
import tempfile
from pathlib import Path

import pytest

TMP = Path(tempfile.mkdtemp(prefix="star-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(TMP / "storage")
os.environ["SEED_DEMO_USERS"] = "1"
os.environ["DEMO_PASSWORD"] = "Test-pass-123"
os.environ["REWARD_DAILY_LIMIT"] = "2"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
FULL_CSV = ROOT / "data" / "hipparcos-voidmain.csv"
KEEP = {32349, 27989, 24436, 25336, 25930, 26311, 26727, 27366, 11767, 91262, 69673, 87937}


def make_subset() -> Path:
    out = TMP / "subset.csv"
    with open(FULL_CSV, newline="") as f, open(out, "w", newline="") as g:
        r = csv.reader(f)
        w = csv.writer(g)
        header = next(r)
        w.writerow(header)
        hip_i = header.index("HIP")
        for i, row in enumerate(r):
            if i < 2000 or int(row[hip_i]) in KEEP:
                w.writerow(row)
    return out


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.db import SessionLocal, init_db
    from app.main import app
    from app.seed import import_catalog_file, import_sky_bundle

    init_db()
    from app.seed import bootstrap

    bootstrap()  # тексти згод, користувачі, лінії сузір'їв
    db = SessionLocal()
    import_catalog_file(db, make_subset())
    import_sky_bundle(db)  # повторно — щоб звірити HIP і призначити сузір'я
    db.close()
    with TestClient(app) as c:
        yield c


def login(client, email):
    r = client.post("/api/auth/login", json={"email": email, "password": "Test-pass-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="session")
def obs(client):
    return login(client, "observer@star.test")


@pytest.fixture(scope="session")
def obs2(client):
    return login(client, "observer2@star.test")


@pytest.fixture(scope="session")
def mod(client):
    return login(client, "moderator@star.test")


@pytest.fixture(scope="session")
def mod2(client):
    return login(client, "moderator2@star.test")


@pytest.fixture(scope="session")
def admin(client):
    return login(client, "admin@star.test")


def jpeg(w=1000, h=700, gps=False) -> bytes:
    from PIL import Image

    im = Image.new("RGB", (w, h), (10, 10, 40))
    exif = Image.Exif()
    exif[0x010F] = "TestCam"
    if gps:
        exif[0x8825] = {1: "N", 2: (49.0, 50.0, 0.0), 3: "E", 4: (24.0, 1.0, 0.0)}
    buf = io.BytesIO()
    im.save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()
