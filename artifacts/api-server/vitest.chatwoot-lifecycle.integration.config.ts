import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [],
    include: ["src/tests/conversation-lifecycle-postgres.spec.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
