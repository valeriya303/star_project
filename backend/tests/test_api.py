import json
from datetime import date, timedelta

from conftest import jpeg, login

TODAY = date.today().isoformat()
TOMORROW = (date.today() + timedelta(days=2)).isoformat()


# ---------------------------------------------------------------- UC-01
def test_register_login_and_errors(client):
    r = client.post("/api/auth/register", json={"email": "new@star.test", "password": "longpassword"})
    assert r.status_code == 201
    assert "token" not in r.json()  # крок 9: після реєстрації — форма входу
    assert client.post("/api/auth/register", json={"email": "new@star.test", "password": "longpassword"}).status_code == 409
    r = client.post("/api/auth/register", json={"email": "bad", "password": "short"})
    assert r.status_code == 422 and {e["field"] for e in r.json()["errors"]} == {"email", "password"}
    r = client.post("/api/auth/login", json={"email": "new@star.test", "password": "wrong-password"})
    assert r.status_code == 401 and r.json()["message"] == "Неправильний email або пароль"
    h = login_pwd(client, "new@star.test", "longpassword")
    assert client.get("/api/auth/me", headers=h).json()["role"] == "OBSERVER"
    assert client.post("/api/auth/logout", headers=h).status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401  # сесію відкликано


def login_pwd(client, email, pwd):
    r = client.post("/api/auth/login", json={"email": email, "password": pwd})
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---------------------------------------------------------------- RBAC / ABAC
def test_rbac(client, obs, mod, admin):
    assert client.get("/api/lists").status_code == 401  # AP-07
    assert client.get("/api/lists", headers=admin).status_code == 403  # DG Admin ❌ особисті списки
    assert client.get("/api/admin/audit", headers=obs).status_code == 403
    assert client.get("/api/admin/audit", headers=mod).status_code == 403  # AP-05
    assert client.get("/api/moderation/queue", headers=obs).status_code == 403
    r = client.get("/api/admin/users", headers=admin).json()
    me = next(u for u in r if u["email"] == "admin@star.test")
    assert client.patch(f"/api/admin/users/{me['id']}/role", json={"role": "OBSERVER"}, headers=admin).status_code == 403


# ---------------------------------------------------------------- каталог
def test_catalog_and_search(client):
    c = client.get("/api/stars/compact?vmag_max=6.5").json()
    assert c["count"] > 100 and c["columns"]["vmag"] == sorted(c["columns"]["vmag"])
    card = client.get("/api/stars/32349").json()
    assert card["name"] == "Сіріус" and card["constellation"] == "CMa"
    assert card["lineage"]["license"] == "CC0: Public Domain"
    assert client.get("/api/stars/32349/lineage").json()["batch_id"].startswith("IMP-")
    assert client.get("/api/stars/999999").status_code == 404
    assert client.get("/api/stars/search?q=бетель").json()["items"][0]["hip"] == 27989
    assert client.get("/api/stars/search?q=Betelgeuse").json()["items"][0]["hip"] == 27989
    # Кілька мов, транслітерація й помилкова розкладка
    assert client.get("/api/stars/search?q=betelgeuze").json()["items"][0]["hip"] == 27989
    assert client.get("/api/stars/search?q=Bételgeuse").json()["items"][0]["hip"] == 27989
    assert client.get("/api/stars/search?q=,tntkmutqpt").json()["items"][0]["hip"] == 27989
    syr = client.get("/api/stars/search?q=Syriusz").json()["items"]
    assert syr and syr[0]["hip"] == 32349 and syr[0]["matched_lang"] == "pl"
    assert client.get("/api/stars/search?q=HIP 24436").json()["items"][0]["name"] == "Рігель"
    assert client.get("/api/stars/by-id?catalog=HD&id=48915").json()["items"][0]["hip"] == 32349
    cone = client.get("/api/stars/cone?ra=101.29&dec=-16.72&radius=1").json()["items"]
    assert cone[0]["hip"] == 32349 and cone[0]["distance_deg"] < 0.05
    assert client.get("/api/stars/cone?ra=400&dec=0&radius=0").status_code == 422
    cons = client.get("/api/constellations").json()
    assert len(cons) == 88
    ori = client.get("/api/constellations/Ori").json()
    assert ori["name"] == "Оріон" and "Бетельгейзе" in ori["description"]


