import { pool } from "@workspace/db";
import type pino from "pino";

export async function runBillingMaintenance(logger: pino.Logger): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const graceResult = await client.query(`
      UPDATE subscriptions
      SET status = 'grace', updated_at = now()
      WHERE status = 'active'
        AND current_period_end IS NOT NULL
        AND current_period_end < current_date
    `);

    const expiredResult = await client.query(`
      UPDATE subscriptions
      SET status = 'expired', updated_at = now()
      WHERE status = 'grace'
        AND current_period_end IS NOT NULL
        AND current_period_end < current_date - interval '7 days'
    `);

    const trialExpiredResult = await client.query(`
      UPDATE subscriptions
      SET status = 'grace', updated_at = now()
      WHERE status = 'trialing'
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at < now()
    `);

    await client.query(`
      INSERT INTO usage_counters (workspace_id, period_month, messages_sent, agents_count, contacts_count, team_members, updated_at)
      SELECT
        w.id,
        to_char(now(), 'YYYY-MM'),
        0,
        (SELECT count(*) FROM ai_agents a WHERE a.workspace_id = w.id AND a.status = 'active'),
        (SELECT count(*) FROM contacts c WHERE c.workspace_id = w.id),
        (SELECT count(*) FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.status = 'active'),
        now()
      FROM workspaces w
      ON CONFLICT (workspace_id, period_month)
      DO UPDATE SET
        agents_count = excluded.agents_count,
        contacts_count = excluded.contacts_count,
        team_members = excluded.team_members,
        updated_at = now()
    `);

    await client.query("COMMIT");
    const processed = Number(graceResult.rowCount ?? 0) + Number(expiredResult.rowCount ?? 0) + Number(trialExpiredResult.rowCount ?? 0);
    if (processed > 0) logger.info({ processed }, "Billing subscription statuses updated");
    return processed;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
