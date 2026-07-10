# Production readiness

«Production» для MMORPG — это не только запускаемый клиент или количество моделей. Публичный коммерческий релиз допускается после прохождения всех применимых gates ниже.

## Статус 0.3.0

0.3.0 — **production-oriented vertical slice / technical preview**. Он использует production-практики для данных, CI и развёртывания, но **не является полноценной production MMO и не соответствует AAA-объёму или art polish**.

Функциональный срез включает:

- пять рас × два пола × два класса: 20 skinned GLB-вариантов;
- интерактивный 3D-preview перед созданием персонажа;
- стартовую зону «Переправа Донмер» с authored архитектурой и окружением;
- шесть оригинальных видов мобов, включая двух элитных;
- классы Воин и Маг с основной и сигнатурной атакой;
- оригинальные иконки умений и Babylon FX cast/projectile/impact/aura;
- server-authoritative movement/combat/rewards, PvE/PvP и стартовый квест;
- PostgreSQL accounts, dual-format persisted identity с canonical API/runtime boundary, inventory, equipment, quest state и economy ledger;
- versioned protocol/content catalog, reconnect protection и idempotent item mutations;
- единая Railway deployment foundation для Vite-клиента, API и Socket.IO.

Автоматически сгенерированные/экспортированные GLB проходят строгий технический gate. Это не заменяет ручную ретопологию, LOD, facial customization, motion polish и финальный художественный review.

## Закрытая alpha gate

- 4–6 отбалансированных умений на Воине и Маге, читаемые телеграфы и interrupt rules;
- ручной art review всех 20 вариантов, LOD0–LOD2, KTX2/Basis, Meshopt и low-spec профиль;
- уровни 1–10, минимум 10 заданий, босс и мини-подземелье;
- party, duel, friends, moderation и базовые GM-инструменты;
- accessibility review клавиатуры, screen-reader UI и reduced motion;
- 30 одновременных игроков, двухчасовой soak, reconnect и duplication tests;
- backup restore и migration/fix-forward drill для конкретного candidate commit.

## Operational checklist кандидата

Автоматизированные проверки в репозитории:

- [x] CI блокирует high/critical dependency vulnerabilities;
- [x] CI собирает production Docker target;
- [x] CI поднимает чистый PostgreSQL и проверяет реальные migrations/transactions;
- [x] CI запускает tests, typecheck, lint, asset verification, builds, SBOM и CodeQL;
- [x] 3D verifier проверяет все 20 персонажей, 6 мобов, GLB-структуру, rigs, textures и обязательные clips.

Внешние настройки и drills должны заново подтверждаться evidence для каждого release candidate:

- [ ] `main` защищён обязательными PR и актуальными required checks;
- [ ] Railway ждёт успешный CI текущего commit и остаётся в режиме одной authoritative replica;
- [ ] записаны commit SHA, Docker digest и версии схемы до/после;
- [ ] создан pre-release snapshot и зашифрованный logical dump;
- [ ] backup восстановлен в изолированную БД, сервер достиг `/readyz`, проверены auth/inventory/economy;
- [ ] измеренные RPO не хуже 24 часов и RTO не хуже 4 часов;
- [ ] миграция 0.3 прогнана на restored data и записан fix-forward/restore путь;
- [ ] подтверждено, что expand-миграция 7 не переписывает legacy identity, принимает legacy/canonical IDs и все legacy строки читаются сервером как canonical;
- [ ] identity backfill и сужение constraints остаются отдельными migrate/contract-релизами после закрытия окна отката 0.2;
- [ ] после deploy пройдены health, catalog, registration, character preview/create, inventory и two-client smoke;
- [ ] выполнен 15-minute post-deploy watch без data-integrity или ledger ошибок.

Незакрытый внешний пункт не обязательно блокирует локальный technical preview, но блокирует заявление о production-ready alpha.

## Beta gate

- зоны 1–40, specialization quests, crafting, trade, auction, mail and guilds;
- AOI/spatial grid, binary snapshots, Redis presence/resume tickets;
- economy invariants, fraud signals и полноценные GM audit tools;
- localization, настройки графики и проверенная доступность;
- 100–250 concurrent staging bots и измеренный p95 tick.

## Release gate

- уровни 1–60+, рейды, территориальное PvP и live-ops tooling;
- external security review, load/soak/fuzz testing;
- проверенные backups, incident response, metrics/alerts и rollback/fix-forward;
- юридический review названия, контента, лицензий шрифтов, аудио и моделей;
- privacy policy, terms, moderation rules и support workflow.

Ни один релиз не должен называться готовой production MMO или AAA-игрой только потому, что клиент визуально запускается. Gates фиксируют проверяемые свойства игры, контента и эксплуатации.
