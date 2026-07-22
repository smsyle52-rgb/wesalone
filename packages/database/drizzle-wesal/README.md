# Wesal One migrations

**Every new Wesal One migration goes in this folder — never in `../drizzle/`.**

`../drizzle/` belongs to upstream ChatbotX. Keeping it untouched is what lets
`git pull upstream` replace it wholesale without merge conflicts, so we keep
getting their bug fixes for free.

## Adding a migration

Generate it the normal way, then **move the generated folder here**:

```bash
pnpm --filter @chatbotx.io/database make:migration <name>
mv packages/database/drizzle/<generated_folder> packages/database/drizzle-wesal/
```

`scripts/run-migrations.mjs` applies `drizzle/` first, then this folder, so a
migration here can safely depend on upstream tables.

## Rules

- **Never move an already-applied migration between folders.** Drizzle tracks
  applied migrations by file hash in `drizzle.__drizzle_migrations`; moving a
  file changes that hash and Drizzle will try to run it again — against
  production data.
- **Never edit an upstream migration in `../drizzle/`.** If upstream's SQL
  doesn't work for us, add a follow-up migration *here* that corrects it after
  the fact.

## Known exceptions (pre-existing, do not "clean up")

Two upstream migrations in `../drizzle/` **are** edited, and must stay edited:

- `20260517074023_migrate_analytics_to_timescaledb_table`
- `20260622040000_align_message_attachment_to_shard_schema`

Both originally ran `CREATE EXTENSION timescaledb` and created hypertables.
Google Cloud SQL — our deployment target — does not offer the TimescaleDB
extension at all, so the whole migration chain failed there. The TimescaleDB
statements were removed; the tables are ordinary PostgreSQL tables with the
same columns, primary keys and indexes.

These two files will conflict on every `git pull upstream`. Resolve by keeping
our version, unless we have moved off Cloud SQL to a Postgres that ships
TimescaleDB.

Six further Wesal migrations (commerce orders, platform subscription payment,
platform AI setting, Cloud SQL compat, point wallet/grant/ledger, point
top-ups) also live in `../drizzle/` because they were applied to production
before this split existed. Leave them there.
