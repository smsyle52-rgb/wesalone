import { defineConfig } from "vitest/config";

const DATABASE_INTEGRATION_TESTS = [
  "src/__tests__/display_id.test.ts",
  "src/__tests__/isolation.spec.ts",
  "src/__tests__/points.integration.test.ts",
  "src/__tests__/webhook-ingest-deferred.spec.ts",
  "src/modules/commerce/commerce-safety.integration.test.ts",
  "src/modules/commerce/postgres-lock.integration.test.ts",
];

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ...DATABASE_INTEGRATION_TESTS],
  },
});
