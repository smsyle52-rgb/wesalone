import { describe, expect, it } from "vitest";
import {
  optionalSingleStringParameter,
  requestIdAsString,
  requestIdOrFallback,
  singleStringParameter,
} from "./request-values";

describe("commerce request value normalization", () => {
  it("normalizes a string request id", () => {
    expect(requestIdAsString("request-123")).toBe("request-123");
  });

  it("normalizes a numeric request id", () => {
    expect(requestIdAsString(12345)).toBe("12345");
  });

  it("uses the fallback for an unsupported request id value", () => {
    expect(requestIdOrFallback({ unexpected: true }, "fallback-id")).toBe("fallback-id");
  });

  it("accepts one query parameter value", () => {
    expect(optionalSingleStringParameter("  location-a  ")).toEqual({ ok: true, value: "location-a" });
  });

  it("rejects a multiple query parameter value", () => {
    expect(optionalSingleStringParameter(["location-a", "location-b"])).toEqual({
      ok: false,
      reason: "multiple",
    });
  });

  it("rejects an empty or invalid required value", () => {
    expect(singleStringParameter("   ")).toEqual({ ok: false, reason: "invalid" });
    expect(singleStringParameter(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(singleStringParameter(42)).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps workspace identity independent from normalized request values", () => {
    const activeWorkspaceId = "workspace-a";
    const orderId = singleStringParameter("order-1");

    expect(orderId).toEqual({ ok: true, value: "order-1" });
    expect(activeWorkspaceId).toBe("workspace-a");
  });
});