def test_filters(client):
    r = client.get("/api/stars?vmag_max=2&dist_max_ly=100").json()
    assert r["count"] >= 1 and all(s["vmag"] <= 2 for s in r["items"])
    assert r["excluded_no_distance"] >= 0
    assert client.get("/api/stars?vmag_min=5&vmag_max=2").status_code == 422  # EX3
    assert client.get("/api/stars?classes=X").status_code == 422


# ---------------------------------------------------------------- UC-07 / UC-08
def test_visibility(client, obs):
    body = {"hip": 11767, "date": TODAY, "time": "22:00", "timezone": "Europe/Kyiv", "location_source": "lviv"}
    v = client.post("/api/astro/visibility", json=body).json()
    assert v["case"] == "circumpolar" and abs(v["altitude"] - 49.8) < 2  # Полярна
    v = client.post("/api/astro/visibility", json={**body, "hip": 32349}).json()
    assert v["case"] == "normal" and v["rise"] and v["set"]
    # AC2 з геолокацією: без згоди C-01 — відмова, ручне місце — дозволено
    dev = {**body, "location_source": "device", "latitude": 50.45, "longitude": 30.52}
    assert client.post("/api/astro/visibility", json=dev, headers=obs).status_code == 403
    assert client.post("/api/astro/visibility", json=dev).status_code == 403
    assert client.post("/api/astro/visibility", json={**dev, "guest_consent": True}).status_code == 200
    man = {**dev, "location_source": "manual", "latitude": 95}
    assert client.post("/api/astro/visibility", json=man).status_code == 422
    # Неіснуючий і неоднозначний місцевий час (переходи 2026 р.)
    r = client.post("/api/astro/visibility", json={**body, "date": "2026-03-29", "time": "03:30"})
    assert r.json()["code"] == "NONEXISTENT_LOCAL_TIME"
    r = client.post("/api/astro/visibility", json={**body, "date": "2026-10-25", "time": "03:30"})
    assert r.json()["code"] == "AMBIGUOUS_LOCAL_TIME"
    r = client.post("/api/astro/visibility", json={**body, "date": "2026-10-25", "time": "03:30", "fold": 1})
    assert r.status_code == 200


# ---------------------------------------------------------------- UC-13
def test_consents(client, obs):
    texts = client.get("/api/consents/texts").json()
    assert [t["code"] for t in texts] == ["C-01", "C-02", "C-03", "C-04"]
    st = client.get("/api/consents", headers=obs).json()
    assert all(v is None for v in st["current"].values())  # жодна згода не надається автоматично
    assert client.post("/api/consents", json={"consent_code": "C-01", "consent_version": "0.9"}, headers=obs).status_code == 422
    assert client.post("/api/consents", json={"consent_code": "C-01", "consent_version": "1.0"}, headers=obs).status_code == 201
    body = {"hip": 32349, "date": TODAY, "time": "22:00", "location_source": "device", "latitude": 50, "longitude": 30}
    assert client.post("/api/astro/visibility", json=body, headers=obs).status_code == 200
    client.post("/api/consents/revoke", json={"consent_code": "C-01"}, headers=obs)
    assert client.post("/api/astro/visibility", json=body, headers=obs).status_code == 403
    hist = client.get("/api/consents", headers=obs).json()["history"]
    assert hist[0]["status"] == "revoked" and hist[0]["revoked_at"]


