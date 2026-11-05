"""Файлове сховище знімків (IFileStore): локальна тека, S3-сумісне MinIO або таблиця в БД.

Клієнт ніколи не отримує прямих адрес сховища: файли віддаються через
контрольований ендпоінт /api/files/..., який перевіряє права доступу
(UC-13 EX1 — блокування публічної копії за прямим посиланням).
"""
from __future__ import annotations

import hashlib
import hmac
import time
from pathlib import Path

from .config import settings


class LocalStore:
    def __init__(self, root: str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("bad key")
        return p

    def put(self, key: str, data: bytes, content_type: str) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        p = self._path(key)
        if p.exists():
            p.unlink()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()


class S3Store:  # pragma: no cover - потребує MinIO
    def __init__(self):
        import boto3

        self.bucket = settings.s3_bucket
        self.s3 = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
        )
        try:
            self.s3.head_bucket(Bucket=self.bucket)
        except Exception:
            self.s3.create_bucket(Bucket=self.bucket)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key: str) -> bytes:
        return self.s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False


class DbStore:
    """Файли в таблиці stored_files. Для безкоштовних хостингів, де диск контейнера очищується при перезапуску."""

    def _session(self):
        from .db import SessionLocal

        return SessionLocal()

    def put(self, key: str, data: bytes, content_type: str) -> None:
        from .models import StoredFile

        with self._session() as db:
            db.merge(StoredFile(key=key, data=data, content_type=content_type))
            db.commit()

    def get(self, key: str) -> bytes:
        from .models import StoredFile

        with self._session() as db:
            f = db.get(StoredFile, key)
            if not f:
                raise FileNotFoundError(key)
            return f.data

    def delete(self, key: str) -> None:
        from .models import StoredFile

        with self._session() as db:
            f = db.get(StoredFile, key)
            if f:
                db.delete(f)
                db.commit()

    def exists(self, key: str) -> bool:
        from sqlalchemy import select

        from .models import StoredFile

        with self._session() as db:
            return db.execute(select(StoredFile.key).where(StoredFile.key == key)).first() is not None


_store = None


def store():
    global _store
    if _store is None:
        if settings.storage_backend == "s3":
            _store = S3Store()
        elif settings.storage_backend == "db":
            _store = DbStore()
        else:
            _store = LocalStore(settings.storage_dir)
    return _store


# ---------------------------------------------- підписані короткострокові адреси
def sign(kind: str, obj_id: str, variant: str, viewer: str, ttl: int = 900) -> str:
    exp = int(time.time()) + ttl
    msg = f"{kind}:{obj_id}:{variant}:{viewer}:{exp}".encode()
    sig = hmac.new(settings.file_url_secret.encode(), msg, hashlib.sha256).hexdigest()[:32]
    return f"/api/files/{kind}/{obj_id}/{variant}?v={viewer}&exp={exp}&sig={sig}"


def check_sig(kind: str, obj_id: str, variant: str, viewer: str, exp: int, sig: str) -> bool:
    if exp < time.time():
        return False
    msg = f"{kind}:{obj_id}:{variant}:{viewer}:{exp}".encode()
    good = hmac.new(settings.file_url_secret.encode(), msg, hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(good, sig)
