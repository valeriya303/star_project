"""Єдиний формат помилок API (DG-5 §4, DG-2 §4)."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str | None = None, extra: dict | None = None):
        self.status = status
        self.message = message
        self.code = code
        self.extra = extra or {}


class ValidationFailed(Exception):
    """HTTP 422 Unprocessable Content з переліком порушених правил якості."""

    def __init__(self, errors: list[dict]):
        self.errors = errors


def vf(rule_id: str | None, field: str | None, message: str) -> dict:
    return {"rule_id": rule_id, "field": field, "message": message}


def unauthorized(message: str = "Потрібна автентифікація") -> ApiError:
    return ApiError(401, message, "UNAUTHENTICATED")


def forbidden(message: str = "Доступ заборонено", code: str = "INSUFFICIENT_PERMISSIONS") -> ApiError:
    return ApiError(403, message, code)


def not_found(message: str = "Не знайдено") -> ApiError:
    return ApiError(404, message, "NOT_FOUND")


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(
            {"status": exc.status, "message": exc.message, "code": exc.code, **exc.extra},
            status_code=exc.status,
        )

    @app.exception_handler(ValidationFailed)
    async def _validation(_: Request, exc: ValidationFailed):
        return JSONResponse(
            {"status": 422, "message": "Помилка валідації даних", "errors": exc.errors},
            status_code=422,
        )

    @app.exception_handler(RequestValidationError)
    async def _req_validation(_: Request, exc: RequestValidationError):
        errors = []
        for e in exc.errors():
            loc = [str(p) for p in e.get("loc", []) if p not in ("body", "query", "path")]
            errors.append(vf(None, ".".join(loc) or None, e.get("msg", "Некоректне значення")))
        return JSONResponse(
            {"status": 422, "message": "Помилка валідації даних", "errors": errors},
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        return JSONResponse(
            {"status": exc.status_code, "message": str(exc.detail)}, status_code=exc.status_code
        )
