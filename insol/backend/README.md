# SunPlan3d — бэкенд

Лёгкий сервис на **Fastify + SQLite**: вход через Яндекс + хранение проектов пользователя. Один процесс, минимум ops. Хостится на российском VPS (152-ФЗ).

## API
- `GET /health` — проверка живости.
- `POST /auth/yandex` `{ token }` → `{ jwt, user }` — принимает OAuth-токен Яндекса (его получает фронт), проверяет, заводит/находит пользователя, отдаёт наш JWT.
- `GET /me` (Bearer) → профиль + тариф.
- `GET /projects` (Bearer) → список `{id,name,updated_at}`.
- `GET /projects/:id` (Bearer) → `{id,name,updated_at,data}`.
- `POST /projects` (Bearer) `{ name, data }` → `{ id }`.
- `PUT /projects/:id` (Bearer) `{ name?, data? }`.
- `DELETE /projects/:id` (Bearer).

`data` — JSON проекта из фронта (polyText, buildings, tz, fence… — как в `saveProject`, без date/minutes).

## Локальный запуск (dev)
```bash
cd backend
cp .env.example .env          # поправьте JWT_SECRET
npm install
npm start                     # http://localhost:8787/health
```

## Деплой на VPS (РФ)
1. Арендуйте VPS (Ubuntu 22, 2 vCPU / 2–4 ГБ). Пример: Timeweb Cloud / Selectel.
2. Установите Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Скопируйте папку `backend/` на сервер (git clone или scp).
4. Настройте `.env`:
   ```bash
   cp .env.example .env
   # JWT_SECRET=$(openssl rand -hex 32)
   # CORS_ORIGIN=https://<ваш-фронт>   (напр. https://methodform.github.io)
   ```
5. Пропишите домен API в `Caddyfile` (например `api.sunplan3d.ru`) и направьте на IP сервера A-запись в DNS.
6. Запуск:
   ```bash
   docker compose up -d --build
   ```
   Caddy сам получит SSL. Проверка: `https://api.sunplan3d.ru/health` → `{ "ok": true }`.

## Бэкапы
База — один файл `data/sunplan.db`. Cron с ежедневным копированием в объектное хранилище РФ:
```bash
0 3 * * * cp /path/backend/data/sunplan.db /backups/sunplan-$(date +\%F).db
```

## Тарифы (Pro)
Поле `users.plan` (`free`/`pro`). Пока проставляется вручную (`update users set plan='pro' where id=…`) или промокодом; позже — вебхук оплаты.

## Переезд на Postgres (когда вырастет нагрузка)
Заменить `better-sqlite3` на `pg`, схему перенести один-в-один (SQL совместим). Остальной код не меняется.
