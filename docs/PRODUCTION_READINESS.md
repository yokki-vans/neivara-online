# Production readiness

«Production» для MMORPG — это не только количество контента. Публичный релиз допускается после прохождения всех gates ниже.

## Реализуемый foundation

- server-authoritative movement/combat/rewards;
- PostgreSQL accounts, characters, item instances, equipment and quest state;
- versioned shared protocol and content catalog;
- reconnect-safe character ownership;
- inventory/equipment paper doll, consumables and enhancement transactions;
- per-character operation queue, mutation idempotency and economy audit trail;
- PostgreSQL migration integration gate, store readiness and locked migrations;
- protocol compatibility gate, asset provenance hashes and CI-generated SBOM;
- GitHub Pages + Railway autodeploy;
- local and production multiplayer smoke tests.

## Alpha gate

- 3 полностью отполированных класса, 4 способности на класс;
- 2 народа с production GLB-моделями и 3 наборами брони;
- уровни 1–6, 10 заданий, 6 противников, 2 элиты, босс и подземелье;
- party, duel, friends, moderation;
- 30 одновременных игроков, 2-hour soak, reconnect and duplication tests;
- backup restore и migration rollback drill.

### Обязательный operational checklist

Автоматизированные проверки в репозитории:

- [x] CI запускает `npm audit --audit-level=high` и блокирует high/critical уязвимости;
- [x] CI собирает production target из `Dockerfile`, а не только TypeScript bundles;
- [x] CI поднимает чистый PostgreSQL и проверяет реальные migrations/transactions;
- [x] CI создаёт SBOM, запускает CodeQL, tests, typecheck, lint, asset verification и builds.
- [x] GitHub Actions закреплены на commit SHA, проверенных через GitHub API для заявленных release tags.

Внешние настройки и drills нельзя считать выполненными без сохранённого подтверждения:

- [ ] `main` защищён: только PR, branch up-to-date, resolved conversations, no force-push/delete;
- [ ] required checks включают точные contexts `CI / verify` и `CodeQL / analyze`;
- [ ] Railway ждёт успешный CI для commit в `main`; неуспешный тестовый commit доказуемо не deployится;
- [ ] Railway server ограничен одной replica и одним region до внедрения shared state/zone ownership;
- [ ] создан pre-release snapshot и encrypted logical dump, записаны commit/image/migration versions;
- [ ] backup восстановлен в изолированную БД, server достиг `/readyz`, проверены auth/inventory/economy;
- [ ] измеренные RPO не хуже 24 часов и RTO не хуже 4 часов; evidence содержит UTC, hash и row counts;
- [ ] миграция прогнана на restored staging data, выбран и записан rollback/fix-forward путь;
- [ ] после production deploy пройдены health, catalog, registration, inventory и two-client smoke checks;
- [ ] выполнен 15-minute post-deploy watch без data-integrity/ledger ошибок.

Любой незакрытый пункт из внешнего списка — release blocker публичной alpha, даже если приложение собирается и визуально работает.

## Beta gate

- зоны 1–40, specialization quests, crafting, trade, auction, mail and guilds;
- AOI/spatial grid, binary snapshots, Redis presence/resume tickets;
- economy ledger invariants и GM audit tools;
- accessibility, localization, low-spec graphics profile;
- 100–250 concurrent staging bots и измеренный p95 tick.

## Release gate

- уровни 1–60+, рейды, территориальное PvP и live-ops tooling;
- external security review, load/soak/fuzz testing;
- tested backups, incident runbooks, metrics/alerts and rollback;
- legal review названия, контента, лицензий шрифтов/аудио/моделей;
- privacy policy, terms, moderation rules and support workflow.

Ни один будущий релиз не должен называться готовым production MMO только потому, что клиент визуально запускается. Gates фиксируют проверяемые свойства игры и эксплуатации.
