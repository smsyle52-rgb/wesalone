import { describe, expect, it } from "vitest";
import { ORDER_STATES } from "./commerce.constants";

describe("commerce lifecycle", () => {
  it("has canonical states", () => {
    expect(ORDER_STATES).toContain("Reserved");
    expect(ORDER_STATES).toContain("Delivered");
  });
});
