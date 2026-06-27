import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inventory = readFileSync(new URL("../../../../../lib/db/drizzle/0017_commerce_catalog_inventory.sql", import.meta.url), "utf8");
const orders = readFileSync(new URL("../../../../../lib/db/drizzle/0018_commerce_orders_payments.sql", import.meta.url), "utf8");
const backfill = readFileSync(new URL("../../../../../lib/db/drizzle/0020_commerce_legacy_backfill.sql", import.meta.url), "utf8");

describe("commerce migrations", () => {
  it("derives available stock and prevents invalid balances", () => {
    expect(inventory).toContain("GENERATED ALWAYS AS");
    expect(inventory).toContain("reserved <= on_hand");
  });

  it("keeps movements immutable", () => {
    expect(orders).toContain("prevent_inventory_movement_mutation");
    expect(orders).toContain("BEFORE UPDATE OR DELETE");
  });

  it("backfills default locations and variants without deleting legacy data", () => {
    expect(backfill).toContain("الموقع الافتراضي");
    expect(backfill).toContain("product_variants");
    expect(backfill).not.toContain("DELETE FROM orders");
    expect(backfill).not.toContain("DELETE FROM inventory_products");
  });
});
