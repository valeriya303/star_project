"""Star — інтерактивний локатор та навігатор зоряних каталогів. REST API (FastAPI)."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import errors
from .config import settings
from .db import init_db
from .routers import admin, auth, community, journal, lists, me, photos, sky, stars
from .seed import bootstrap


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    bootstrap()
    yield


app = FastAPI(
    title="Star API",
    version="1.0.0",
    description="API-шлюз системи «Інтерактивний локатор та навігатор зоряних каталогів». "
    "Права доступу, згоди та якість даних перевіряються на сервері (AD-03).",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Timezone"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    if request.url.path.startswith("/api/") and "cache-control" not in resp.headers:
        resp.headers["Cache-Control"] = "no-store"
    return resp


errors.install(app)

api = APIRouter(prefix="/api")
for r in (auth.router, stars.router, sky.router, lists.router, journal.router, photos.router, community.router, me.router,
          admin.router):
    api.include_router(r)


@api.get("/health")
def health():
    return {"status": "ok"}


app.include_router(api)


# ------------------------------------------------------------ сайт (React SPA) з того самого сервера
_static = Path(settings.static_dir)
if (_static / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        f = (_static / path).resolve()
        if path and f.is_file() and _static.resolve() in f.parents:
            return FileResponse(f)
        # маршрути React Router (/map, /community, …) віддають index.html
        return FileResponse(_static / "index.html", headers={"Cache-Control": "no-cache"})
