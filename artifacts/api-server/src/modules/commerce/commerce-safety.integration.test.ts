import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { transitionOrder } from "./order-lifecycle.service";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const createdUsers: string[] = [];
const createdWorkspaces: string[] = [];

async function createFixture(quantity = 1, onHand = 1) {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const locationId = randomUUID();
  const orderId = randomUUID();
  const itemId = randomUUID();

  await pool.query(
    "INSERT INTO users (id, email, name, password_hash, email_verified) VALUES ($1,$2,'Safety Tester','test',true)",
    [userId, `commerce-safety-${userId}@example.test`],
  );
  await pool.query(
    "INSERT INTO workspaces (id, name, slug) VALUES ($1,'Commerce Safety',$2)",
    [workspaceId, `commerce-safety-${workspaceId}`],
  );
  await pool.query(
    `INSERT INTO inventory_products (id, workspace_id, name, price, currency, status)
     VALUES ($1,$2,'Safety Product',100,'YER','active')`,
    [productId, workspaceId],
  );
  await pool.query(
    `INSERT INTO product_variants (id, workspace_id, product_id, title, price, currency, is_default, status)
     VALUES ($1,$2,$3,'Default',100,'YER',true,'active')`,
    [variantId, workspaceId, productId],
  );
  await pool.query(
    `INSERT INTO stock_locations (id, workspace_id, name, is_default, is_active)
     VALUES ($1,$2,'Main',true,true)`,
    [locationId, workspaceId],
  );
  await pool.query(
    `INSERT INTO inventory_stock_levels (workspace_id, product_variant_id, location_id, on_hand, reserved)
     VALUES ($1,$2,$3,$4,0)`,
    [workspaceId, variantId, locationId, onHand],
  );
  await pool.query(
    `INSERT INTO orders
     (id, workspace_id, order_number, status, payment_status, channel, total_amount, paid_amount,
      discount, currency, delivery_type, delivery_fee, cod_enabled, version, created_by)
     VALUES ($1,$2,$3,'Confirmed','Unpaid','manual',$4,0,0,'YER','pickup',0,false,0,$5)`,
    [orderId, workspaceId, `SAFE-${orderId.slice(0, 8)}`, quantity * 100, userId],
  );
  await pool.query(
    `INSERT INTO order_items
     (id, workspace_id, order_id, inventory_product_id, product_variant_id, location_id,
      name, quantity, unit_price, discount, tax, currency, total, snapshot, reservation_status)
     VALUES ($1,$2,$3,$4,$5,$6,'Safety Product',$7,100,0,0,'YER',$8,'{}','none')`,
    [itemId, workspaceId, orderId, productId, variantId, locationId, quantity, quantity * 100],
  );

  createdUsers.push(userId);
  createdWorkspaces.push(workspaceId);
  return { userId, workspaceId, productId, variantId, locationId, orderId, itemId };
}

async function createSecondOrder(fixture: Awaited<ReturnType<typeof createFixture>>, quantity = 1) {
  const orderId = randomUUID();
  const itemId = randomUUID();
  await pool.query(
    `INSERT INTO orders
     (id, workspace_id, order_number, status, payment_status, channel, total_amount, paid_amount,
      discount, currency, delivery_type, delivery_fee, cod_enabled, version, created_by)
     VALUES ($1,$2,$3,'Confirmed','Unpaid','manual',$4,0,0,'YER','pickup',0,false,0,$5)`,
    [orderId, fixture.workspaceId, `SAFE-${orderId.slice(0, 8)}`, quantity * 100, fixture.userId],
  );
  await pool.query(
    `INSERT INTO order_items
     (id, workspace_id, order_id, inventory_product_id, product_variant_id, location_id,
      name, quantity, unit_price, discount, tax, currency, total, snapshot, reservation_status)
     VALUES ($1,$2,$3,$4,$5,$6,'Safety Product',$7,100,0,0,'YER',$8,'{}','none')`,
    [itemId, fixture.workspaceId, orderId, fixture.productId, fixture.variantId, fixture.locationId, quantity, quantity * 100],
  );
  return { orderId, itemId };
}

async function reserve(fixture: Awaited<ReturnType<typeof createFixture>>, key: string, orderId = fixture.orderId) {
  return transitionOrder({
    workspaceId: fixture.workspaceId,
    orderId,
    targetState: "Reserved",
    userId: fixture.userId,
    correlationId: `corr:${key}`,
    idempotencyKey: key,
  });
}

