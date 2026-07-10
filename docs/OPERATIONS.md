# Operations runbook

## Deployment

`main` is the only production source. GitHub Actions verifies the high/critical dependency audit, tests, TypeScript, lint, assets, a real PostgreSQL migration/inventory integration test, application builds, the production Docker image and the CycloneDX SBOM. The Railway image contains both the Vite client and Fastify server; GitHub Pages is not part of production.

Railway must remain at exactly **one server replica in one region**. Realtime rooms, world ownership and some session effects are process-local. A second replica can split connected players and create conflicting world simulation even when PostgreSQL writes remain atomic. Do not increase the replica count until shared presence/session state, distributed zone ownership and cross-instance realtime fan-out are implemented and load-tested.

Railway's GitHub deployment trigger must target `main` and have **Wait for CI** enabled. A server deployment may start only after the new `main` commit has successful `CI / verify` and `CodeQL / analyze` checks. If the Railway integration cannot wait for every required check, disable direct autodeploy and trigger production deployment from a protected post-CI workflow instead.

Protocol-breaking releases increment `PROTOCOL_VERSION`. During the short mixed-version window an old client is rejected with an explicit refresh message instead of receiving an incompatible inventory payload.

### Repository and hosting controls

Before public traffic, configure a GitHub ruleset for `main` and retain screenshots or exported settings as release evidence:

- [ ] require a pull request and resolved review conversations;
- [ ] require the branch to be up to date before merge;
- [ ] require `CI / verify` and `CodeQL / analyze` (select the exact check names emitted by the first PR run);
- [ ] block force-pushes and branch deletion, and restrict bypass to an emergency owner;
- [ ] confirm Railway source branch is `main`, Wait for CI is enabled and PR branches cannot deploy to production;
- [ ] confirm the Railway server has one replica, one region and no manually created duplicate service;
- [ ] perform one test merge and prove that failed CI prevents the unified Railway production deployment.

## Health

- `/healthz` is process liveness and must not depend on PostgreSQL.
- `/readyz` is traffic readiness and checks the active store with a short timeout.
- Railway serves UI, `/v1`, `/socket.io`, `/healthz` and `/readyz` from one HTTPS origin.
- Railway uses `/readyz`; repeated failures remove/restart an unhealthy instance.

After deploy verify `/healthz`, `/readyz`, `/v1/catalog`, registration, character creation, inventory and the two-client smoke test.

## Migrations and rollback

Migrations are append-only, versioned and transactional. Never edit a migration already applied to production. A failed migration aborts startup/readiness; fix forward with a new migration after inspecting the failure. Application rollback is safe only when the previous binary tolerates the current schema.

Production migrations use the expand-migrate-contract pattern: add compatible structures first, backfill in bounded batches, switch readers/writers only after verification, and remove old structures in a later release. The startup advisory lock prevents two migration runners, but it does not make an incompatible schema change safe.

### Rollout checklist

1. Confirm the candidate commit passed required CI and CodeQL checks and its Docker image gate.
2. Record the commit SHA, Docker image digest, current `schema_migrations` maximum version and intended new versions.
3. Restore the latest backup into an isolated database and run the candidate migrations plus PostgreSQL integration/smoke tests there.
4. Confirm Railway still has exactly one replica and Wait for CI enabled.
5. Immediately before a canonical/destructive data change, create both a Railway snapshot (when the plan supports it) and an encrypted logical `pg_dump`.
6. Deploy the candidate, wait for `/readyz`, then verify the migration version, `/v1/catalog`, registration, character creation, inventory mutations and the two-client smoke test.
7. Observe readiness, 5xx responses, reconnects and economy-ledger invariants for at least 15 minutes before declaring the rollout complete.

### Rollback decision

