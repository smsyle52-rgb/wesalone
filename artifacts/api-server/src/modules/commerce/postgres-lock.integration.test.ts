import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;
const table = `commerce_lock_test_${Date.now()}`;
let pool: (typeof import("@workspace/db"))["pool"];

suite("PostgreSQL inventory locking", () => {
  beforeAll(async () => {
    ({ pool } = await import("@workspace/db"));
    await pool.query(`CREATE TABLE ${table} (
      id integer PRIMARY KEY,
      workspace_id text NOT NULL,
      on_hand integer NOT NULL,
      reserved integer NOT NULL
    )`);
    await pool.query(`INSERT INTO ${table} VALUES (1, 'workspace-a', 1, 0)`);
  });

  afterAll(async () => {
    if (pool) await pool.query(`DROP TABLE IF EXISTS ${table}`);
  });

  it("lets only one transaction reserve the last unit", async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      const firstRow = await first.query<{ on_hand: number; reserved: number }>(
        `SELECT on_hand, reserved FROM ${table}
         WHERE id = 1 AND workspace_id = 'workspace-a' FOR UPDATE`,
      );
      expect(firstRow.rows[0]!.on_hand - firstRow.rows[0]!.reserved).toBe(1);
      await first.query(`UPDATE ${table} SET reserved = reserved + 1 WHERE id = 1`);

      await second.query("BEGIN");
      const competingRead = second.query<{ on_hand: number; reserved: number }>(
        `SELECT on_hand, reserved FROM ${table}
         WHERE id = 1 AND workspace_id = 'workspace-a' FOR UPDATE`,
      );

      await new Promise((resolve) => setTimeout(resolve, 25));
      await first.query("COMMIT");
      const secondRow = await competingRead;
      const availableForSecond = secondRow.rows[0]!.on_hand - secondRow.rows[0]!.reserved;
      expect(availableForSecond).toBe(0);
      await second.query("ROLLBACK");
    } finally {
      first.release();
      second.release();
    }
  });
});
