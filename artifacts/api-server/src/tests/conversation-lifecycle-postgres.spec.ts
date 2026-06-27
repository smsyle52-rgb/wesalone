import { describe, it } from "vitest";

const databaseIt = process.env.DATABASE_URL ? it : it.skip;

describe("W3-T1B.1 PostgreSQL lifecycle transaction", () => {
  databaseIt("executes a real transaction with SELECT ... FOR UPDATE", async () => {
    const dbModulePath = "../../../../lib/db/src/index";
    const drizzleModulePath = "drizzle-orm";
    const { db, conversationsTable } = await import(dbModulePath);
    const { sql } = await import(drizzleModulePath);

    await db.transaction(async (transaction: any) => {
      await transaction.select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(sql`1 = 0`)
        .for("update");
    });
  });
});
