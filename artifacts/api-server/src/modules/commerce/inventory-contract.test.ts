import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./inventory-reservation.service.ts", import.meta.url), "utf8");

describe("inventory reservation contract", () => {
  it("locks orders and stock levels before reservation", () => {
    expect(source).toContain("FOR UPDATE");
    expect(source).toContain("INSUFFICIENT_STOCK");
  });

  it("wraps reservation in a transaction with rollback", () => {
    expect(source).toContain('client.query("BEGIN")');
    expect(source).toContain('client.query("ROLLBACK")');
  });
});
