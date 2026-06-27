import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const products = readFileSync(new URL("./products-commerce.routes.ts", import.meta.url), "utf8");
const inventory = readFileSync(new URL("./inventory.routes.ts", import.meta.url), "utf8");

describe("workspace isolation", () => {
  it("derives workspace from the authenticated session", () => {
    expect(products).toContain("req.sessionUser");
    expect(inventory).toContain("activeWorkspaceId");
  });

  it("does not parse workspaceId from request bodies", () => {
    expect(products).not.toContain("req.body.workspaceId");
    expect(inventory).not.toContain("req.body.workspaceId");
  });
});
