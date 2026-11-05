# Продакшн-образ для хостингу (Render): один контейнер віддає і сайт (React), і API (FastAPI).
# Локальна схема з окремими PostgreSQL + MinIO + nginx — у docker-compose.yml.

# ---------- 1. Збирання фронтенду ----------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- 2. Сервер застосунку ----------
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STATIC_DIR=/app/static \
    AUTO_IMPORT_CSV=/app/data/hipparcos-voidmain.csv \
    STORAGE_BACKEND=db
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist ./static

EXPOSE 8000
# Спершу (окремим процесом, щоб звільнити пам'ять) — таблиці, імпорт каталогу й демо-дані; далі — сервер
CMD ["sh", "-c", "python -m app.cli deploy-init && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
