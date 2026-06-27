import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/__tests__/display_id.test.ts",
      "src/__tests__/isolation.spec.ts",
      "src/__tests__/points.integration.test.ts",
      "src/__tests__/webhook-ingest-deferred.spec.ts",
      "src/modules/commerce/commerce-safety.integration.test.ts",
      "src/modules/commerce/postgres-lock.integration.test.ts",
    ],
    isolate: true,
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
