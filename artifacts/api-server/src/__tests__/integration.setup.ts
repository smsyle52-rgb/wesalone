import { vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const originalExecute = actual.db.execute.bind(actual.db);
  return {
    ...actual,
    db: {
      ...actual.db,
      execute(query: unknown, params?: unknown[]) {
        if (typeof query === "string") return actual.pool.query(query, params);
        return originalExecute(query as Parameters<typeof originalExecute>[0]);
      },
    },
  };
});