# ---------------------------------------------------------------- UC-06
def test_lists(client, obs, obs2):
    lists = client.get("/api/lists", headers=obs).json()
    fav = next(x for x in lists if x["is_favorites"])
    assert client.put(f"/api/lists/{fav['id']}/stars/32349", headers=obs).status_code == 201
    assert client.put(f"/api/lists/{fav['id']}/stars/32349", headers=obs).json()["message"] == "Зоря вже є у цьому списку"
    assert client.post("/api/lists", json={"name": "   "}, headers=obs).status_code == 422
    new = client.post("/api/lists", json={"name": "Мої цілі на вихідні"}, headers=obs).json()
    assert client.patch(f"/api/lists/{new['id']}", json={"name": "Нова назва"}, headers=obs).json()["name"] == "Нова назва"
    assert client.get(f"/api/lists/{new['id']}", headers=obs2).status_code == 403  # чужий список
    assert client.delete(f"/api/lists/{new['id']}", headers=obs).status_code == 204
    assert client.delete(f"/api/lists/{fav['id']}", headers=obs).status_code == 409


# ---------------------------------------------------------------- UC-09
def test_journal(client, obs, obs2):
    e = {"observation_id": "obs-1", "star_id": 32349, "observed_at": TODAY, "brightness_rating": 4,
         "conditions_rating": 5, "note": "Яскрава"}
    assert client.post("/api/journal", json=e, headers=obs).status_code == 201
    bad = {**e, "observation_id": "obs-2", "brightness_rating": 6, "observed_at": TOMORROW, "star_id": 1234567}
    r = client.post("/api/journal", json=bad, headers={**obs, "X-Timezone": "Europe/Kyiv"})
    rules = {x["rule_id"] for x in r.json()["errors"]}
    assert r.status_code == 422 and {"QR-22", "QR-20", "QR-21"} <= rules
    assert client.post("/api/journal", json={**e, "observation_id": "o3", "extra": 1}, headers=obs).status_code == 422
    assert client.get("/api/journal/obs-1", headers=obs2).status_code == 403
    assert client.get("/api/public/journals/" + me_id(client, obs)).status_code == 403  # приватний за замовчуванням
    client.post("/api/consents", json={"consent_code": "C-04", "consent_version": "1.0"}, headers=obs)
    assert client.get("/api/public/journals/" + me_id(client, obs)).status_code == 200
    client.post("/api/consents/revoke", json={"consent_code": "C-04"}, headers=obs)
    assert client.get("/api/public/journals/" + me_id(client, obs)).status_code == 403


def me_id(client, h):
    return client.get("/api/auth/me", headers=h).json()["id"]


# ---------------------------------------------------------------- UC-10…UC-12, UC-21…UC-24
META = {"title": "Оріон над Карпатами", "constellation": "Orion", "date_taken": TODAY, "author": "Валерія",
        "license": "CC-BY-4.0", "rights_confirmed": True}


def upload(client, h, data, meta=META):
    return client.post("/api/photos", headers=h, files={"file": ("orion.jpg", data, "image/jpeg")},
                       data={"metadata": json.dumps(meta)})


def test_photo_quality_rules(client, obs):
    r = upload(client, obs, b"not an image at all")
    assert r.status_code == 422 and r.json()["errors"][0]["rule_id"] == "QR-12"
    r = upload(client, obs, jpeg(640, 480))
    assert "QR-14" in {e["rule_id"] for e in r.json()["errors"]}
    r = upload(client, obs, jpeg(), {**META, "constellation": "Orionus", "license": "MIT", "rights_confirmed": False})
    assert {"QR-15", "QR-18", "QR-19"} <= {e["rule_id"] for e in r.json()["errors"]}
    r = upload(client, obs, jpeg(), {**META, "date_taken": TOMORROW})
    assert "QR-16" in {e["rule_id"] for e in r.json()["errors"]}


