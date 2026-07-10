# Истоки Нейвары

Оригинальная браузерная 3D MMORPG в духе классических target-based fantasy MMO. Проект использует собственный мир, персонажей, тексты, интерфейс, модели и графические ресурсы; материалы Lineage 2 не входят в репозиторий и не требуются для запуска.

> **Статус 0.3.0:** production-oriented vertical slice и публичный технический preview. Это играбельная основа с production-практиками, но не полноценная production MMO и не AAA-игра.

## Vertical slice 0.3.0

- пять рас: люди, светлые эльфы, тёмные эльфы, гномы и орки;
- мужской и женский варианты, классы Воин и Маг — 20 игровых 3D-вариантов `5 × 2 × 2`;
- интерактивный 3D-preview выбранного персонажа до его создания;
- skinned GLB-модели с оригинальными встроенными текстурами и базовыми боевыми анимациями;
- стартовая зона `dawnmere_crossing` — «Переправа Донмер» — с поселением, мостом, рекой, руинами, пещерой и PvP-кругом;
- шесть оригинальных видов существ: терновый рыскач, мшистый громила, пещерный крикун, страж руин, ежевичный вепрь и пепельный дрейк;
- регистрация, персонажи, realtime-мир, authoritative PvE/PvP, опыт, добыча и стартовый квест;
- оригинальные SVG-иконки умений и Babylon-эффекты cast/projectile/impact/aura с поддержкой reduced motion;
- 34 оригинальных предмета, 13 слотов, paper-doll, расходники и улучшение;
- PostgreSQL persistence, economy ledger, retry-safe транзакции, readiness, CI и deployment-конфигурация.

Модели и окружение проходят автоматическую GLB-проверку, однако художественная ретопология, LOD, массовая кастомизация внешности и ручная AAA-полировка остаются следующими art gates.

## Что ещё не делает проект полноценной MMO

В 0.3.0 нет требуемой для коммерческого MMO ширины контента и эксплуатации: party/friends/trade/guild, подземелий и рейдов, большого набора квестов и умений, AOI/zone workers, длительного массового soak-теста, полного moderation/live-ops контура и финальной ручной полировки всех ассетов. Проверяемые критерии перечислены в [production readiness](docs/PRODUCTION_READINESS.md).

## Локальный запуск

Требования: Node.js 22+, npm 10+, Docker для постоянной PostgreSQL. Для быстрого локального запуска сервер поддерживает memory-режим.

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run dev
```

В разработке Vite-клиент работает на `http://localhost:5173`, API — на `http://localhost:3001`. Без Docker задайте `STORAGE_MODE=memory` и удалите `DATABASE_URL`. Production-сборка объединяет клиент, API и Socket.IO на одном Railway origin.

## Проверки

```bash
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run assets:check:3d
npm run build
```

Для multiplayer smoke-теста нужен запущенный сервер:

```bash
npm run smoke
API_URL=https://authentic-expression-production-bdc5.up.railway.app npm run smoke
```

## Деплой

- Корневой `Dockerfile` собирает Vite-клиент и сервер; Fastify раздаёт UI, API и Socket.IO с одного Railway URL.
- Railway должен иметь PostgreSQL и серверные переменные из `.env.example`; `RAILWAY_PUBLIC_DOMAIN` автоматически добавляется в разрешённые origin.
- `VITE_API_URL` в production не задаётся: клиент использует `window.location.origin`. Переменная остаётся только для отдельного API в нестандартных окружениях.
- `.github/workflows/ci.yml` выполняет verify и production Docker build. GitHub Pages больше не используется.
- Railway GitHub integration должна деплоить `main` только после успешного `CI / verify`; readiness path — `/readyz`.

Единая production-точка: [authentic-expression-production-bdc5.up.railway.app](https://authentic-expression-production-bdc5.up.railway.app/).

Документация: [план](docs/PROJECT_PLAN.md), [release 0.3.0](docs/releases/0.3.0.md), [production gates](docs/PRODUCTION_READINESS.md), [архитектура](docs/ARCHITECTURE.md), [operations runbook](docs/OPERATIONS.md), [дизайн мира](docs/GAME_DESIGN.md), [3D pipeline](docs/art/3D_ASSET_PIPELINE.md), [art direction](docs/art/ART_DIRECTION.md) и [политика оригинальности](docs/ORIGINALITY_POLICY.md).
