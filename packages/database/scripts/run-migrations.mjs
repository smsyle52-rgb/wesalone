/**
 * Applies Drizzle SQL migrations without drizzle-kit or pnpm workspaces.
 * Uses the same folder layout as `drizzle-kit generate` (per-folder migration.sql).
 *
 * Usage: DATABASE_URL=... node ./scripts/run-migrations.mjs
 */
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
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

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations.")
  process.exit(1)
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
})

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

let client
let migrationLockAcquired = false

try {
  client = await pool.connect()
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [
    migrationLockName,
  ])
  migrationLockAcquired = true

  await reconcileRenamedMigrations(client)
  const db = drizzle({ client })
  await migrate(db, { migrationsFolder })
  if (existsSync(wesalMigrationsFolder)) {
    await migrate(db, { migrationsFolder: wesalMigrationsFolder })
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
