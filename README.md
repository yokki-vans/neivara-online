# Истоки Нейвары

Оригинальная браузерная 3D MMORPG в духе классических target-based fantasy MMO. Проект использует собственный мир, персонажей, тексты, интерфейс и графические ресурсы; материалы Lineage 2 не входят в репозиторий и не требуются для запуска.

## Что уже заложено

- статический 3D-клиент для GitHub Pages;
- authoritative Node.js-сервер для Railway;
- PostgreSQL для аккаунтов и прогресса;
- общий versioned TypeScript-протокол;
- регистрация, персонажи, realtime-мир, PvE/PvP и оригинальный vertical slice;
- 34 оригинальных предмета, 13 слотов, paper-doll, расходники и улучшение;
- разные процедурные силуэты пяти народов, оружия и весовые классы брони;
- атомарные item transactions, PostgreSQL economy ledger и authoritative combat stats;
- собственные бесшовные ground/path textures и clean-room concept sheets;
- CI, тесты и deployment-конфигурация.

## Локальный запуск

Требования: Node.js 22+, npm 10+, Docker (для постоянной PostgreSQL; без БД сервер может работать в memory-режиме).

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run dev
```

Клиент: `http://localhost:5173`. API: `http://localhost:3001`. Для быстрого запуска без Docker задайте `STORAGE_MODE=memory` и удалите `DATABASE_URL`.

## Проверки

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
```

Для полного smoke-теста с двумя сетевыми клиентами нужен запущенный сервер:

```bash
npm run smoke
API_URL=https://authentic-expression-production-bdc5.up.railway.app npm run smoke
```

## Деплой

- Сервер собирается корневым `Dockerfile`; Railway использует `railway.toml` и dependency-aware `/readyz`.
- Добавьте Railway PostgreSQL и переменные из `.env.example`, затем сгенерируйте публичный домен сервиса.
- В GitHub задайте repository variable `VITE_API_URL` равной публичному HTTPS URL Railway.
- В Settings → Pages выберите GitHub Actions. После полного verify job workflow `.github/workflows/ci.yml` публикует `apps/client/dist`.
- В Railway задайте `CLIENT_ORIGINS=https://<owner>.github.io` (и custom domain, если он будет).

Текущий production API: [authentic-expression-production-bdc5.up.railway.app](https://authentic-expression-production-bdc5.up.railway.app/healthz).

Подробности: [план](docs/PROJECT_PLAN.md), [production gates](docs/PRODUCTION_READINESS.md), [архитектура](docs/ARCHITECTURE.md), [operations runbook](docs/OPERATIONS.md), [дизайн мира](docs/GAME_DESIGN.md), [art direction](docs/art/ART_DIRECTION.md) и [политика оригинальности](docs/ORIGINALITY_POLICY.md).
