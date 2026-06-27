import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sources = {
  products: readFileSync(new URL("./products-commerce.routes.ts", import.meta.url), "utf8"),
  inventory: readFileSync(new URL("./inventory.routes.ts", import.meta.url), "utf8"),
  orders: readFileSync(new URL("./orders-commerce.routes.ts", import.meta.url), "utf8"),
  legacyOrders: readFileSync(new URL("./legacy-commerce-order-adapter.routes.ts", import.meta.url), "utf8"),
  orderItems: readFileSync(new URL("./order-item-guard.routes.ts", import.meta.url), "utf8"),
};

describe("workspace isolation", () => {
  it("derives workspace from the authenticated session after request normalization", () => {
    for (const source of Object.values(sources)) {
      expect(source).toMatch(/req\.sessionUser|activeWorkspaceId/);
    }
  });

  it("does not parse workspaceId from request bodies, queries, or route parameters", () => {
    for (const source of Object.values(sources)) {
      expect(source).not.toContain("req.body.workspaceId");
      expect(source).not.toContain("req.query.workspaceId");
      expect(source).not.toContain("req.params.workspaceId");
    }
  });
});