- If no migration ran, or the previous binary is explicitly compatible with the new schema, roll back the image and repeat readiness/smoke checks.
- If a canonical-data migration accepted production writes, do not run an ad-hoc down migration. Prefer fix-forward.
- If fix-forward cannot protect player data, enter maintenance, record the incident/RPO boundary, restore the matched pre-release snapshot or logical dump, and deploy the matched old image. This discards writes after the backup and requires an explicit player-facing incident notice.
- Never combine an old binary with a database snapshot/schema from a different release without a documented compatibility test.

Release 0.2 is explicitly not binary-rollback-compatible with 0.1 after new writes: canonical inventory moved from `inventory_stacks` to `item_instances`. Use fix-forward, or restore a matched pre-0.2 database snapshot and 0.1 image together.

Release 0.3 migration 7 is the **expand** step for character identity. It adds persisted `gender` with the legacy-safe `male` default, leaves existing `race`/`class_id` values unchanged, and installs constraints that accept both the 0.2 aliases and the 0.3 canonical IDs. The 0.3 persistence reader normalizes either vocabulary before any API, world, inventory or locked character operation, so legacy rows are exposed only as canonical IDs at runtime.

Do not combine the expand step with an in-place identity rewrite. After every 0.2 instance is retired and the application rollback window is closed, a later migration may backfill legacy IDs in bounded batches while dual-read support remains enabled. Verify the remaining legacy/unknown counts, then ship a separate **contract** release that narrows the constraints and only afterwards removes the shared legacy normalizers. Although migration 7 preserves old rows and old writes, a rollback to 0.2 is not safe after 0.3 has accepted new canonical character rows; prefer a 0.3 fix-forward or restore the matched pre-0.3 snapshot and image together.

## Backup and restore drill

For public alpha, the operating target is RPO at most 24 hours and RTO at most 4 hours. Keep at least seven daily recovery points and one pre-release recovery point for every canonical-data migration. Backups must be encrypted, access-controlled and stored outside the running PostgreSQL volume.

Create a logical backup from an environment where `DATABASE_URL` is injected without printing it:

```bash
umask 077
backup="neivara-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$backup"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in "$backup" -out "$backup.enc" -pass env:BACKUP_PASSPHRASE
sha256sum "$backup.enc" > "$backup.enc.sha256"
rm -f "$backup"
```

Inject `BACKUP_PASSPHRASE` from an OS keychain or approved secret manager; never
store it beside the archive. Validate both the checksum and a temporary
decryption with `pg_restore --list` before recording the recovery point.

At least monthly, and before every canonical-data migration, restore into a new isolated PostgreSQL database—not production:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$backup.enc" -out "$backup" -pass env:BACKUP_PASSPHRASE
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-acl "$backup"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT version, name FROM schema_migrations ORDER BY version"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) AS accounts FROM accounts"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) AS characters FROM characters"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) AS item_instances FROM item_instances"
```

The drill is complete only after the restored server reaches `/readyz`, a test account can authenticate, inventory/equipment can be read and mutated, economy balances reconcile, and elapsed restore time is recorded. Store the UTC timestamp, source backup ID/hash, restored migration version, row counts, tester and measured RPO/RTO in the private incident/operations log. Delete the isolated restore after evidence is retained.

## Incident sequence

1. Stop risky writes or pause deployment if data integrity is uncertain.
2. Record UTC time, deployment ID, commit, migration version and affected character IDs.
3. Preserve logs and economy-ledger rows without exposing credentials.
4. Mitigate with rollback only when schema-compatible; otherwise fix forward.
5. Validate account ownership, item counts, gold invariants and reconnect behavior.
6. Run the smoke test, resume traffic, then document root cause and prevention.

## Routine checks

```bash
npm ci
npm audit --audit-level=high
npm test
npm run typecheck
npm run lint
npm run assets:check
npm run build
docker build --target runtime --tag neivara-server:local .
API_URL=https://authentic-expression-production-bdc5.up.railway.app npm run smoke
```

Never print Railway variables or production connection strings into CI logs or public issues.
Treat `railway environment config --json` and variable-list JSON/KV output as secret-bearing:
inspect only redacted/key-only projections, and rotate any credential accidentally emitted to a shared log.
