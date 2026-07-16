import { describe, expect, it } from "vitest";
import { classifyActionClaimGuard } from "../lib/agent-reply";

describe("action claim escalation policy", () => {
  it("keeps an unbacked order claim soft so the agent continues", () => {
    expect(classifyActionClaimGuard("create_order", false)).toEqual({
      hardGuard: false,
      softReason: "unbacked_claim:create_order",
    });
  });

  it("keeps false payment confirmation as a hard escalation", () => {
    expect(classifyActionClaimGuard(null, true)).toEqual({
      hardGuard: true,
      softReason: null,
    });
  });

  it("preserves the hard payment boundary when both signals appear", () => {
    expect(classifyActionClaimGuard("create_order", true)).toEqual({
      hardGuard: true,
      softReason: "unbacked_claim:create_order",
    });
  });
});
