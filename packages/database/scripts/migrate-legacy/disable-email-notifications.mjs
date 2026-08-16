import { Pool } from "pg"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required")
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 2000,
})

try {
  const beforeResult = await pool.query(`
    SELECT count(*)::int AS count
    FROM "WorkspaceMember"
    WHERE COALESCE(("notificationChannels" ->> 'email')::boolean, false) = true
  `)
  const before = beforeResult.rows[0].count

  const updated = await pool.query(`
    UPDATE "WorkspaceMember"
    SET "notificationChannels" = jsonb_set(
      COALESCE("notificationChannels", '{}'::jsonb),
      '{email}',
      'false'::jsonb,
      true
    )
    WHERE COALESCE(("notificationChannels" ->> 'email')::boolean, false) = true
    RETURNING id
  `)

  const afterResult = await pool.query(`
    SELECT count(*)::int AS count
    FROM "WorkspaceMember"
    WHERE COALESCE(("notificationChannels" ->> 'email')::boolean, false) = true
  `)
  const after = afterResult.rows[0].count

  console.log(JSON.stringify({ before, updated: updated.rowCount, after }))
} finally {
  await pool.end()
}
