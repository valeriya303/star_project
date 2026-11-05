# Документація даних

* `schemas/constellation-image-metadata.schema.json` — JSON Schema метаданих знімка (DG-5, додаток А).
* `schemas/observation-journal-entry.schema.json` — JSON Schema запису журналу (DG-5, додаток Б).

Сервер використовує ці файли напряму (`app/quality/user_data.py`), тому зміна схеми одразу змінює валідацію.
Перевірки дати в майбутньому, наявності зорі в каталозі та фактичних формату й роздільної здатності файлу
виконує серверна логіка (QR-12, QR-14, QR-16, QR-20, QR-21).
