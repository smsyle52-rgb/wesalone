import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [],
    include: ["src/__tests__/whatsapp-business-profile-postgres.integration.spec.ts"],
  },
});
