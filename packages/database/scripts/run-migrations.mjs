/**
 * Applies Drizzle SQL migrations without drizzle-kit or pnpm workspaces.
 * Uses the same folder layout as `drizzle-kit generate` (per-folder migration.sql).
 *
 * Usage: DATABASE_URL=... node ./scripts/run-migrations.mjs
 */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { getMigrationsToRun } from "drizzle-orm/migrator.utils"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { upgradeIfNeeded } from "drizzle-orm/up-migrations/pg"
import { Pool } from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Two migration folders, applied in order:
//
//   drizzle/        — UPSTREAM (ChatbotX). Treat as read-only: never add our
//                     own migrations here, so `git pull upstream` replaces this
//                     folder wholesale without conflicts.
//   drizzle-wesal/  — OURS. Every new Wesal One migration goes here.
//
// Upstream runs first because our migrations build on their tables. Drizzle
// tracks applied migrations by hash in drizzle.__drizzle_migrations, and each
// migrate() call only applies hashes it doesn't already find there, so running
// two folders against the same table is safe.
//
// NOTE: the six Wesal migrations that predate this split (commerce orders,
// platform subscription payment, platform AI setting, Cloud SQL compat, point
// wallet, point top-ups) intentionally stay in drizzle/ — they are already
// applied in production, and moving a file changes the hash Drizzle recorded,
// which would make it try to run them a second time.
const migrationsFolder = join(__dirname, "..", "drizzle")
const wesalMigrationsFolder = join(__dirname, "..", "drizzle-wesal")
const migrationLockName = "chatbotx:database:migrations"

// Drizzle's default migrator runs all pending migrations in one transaction.
// PostgreSQL does not allow a newly created enum to be used before that
// transaction commits, so migrations must run one at a time by default.
// Set DATABASE_MIGRATIONS_SEQUENTIAL=false only when this constraint is not
// relevant to the pending migrations.
const useSequentialMigrations =
  process.env.DATABASE_MIGRATIONS_SEQUENTIAL !== "false"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations.")
  process.exit(1)
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
})

const runMigrationsSequentially = async (db, folder) => {
  const migrationsTable = "__drizzle_migrations"
  const migrationsSchema = "drizzle"

  await db.execute(
    sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(migrationsSchema)}`,
  )

  const localMigrations = readMigrationFiles({ migrationsFolder: folder })
  const { newDb } = await upgradeIfNeeded(
    migrationsSchema,
    migrationsTable,
    db,
    localMigrations,
  )

  if (newDb) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)} (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint,
        name text,
        applied_at timestamp with time zone DEFAULT now()
      )
    `)
  }

  const dbMigrations = await db.session.all(
    sql`select id, hash, created_at, name from ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)}`,
  )
  const migrationsToRun = getMigrationsToRun({
    localMigrations,
    dbMigrations,
  })

  for (const migration of migrationsToRun) {
    await db.transaction(async (tx) => {
      for (const stmt of migration.sql) {
        if (stmt.trim()) {
          await tx.execute(sql.raw(stmt))
        }
      }

      await tx.execute(sql`
        insert into ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)}
          ("hash", "created_at", "name")
        values(${migration.hash}, ${migration.folderMillis}, ${migration.name ?? null})
      `)
    })

    console.log(`Applied migration: ${migration.name}`)
  }
}

const reconcileRenamedMigrations = async (client) => {
  const migrationTableResult = await client.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists",
  )
  if (!migrationTableResult.rows[0]?.exists) {
    return
  }

  const localMigrations = readMigrationFiles({ migrationsFolder })
  const dbMigrationsResult = await client.query(
    "SELECT id, hash, created_at, name FROM drizzle.__drizzle_migrations",
  )
  const dbMigrations = dbMigrationsResult.rows
  const localNames = new Set(localMigrations.map(({ name }) => name))
  const dbNames = new Set(dbMigrations.map(({ name }) => name))

  const localByHash = Map.groupBy(
    localMigrations.filter(({ name }) => !dbNames.has(name)),
    ({ hash }) => hash,
  )
  const staleDbByHash = Map.groupBy(
    dbMigrations.filter(
      ({ name }) => typeof name === "string" && !localNames.has(name),
    ),
    ({ hash }) => hash,
  )

  for (const [hash, renamedLocalMigrations] of localByHash) {
    const staleDbMigrations = staleDbByHash.get(hash) ?? []
    if (renamedLocalMigrations.length !== 1 || staleDbMigrations.length !== 1) {
      continue
    }

    const [localMigration] = renamedLocalMigrations
    const [dbMigration] = staleDbMigrations
    await client.query(
      `UPDATE drizzle.__drizzle_migrations
       SET name = $1, created_at = $2
       WHERE id = $3 AND hash = $4 AND name = $5`,
      [
        localMigration.name,
        localMigration.folderMillis,
        dbMigration.id,
        hash,
        dbMigration.name,
      ],
    )
    console.log(
      `Reconciled renamed migration: ${dbMigration.name} -> ${localMigration.name}`,
    )
  }
}

