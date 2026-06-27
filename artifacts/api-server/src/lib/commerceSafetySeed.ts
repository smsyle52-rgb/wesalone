import { pool } from "@workspace/db";

export async function runCommerceSafetySeed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const permission = await client.query<{ id: string }>(
      `INSERT INTO permissions (resource, action, slug, description)
       VALUES ('payments', 'refund', 'payments:refund', 'إنشاء واعتماد استرجاعات المدفوعات')
       ON CONFLICT (slug) DO UPDATE SET
         resource = EXCLUDED.resource,
         action = EXCLUDED.action,
         description = EXCLUDED.description
       RETURNING id`,
    );
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, $1
       FROM roles r
       WHERE r.is_system = true AND r.slug IN ('owner', 'manager', 'accountant')
       ON CONFLICT DO NOTHING`,
      [permission.rows[0]!.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
