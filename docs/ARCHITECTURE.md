# Архитектура

```text
Railway: единый HTTPS origin
  Fastify
    ├── Vite + React HUD + Babylon.js (static + SPA fallback)
    ├── /v1 + auth
    ├── /socket.io (authoritative realtime world)
    └── /healthz + /readyz
      │
      ▼
PostgreSQL
  accounts / characters / item instances / equipment / economy ledger / quests
```

## Почему модульный монолит

Для одной зоны и десятков игроков один процесс проще тестировать и развёртывать. Декомпозиция на gateway и zone workers нужна только после измеренной нагрузки. Границы модулей уже отделяют auth, persistence, world simulation, combat и content.

Production Docker image собирает клиент и сервер вместе. HTML и manifest не кешируются, fingerprinted Vite chunks отдаются с immutable cache, а стабильные GLB/texture paths перепроверяются через ETag; HTML и текстовые bundles сжимаются на origin, тогда как GLB исключены из повторного сжатия. SPA fallback применяется только к browser navigation и никогда не перехватывает API, health, readiness, assets или Socket.IO.

## Модель доверия

Клиент отправляет намерение: направление движения, выбранную цель, идентификатор умения или просьбу поднять добычу. Сервер проверяет скорость, границы мира, дальность, cooldown, ресурсы, состояние цели и PvP-правила. Итоговые координаты, урон, XP, предметы и квестовый прогресс создаёт только сервер.

## Частоты

- simulation: фиксированный tick 20 Hz;
- snapshots: 10 Hz;
- AI decisions: 4 Hz с движением на основном tick;
- client render: частота экрана, remote interpolation;
- persistence: критические операции сразу, позиция и vitals периодически и при disconnect.

## Протокол

Socket handshake содержит access token, characterId и `PROTOCOL_VERSION`. Каждая input-команда имеет monotonically increasing `seq`. Сервер возвращает `lastProcessedInput`, что позволяет позже добавить полноценные prediction/reconciliation без изменения сообщения.

## Данные

PostgreSQL — единственный долговечный источник истины. Экипировка хранится как уникальные item instances, а изменения валюты и предметов сопровождаются audit-friendly economy ledger. Redis добавляется в alpha для одноразовых игровых билетов, presence и pub/sub, но не хранит каноническую экономику. Статические предметы, способности, NPC и квесты версионируются в репозитории и валидируются общей схемой.

## Масштабирование

Когда одна зона перестанет помещаться в один процесс, каждый zone worker получает единственного authoritative owner. Gateway маршрутизирует соединение, Redis хранит ephemeral presence/leases, PostgreSQL — долговечное состояние. Межзонные переходы выполняются как подтверждённая передача владения персонажем.