suite("Commerce Safety Stabilization on PostgreSQL", () => {
  afterEach(async () => {
    while (createdWorkspaces.length) {
      await pool.query("DELETE FROM workspaces WHERE id = $1", [createdWorkspaces.pop()]);
    }
    while (createdUsers.length) {
      await pool.query("DELETE FROM users WHERE id = $1", [createdUsers.pop()]);
    }
  });

  it("rolls back inventory, order state, movements, and transition together", async () => {
    const fixture = await createFixture(2, 1);

    await expect(reserve(fixture, "rollback-reserve-key")).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });

    const order = await pool.query<{ status: string; version: number }>(
      "SELECT status, version FROM orders WHERE id = $1 AND workspace_id = $2",
      [fixture.orderId, fixture.workspaceId],
    );
    const stock = await pool.query<{ reserved: number }>(
      `SELECT reserved FROM inventory_stock_levels
       WHERE workspace_id = $1 AND product_variant_id = $2 AND location_id = $3`,
      [fixture.workspaceId, fixture.variantId, fixture.locationId],
    );
    const counts = await pool.query<{ reservations: number; movements: number; transitions: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM inventory_reservations WHERE workspace_id = $1 AND order_id = $2) AS reservations,
         (SELECT COUNT(*)::int FROM inventory_movements WHERE workspace_id = $1 AND order_id = $2) AS movements,
         (SELECT COUNT(*)::int FROM order_state_transitions WHERE workspace_id = $1 AND order_id = $2) AS transitions`,
      [fixture.workspaceId, fixture.orderId],
    );

    expect(order.rows[0]).toEqual({ status: "Confirmed", version: 0 });
    expect(stock.rows[0]?.reserved).toBe(0);
    expect(counts.rows[0]).toEqual({ reservations: 0, movements: 0, transitions: 0 });
  });

  it("allows only one concurrent order to reserve the last unit", async () => {
    const fixture = await createFixture(1, 1);
    const second = await createSecondOrder(fixture);

    const results = await Promise.allSettled([
      reserve(fixture, "concurrent-reserve-a", fixture.orderId),
      reserve(fixture, "concurrent-reserve-b", second.orderId),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "INSUFFICIENT_STOCK" });

    const stock = await pool.query<{ reserved: number; available: number }>(
      `SELECT reserved, available FROM inventory_stock_levels
       WHERE workspace_id = $1 AND product_variant_id = $2 AND location_id = $3`,
      [fixture.workspaceId, fixture.variantId, fixture.locationId],
    );
    const states = await pool.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count FROM orders
       WHERE workspace_id = $1 AND id IN ($2,$3) GROUP BY status`,
      [fixture.workspaceId, fixture.orderId, second.orderId],
    );

    expect(stock.rows[0]).toEqual({ reserved: 1, available: 0 });
    expect(states.rows).toEqual(expect.arrayContaining([
      { status: "Confirmed", count: 1 },
      { status: "Reserved", count: 1 },
    ]));
  });

  it("replays the exact transition key without duplicating side effects", async () => {
    const fixture = await createFixture(1, 2);
    const first = await reserve(fixture, "exact-reserve-key");
    const replay = await reserve(fixture, "exact-reserve-key");

    expect(first.idempotent).toBe(false);
    expect(replay.idempotent).toBe(true);

    const state = await pool.query<{ status: string; version: number; reserved: number; movements: number; transitions: number }>(
      `SELECT o.status, o.version, l.reserved,
              (SELECT COUNT(*)::int FROM inventory_movements m WHERE m.workspace_id = o.workspace_id AND m.order_id = o.id) AS movements,
              (SELECT COUNT(*)::int FROM order_state_transitions t WHERE t.workspace_id = o.workspace_id AND t.order_id = o.id) AS transitions
       FROM orders o
       JOIN inventory_stock_levels l ON l.workspace_id = o.workspace_id
       WHERE o.id = $1 AND o.workspace_id = $2 AND l.product_variant_id = $3 AND l.location_id = $4`,
      [fixture.orderId, fixture.workspaceId, fixture.variantId, fixture.locationId],
    );

    expect(state.rows[0]).toEqual({
      status: "Reserved",
      version: 1,
      reserved: 1,
      movements: 1,
      transitions: 1,
    });
  });

  it("rejects reuse of the same key for a different transition", async () => {
    const fixture = await createFixture(1, 2);
    await reserve(fixture, "reused-transition-key");

    await expect(transitionOrder({
      workspaceId: fixture.workspaceId,
      orderId: fixture.orderId,
      targetState: "Preparing",
      userId: fixture.userId,
      correlationId: "corr:reused-transition-key",
      idempotencyKey: "reused-transition-key",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const order = await pool.query<{ status: string; version: number }>(
      "SELECT status, version FROM orders WHERE id = $1 AND workspace_id = $2",
      [fixture.orderId, fixture.workspaceId],
    );
    expect(order.rows[0]).toEqual({ status: "Reserved", version: 1 });
  });
});