const reconcileSquashedQuestionnaireMigration = async (client) => {
  const legacyQuestionnaireMigrationNames = [
    "20260714152243_create_questionnaires",
    "20260716132848_update_questionnaires_status_image_retry_timeout",
    "20260716140752_add_questionnaire_question_system_field_key",
  ]
  const squashedQuestionnaireMigrationName =
    "20260719020251_create_questionnaires"

  const migrationTableResult = await client.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists",
  )
  if (!migrationTableResult.rows[0]?.exists) {
    return
  }

  const localMigrations = readMigrationFiles({ migrationsFolder })
  const squashedMigration = localMigrations.find(
    ({ name }) => name === squashedQuestionnaireMigrationName,
  )
  if (!squashedMigration) {
    return
  }

  const dbMigrationsResult = await client.query(
    "SELECT name FROM drizzle.__drizzle_migrations",
  )
  const dbNames = new Set(dbMigrationsResult.rows.map(({ name }) => name))
  if (dbNames.has(squashedQuestionnaireMigrationName)) {
    return
  }

  const hasLegacyQuestionnaireMigrations =
    legacyQuestionnaireMigrationNames.every((name) => dbNames.has(name))
  if (!hasLegacyQuestionnaireMigrations) {
    return
  }

  await client.query(`
    ALTER TABLE "Questionnaire"
      ADD COLUMN IF NOT EXISTS "deletedAt" timestamp(6) with time zone
  `)
  await client.query(
    'DROP INDEX IF EXISTS "Questionnaire_workspaceId_name_key"',
  )
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Questionnaire_workspaceId_name_key"
      ON "Questionnaire" ("workspaceId","name")
      WHERE ("deletedAt" is null)
  `)
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'QuestionnaireQuestion_customFieldId_systemFieldKey_exclusive'
          AND conrelid = '"QuestionnaireQuestion"'::regclass
      ) THEN
        ALTER TABLE "QuestionnaireQuestion"
          ADD CONSTRAINT "QuestionnaireQuestion_customFieldId_systemFieldKey_exclusive"
          CHECK (("customFieldId" IS NULL) OR ("systemFieldKey" IS NULL));
      END IF;
    END $$;
  `)
  await client.query(
    `INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at", "name")
     VALUES ($1, $2, $3)`,
    [
      squashedMigration.hash,
      squashedMigration.folderMillis,
      squashedMigration.name,
    ],
  )

  console.log(
    `Reconciled squashed migration: ${legacyQuestionnaireMigrationNames.join(
      ", ",
    )} -> ${squashedQuestionnaireMigrationName}`,
  )
}

let client
let migrationLockAcquired = false

try {
  client = await pool.connect()
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [
    migrationLockName,
  ])
  migrationLockAcquired = true

  await reconcileRenamedMigrations(client)
  await reconcileSquashedQuestionnaireMigration(client)
  const db = drizzle({ client })
  if (useSequentialMigrations) {
    await runMigrationsSequentially(db, migrationsFolder)
    if (existsSync(wesalMigrationsFolder)) {
      await runMigrationsSequentially(db, wesalMigrationsFolder)
    }
  } else {
    await migrate(db, { migrationsFolder })
    if (existsSync(wesalMigrationsFolder)) {
      await migrate(db, { migrationsFolder: wesalMigrationsFolder })
    }
  }
  console.log("Database migrations applied successfully.")
} catch (error) {
  console.error("Database migration failed:", error)
  process.exitCode = 1
} finally {
  if (client && migrationLockAcquired) {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
      migrationLockName,
    ])
  }
  client?.release()
  await pool.end()
}
