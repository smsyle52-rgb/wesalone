import { db, pool } from "@workspace/db";

const originalExecute = db.execute.bind(db);

Object.defineProperty(db, "execute", {
  configurable: true,
  value(query: unknown, params?: unknown[]) {
    if (typeof query === "string") return pool.query(query, params);
    return originalExecute(query as Parameters<typeof originalExecute>[0]);
  },
});