def test_photo_flow(client, obs, mod, mod2):
    from PIL import Image
    import io

    p = upload(client, obs, jpeg(gps=True)).json()
    assert p["status"] == "internal" and p["gps_removed"] is True and not p["is_public"]
    raw = client.get(p["full_url"]).content
    assert not Image.open(io.BytesIO(raw)).getexif().get_ifd(0x8825)  # GPS видалено (без C-03)
    # Приватний знімок недоступний без підпису
    assert client.get(f"/api/files/photo/{p['id']}/full").status_code == 403
    # Подання без згоди C-02 — відмова (UC-10 EX2)
    r = client.post(f"/api/photos/{p['id']}/submit", headers=obs)
    assert r.status_code == 403 and r.json()["code"] == "CONSENT_REQUIRED"
    client.post("/api/consents", json={"consent_code": "C-02", "consent_version": "1.0", "related_object_id": p["id"]}, headers=obs)
    p = client.post(f"/api/photos/{p['id']}/submit", headers=obs, json={"anonymous": True, "license": "CC0-1.0"}).json()
    assert p["status"] == "submitted" and p["author"] == "Анонімний спостерігач"
    q = client.get("/api/moderation/queue", headers=mod).json()
    assert any(x["id"] == p["id"] for x in q)
    # Зміна версії → EX3
    assert client.post(f"/api/moderation/photos/{p['id']}/approve", json={"version": 99}, headers=mod).status_code == 409
    res = client.post(f"/api/moderation/photos/{p['id']}/approve", json={"version": p["version"]}, headers=mod).json()
    assert res["published"] is True and res["reward"]["points"] == 50
    assert client.get(f"/api/files/photo/{p['id']}/thumb").status_code == 200
    assert any(g["id"] == p["id"] for g in client.get("/api/gallery").json())
    # Повторна обробка того самого рішення не нараховує бали двічі (AC2)
    from app.db import SessionLocal
    from app.photo_service import process_reward

    db = SessionLocal()
    again = process_reward(db, res["decision_id"])
    db.close()
    assert again["id"] == res["reward"]["id"]
    assert client.get("/api/me/rewards", headers=obs).json()["points"] == 50
    # Відкликання C-02 приховує знімок (UC-13 EX1)
    client.post("/api/consents/revoke", json={"consent_code": "C-02", "related_object_id": p["id"]}, headers=obs)
    assert client.get(f"/api/files/photo/{p['id']}/thumb").status_code == 403
    assert not any(g["id"] == p["id"] for g in client.get("/api/gallery").json())
    assert client.post(f"/api/photos/{p['id']}/republish", headers=obs).status_code == 403
    client.post("/api/consents", json={"consent_code": "C-02", "consent_version": "1.0", "related_object_id": p["id"]}, headers=obs)
    assert client.post(f"/api/photos/{p['id']}/republish", headers=obs).json()["is_public"] is True
    assert client.get("/api/me/rewards", headers=obs).json()["points"] == 50  # без нового нарахування


def test_self_moderation_and_limit(client, mod, mod2):
    def submit_own(h):
        p = upload(client, h, jpeg()).json()
        client.post("/api/consents", json={"consent_code": "C-02", "consent_version": "1.0", "related_object_id": p["id"]}, headers=h)
        return client.post(f"/api/photos/{p['id']}/submit", headers=h).json()

    p = submit_own(mod)
    r = client.post(f"/api/moderation/photos/{p['id']}/approve", json={"version": p["version"]}, headers=mod)
    assert r.status_code == 403 and r.json()["code"] == "SELF_MODERATION"  # AP-02
    rewards = []
    for _ in range(2):
        q = submit_own(mod)
        rewards.append(client.post(f"/api/moderation/photos/{q['id']}/approve", json={"version": q["version"]}, headers=mod2).json()["reward"])
    rewards.append(client.post(f"/api/moderation/photos/{p['id']}/approve", json={"version": p["version"]}, headers=mod2).json()["reward"])
    assert [r["status"] for r in rewards] == ["credited", "credited", "limit_reached"]  # денний ліміт = 2
    r = client.post(f"/api/moderation/photos/{p['id']}/reject", json={"version": p["version"], "reason": "x"}, headers=mod2)
    assert r.status_code == 409  # уже опрацьовано


