import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { singleStringParameter } from "./request-values";

const routeSource = readFileSync(
  new URL("./order-item-guard.routes.ts", import.meta.url),
  "utf8",
);

describe("order item guard request values", () => {
  it("accepts a valid single id", () => {
    expect(singleStringParameter("order-123")).toEqual({
      ok: true,
      value: "order-123",
    });
  });

  it("rejects a multiple id value", () => {
    expect(singleStringParameter(["order-123", "order-456"])).toEqual({
      ok: false,
      reason: "multiple",
    });
  });

  it("rejects an empty id value", () => {
    expect(singleStringParameter("   ")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("uses the shared helper and keeps workspaceId session-scoped", () => {
    expect(routeSource).toContain('from "./request-values"');
    expect(routeSource).toContain("singleStringParameter(req.params.id)");
    expect(routeSource).not.toContain("String(req.params.id)");
    expect(routeSource).toContain("req.sessionUser.activeWorkspaceId");
    expect(routeSource).not.toContain("req.body.workspaceId");
    expect(routeSource).not.toContain("req.query.workspaceId");
    expect(routeSource).not.toContain("req.params.workspaceId");
  });
});