# ---------------------------------------------------------------- UC-14, UC-15, DG-7
def test_import_and_audit(client, admin):
    bad = "HIP,RAdeg,DEdeg,Vmag\n1,10,95,5\n2,10,10,5\n2,11,11,6\n3,,10,4\n4,370,10,1\n"
    r = client.post("/api/admin/catalog/imports", headers=admin, files={"file": ("t.csv", bad.encode(), "text/csv")},
                    data={"profile": "hipparcos", "source": "Test", "source_url": "https://example.org", "source_version": "x"})
    rep = r.json()["report"]
    assert rep["total_records"] == 5 and rep["rejected"] == 5
    assert set(rep["violations"]) == {"QR-02", "QR-03", "QR-04", "QR-08"}
    assert rep["import_warnings"][0]["rule_id"] == "QR-11"
    assert client.post(f"/api/admin/catalog/versions/{r.json()['id']}/confirm", headers=admin).status_code == 409
    assert client.post(f"/api/admin/catalog/versions/{r.json()['id']}/cancel", headers=admin).json()["status"] == "cancelled"
    r = client.post("/api/admin/catalog/imports", headers=admin, files={"file": ("t.csv", b"a,b\n1,2\n", "text/csv")},
                    data={"profile": "hipparcos", "source": "T", "source_url": "u", "source_version": "v"})
    assert r.status_code == 422 and r.json()["code"] == "QR-02"
    r = client.post("/api/admin/catalog/imports", headers=admin, files={"file": ("t.csv", bad.encode(), "text/csv")},
                    data={"profile": "hipparcos", "source": "T", "source_url": "u"})
    assert r.json()["code"] == "METADATA_INCOMPLETE"
    a = client.get("/api/admin/audit?event_code=AUD-09", headers=admin).json()
    assert a["total"] >= 5 and all("email" not in json.dumps(i) for i in a["items"])
    assert client.get("/api/admin/audit?date_from=2026-12-01&date_to=2026-01-01", headers=admin).status_code == 422
    assert client.get("/api/admin/audit/verify", headers=admin).json()["valid"] is True
    res = client.post("/api/admin/retention/run", headers=admin, json={
        "operations": ["pending_photos", "rejected_photos", "audit", "catalog", "geolocation"], "dry_run": True,
        "as_of": "2030-01-01T00:00:00Z"}).json()
    assert res["dry_run"] and res["results"]["audit"]["affected"] > 0


def test_account_deletion(client, admin):
    client.post("/api/auth/register", json={"email": "gone@star.test", "password": "longpassword"})
    h = login_pwd(client, "gone@star.test", "longpassword")
    uid = me_id(client, h)
    client.post("/api/journal", json={"observation_id": "gone-1", "star_id": 32349, "observed_at": TODAY,
                                      "brightness_rating": 3, "conditions_rating": 3, "note": "приватне"}, headers=h)
    r = client.request("DELETE", "/api/me", headers=h, json={"mode": "anonymize", "confirm_email": "gone@star.test"})
    assert r.status_code == 200 and [s["step"] for s in r.json()["steps"]] == list(range(1, 10))
    assert client.get("/api/auth/me", headers=h).status_code == 401
    a = client.get(f"/api/admin/audit?actor_id={uid}", headers=admin).json()
    assert a["total"] == 0  # ідентифікатор знеособлено
    from app.db import SessionLocal
    from app.models import JournalEntry

    db = SessionLocal()
    e = db.get(JournalEntry, "gone-1")
    assert e.user_id is None and e.note == "" and e.anonymized
    db.close()
    assert client.get("/api/admin/audit/verify", headers=admin).json()["valid"] is True


def test_community_people(client, obs, obs2):
    # Спостерігач видимий лише після оприлюднення (тут — згода C-04); знаходиться за ім'ям будь-якою абеткою
    client.patch("/api/me/profile", headers=obs2, json={"name": "Андрій Мельник"})
    client.post("/api/consents/revoke", json={"consent_code": "C-04"}, headers=obs2)
    assert not client.get("/api/community/people", params={"q": "Мельник"}).json()["items"]
    client.post("/api/consents", json={"consent_code": "C-04", "consent_version": "1.0"}, headers=obs2)
    found = client.get("/api/community/people", params={"q": "andrii melnyk"}).json()["items"]
    assert [i["name"] for i in found] == ["Андрій Мельник"]
    prof = client.get(f"/api/community/people/{found[0]['id']}").json()
    assert prof["journal"] is not None and "email" not in prof and "city" not in prof
    assert client.get("/api/community/people/unknown").status_code == 404
