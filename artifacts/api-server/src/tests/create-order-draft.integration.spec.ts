import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CommerceCommandContext,
  CreateOrderDraftDependencies,
  CreateOrderDraftInput,
  CreateOrderDraftResult,
} from "../modules/commerce/application/create-order-draft";
import type { CreateOrderDraftRepositories, PoolClient } from "../modules/commerce/application/create-order-draft.repositories";

vi.unmock("@workspace/db");

const databaseUrl = process.env.DATABASE_URL || (
  process.env.PGHOST
    ? `postgresql://${process.env.PGUSER ?? "postgres"}:${process.env.PGPASSWORD ?? "postgres"}@${process.env.PGHOST}:${process.env.PGPORT ?? "5432"}/commerce_integration`
    : ""
);
const suite = databaseUrl ? describe.sequential : describe.skip;

type TestPool = {
  query: <T = unknown>(text: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
  connect: () => Promise<PoolClient>;
};

let pool: TestPool;
let createOrderDraft: (
  input: CreateOrderDraftInput,
  context: CommerceCommandContext,
  dependencyOverrides?: Partial<CreateOrderDraftDependencies>,
) => Promise<CreateOrderDraftResult>;
let repositories: CreateOrderDraftRepositories;

interface Fixture {
  userA: string;
  userB: string;
  workspaceA: string;
  workspaceB: string;
  membershipA: string;
  membershipB: string;
  contactA: string;
  contactA2: string;
  contactB: string;
  conversationA: string;
  conversationA2: string;
  conversationB: string;
  opportunityA: string;
  opportunityA2: string;
  messageA: string;
  messageA2: string;
  messageB: string;
  input: CreateOrderDraftInput;
  context: CommerceCommandContext;
}

const fixtures: Fixture[] = [];

beforeAll(async () => {
  if (!databaseUrl) return;
  process.env.DATABASE_URL = databaseUrl;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;
  const serviceModule = await import("../modules/commerce/application/create-order-draft");
  const repositoryModule = await import("../modules/commerce/application/create-order-draft.repositories");
  createOrderDraft = serviceModule.createOrderDraft;
  repositories = repositoryModule.sqlCreateOrderDraftRepositories;
});

afterEach(async () => {
  if (!pool) return;
  while (fixtures.length > 0) {
    const fixture = fixtures.pop()!;
    await pool.query("DELETE FROM audit_logs WHERE workspace_id = ANY($1::uuid[])", [[fixture.workspaceA, fixture.workspaceB]]);
    await pool.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [[fixture.workspaceA, fixture.workspaceB]]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[fixture.userA, fixture.userB]]);
  }
});

async function createFixture(): Promise<Fixture> {
  const fixture: Fixture = {
    userA: randomUUID(),
    userB: randomUUID(),
    workspaceA: randomUUID(),
    workspaceB: randomUUID(),
    membershipA: randomUUID(),
    membershipB: randomUUID(),
    contactA: randomUUID(),
    contactA2: randomUUID(),
    contactB: randomUUID(),
    conversationA: randomUUID(),
    conversationA2: randomUUID(),
    conversationB: randomUUID(),
    opportunityA: randomUUID(),
    opportunityA2: randomUUID(),
    messageA: randomUUID(),
    messageA2: randomUUID(),
    messageB: randomUUID(),
    input: {} as CreateOrderDraftInput,
    context: {} as CommerceCommandContext,
  };

  await pool.query(
    `INSERT INTO users (id, email, name, password_hash, email_verified)
     VALUES ($1,$2,'Phase 1A Actor','test',true), ($3,$4,'Phase 1A Other','test',true)`,
    [fixture.userA, `phase1a-${fixture.userA}@example.test`, fixture.userB, `phase1a-${fixture.userB}@example.test`],
  );
  await pool.query(
    `INSERT INTO workspaces (id, name, slug)
     VALUES ($1,'Phase 1A A',$2), ($3,'Phase 1A B',$4)`,
    [fixture.workspaceA, `phase1a-a-${fixture.workspaceA}`, fixture.workspaceB, `phase1a-b-${fixture.workspaceB}`],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (id, workspace_id, user_id, status)
     VALUES ($1,$2,$3,'active'), ($4,$5,$6,'active')`,
    [fixture.membershipA, fixture.workspaceA, fixture.userA, fixture.membershipB, fixture.workspaceB, fixture.userB],
  );
  await pool.query(
    `INSERT INTO contacts (id, workspace_id, name)
     VALUES ($1,$2,'Contact A'), ($3,$2,'Contact A2'), ($4,$5,'Contact B')`,
    [fixture.contactA, fixture.workspaceA, fixture.contactA2, fixture.contactB, fixture.workspaceB],
  );
  await pool.query(
    `INSERT INTO conversations (id, workspace_id, contact_id, channel, status)
     VALUES ($1,$2,$3,'whatsapp','new'), ($4,$2,$5,'whatsapp','new'), ($6,$7,$8,'whatsapp','new')`,
    [
      fixture.conversationA,
      fixture.workspaceA,
      fixture.contactA,
      fixture.conversationA2,
      fixture.contactA2,
      fixture.conversationB,
      fixture.workspaceB,
      fixture.contactB,
    ],
  );
  await pool.query(
    `INSERT INTO opportunities (id, workspace_id, title, contact_id, conversation_id)
     VALUES ($1,$2,'Opportunity A',$3,$4), ($5,$2,'Opportunity A2',$6,$7)`,
    [
      fixture.opportunityA,
      fixture.workspaceA,
      fixture.contactA,
      fixture.conversationA,
      fixture.opportunityA2,
      fixture.contactA2,
      fixture.conversationA2,
    ],
  );
  await pool.query(
    `INSERT INTO messages
     (id, conversation_id, workspace_id, direction, sender_type, source, content_type, content)
     VALUES
     ($1,$2,$3,'inbound','contact','webhook','text','message A'),
     ($4,$5,$3,'inbound','contact','webhook','text','message A2'),
     ($6,$7,$8,'inbound','contact','webhook','text','message B')`,
    [
      fixture.messageA,
      fixture.conversationA,
      fixture.workspaceA,
      fixture.messageA2,
      fixture.conversationA2,
      fixture.messageB,
      fixture.conversationB,
      fixture.workspaceB,
    ],
  );

  fixture.input = {
    contactId: fixture.contactA,
    conversationId: fixture.conversationA,
    opportunityId: fixture.opportunityA,
    sourceMessageId: fixture.messageA,
    assignedMembershipId: fixture.membershipA,
    channel: "whatsapp",
    currency: "YER",
    discount: 0,
    notes: "Created from Inbox",
    deliveryType: "local",
    deliveryAgentPhone: null,
    carrierName: null,
    carrierPhone: null,
    deliveryReceiptUrl: null,
    deliveryAddress: "Sanaa",
    deliveryFee: 25,
    codEnabled: true,
  };
  fixture.context = {
    workspaceId: fixture.workspaceA,
    actorUserId: fixture.userA,
    actorMembershipId: fixture.membershipA,
    actorLabel: "Phase 1A Actor",
    requestId: "phase1a-request",
    ipAddress: "127.0.0.1",
    userAgent: "phase1a-test",
  };

  fixtures.push(fixture);
  return fixture;
}

async function sideEffectCounts(workspaceId: string) {
  const result = await pool.query<{ orders: number; audits: number; events: number; timeline: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM orders WHERE workspace_id = $1) AS orders,
       (SELECT COUNT(*)::int FROM audit_logs WHERE workspace_id = $1 AND entity_type = 'order') AS audits,
       (SELECT COUNT(*)::int FROM domain_events WHERE workspace_id = $1 AND event_type = 'order.created') AS events,
       (SELECT COUNT(*)::int FROM contact_timeline WHERE workspace_id = $1 AND event_type = 'order_created') AS timeline`,
    [workspaceId],
  );
  return result.rows[0]!;
}

function failingRepositories(
  method: "insertAuditLog" | "insertDomainEvent" | "insertContactTimeline",
): CreateOrderDraftRepositories {
  if (method === "insertAuditLog") {
    return { ...repositories, insertAuditLog: async () => { throw new Error("FORCED_insertAuditLog"); } };
  }
  if (method === "insertDomainEvent") {
    return { ...repositories, insertDomainEvent: async () => { throw new Error("FORCED_insertDomainEvent"); } };
  }
  return { ...repositories, insertContactTimeline: async () => { throw new Error("FORCED_insertContactTimeline"); } };
}

suite("createOrderDraft atomic PostgreSQL integration", () => {
  it("commits order, audit, domain event and contact timeline together", async () => {
    const fixture = await createFixture();
    let committed = false;
    const connect = async (): Promise<PoolClient> => {
      const client = await pool.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          const result = await client.query(text, values);
          if (text.trim().toUpperCase() === "COMMIT") committed = true;
          return result;
        },
        release: () => client.release(),
      } as PoolClient;
    };

    const result = await createOrderDraft(fixture.input, fixture.context, {
      connect,
      now: () => new Date("2026-06-28T12:00:00.000Z"),
      randomUUID: () => "abcdef12-3456-4789-8abc-def012345678",
    });

    expect(committed).toBe(true);
    expect(result.order.orderNumber).toBe("ORD-20260628-ABCDEF12");
    expect(result.order).toMatchObject({
      status: "Draft",
      paymentStatus: "Unpaid",
      channel: "whatsapp",
      contactId: fixture.contactA,
      conversationId: fixture.conversationA,
      assignedMembershipId: fixture.membershipA,
      totalAmount: "25.00",
      paidAmount: "0.00",
      deliveryType: "local",
      deliveryStatus: "preparing",
      deliveryFee: "25.00",
      codEnabled: true,
    });
    expect(result.realtimeEvent).toMatchObject({
      type: "order.created",
      workspaceId: fixture.workspaceA,
      entityId: result.order.id,
      payload: {
        orderNumber: result.order.orderNumber,
        contactId: fixture.contactA,
        conversationId: fixture.conversationA,
        channel: "whatsapp",
      },
    });
    expect(await sideEffectCounts(fixture.workspaceA)).toEqual({ orders: 1, audits: 1, events: 1, timeline: 1 });

    const order = await pool.query<{ created_by: string }>("SELECT created_by FROM orders WHERE id = $1", [result.order.id]);
    expect(order.rows[0]?.created_by).toBe(fixture.context.actorUserId);

    const audit = await pool.query<{
      actor_type: string;
      actor_id: string;
      actor_label: string;
      request_id: string;
      ip_address: string;
      user_agent: string;
      action: string;
      severity: string;
      entity_label: string;
    }>("SELECT actor_type, actor_id, actor_label, request_id, ip_address, user_agent, action, severity, entity_label FROM audit_logs WHERE entity_id = $1", [result.order.id]);
    expect(audit.rows[0]).toEqual({
      actor_type: "user",
      actor_id: fixture.userA,
      actor_label: "Phase 1A Actor",
      request_id: "phase1a-request",
      ip_address: "127.0.0.1",
      user_agent: "phase1a-test",
      action: "create",
      severity: "info",
      entity_label: result.order.orderNumber,
    });

    const event = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM domain_events WHERE entity_id = $1 AND event_type = 'order.created'",
      [result.order.id],
    );
    expect(event.rows[0]?.payload).toMatchObject({
      orderNumber: result.order.orderNumber,
      status: "Draft",
      contactId: fixture.contactA,
      conversationId: fixture.conversationA,
      channel: "whatsapp",
      actorUserId: fixture.userA,
      actorMembershipId: fixture.membershipA,
    });

    const timeline = await pool.query<{ title: string; created_by: string }>(
      "SELECT title, created_by FROM contact_timeline WHERE entity_id = $1 AND event_type = 'order_created'",
      [result.order.id],
    );
    expect(timeline.rows[0]).toEqual({
      title: `تم إنشاء طلب: ${result.order.orderNumber}`,
      created_by: fixture.userA,
    });
  }, 15_000);

  it("holds reference rows with FOR SHARE until the order transaction commits", async () => {
    const fixture = await createFixture();
    let signalValidationsComplete!: () => void;
    const validationsComplete = new Promise<void>((resolve) => { signalValidationsComplete = resolve; });
    let releaseInsert!: () => void;
    const insertGate = new Promise<void>((resolve) => { releaseInsert = resolve; });

    const lockingRepositories: CreateOrderDraftRepositories = {
      ...repositories,
      insertOrder: async (client, values) => {
        signalValidationsComplete();
        await insertGate;
        return repositories.insertOrder(client, values);
      },
    };

    const commandPromise = createOrderDraft(fixture.input, fixture.context, {
      repositories: lockingRepositories,
    });

    await validationsComplete;
    const concurrentClient = await pool.connect();
    let lockError: unknown;

    try {
      await concurrentClient.query("BEGIN");
      await concurrentClient.query("SET LOCAL lock_timeout = '250ms'");
      try {
        await concurrentClient.query(
          "UPDATE conversations SET contact_id = $1 WHERE id = $2 AND workspace_id = $3",
          [fixture.contactA2, fixture.conversationA, fixture.workspaceA],
        );
      } catch (error) {
        lockError = error;
      }
      expect(lockError).toMatchObject({ code: "55P03" });
    } finally {
      try { await concurrentClient.query("ROLLBACK"); } catch { /* transaction may already be aborted */ }
      concurrentClient.release();
      releaseInsert();
    }

    const result = await commandPromise;
    expect(result.order).toMatchObject({
      contactId: fixture.contactA,
      conversationId: fixture.conversationA,
      assignedMembershipId: fixture.membershipA,
    });
    expect(await sideEffectCounts(fixture.workspaceA)).toEqual({ orders: 1, audits: 1, events: 1, timeline: 1 });

    const conversation = await pool.query<{ contact_id: string }>(
      "SELECT contact_id FROM conversations WHERE id = $1 AND workspace_id = $2",
      [fixture.conversationA, fixture.workspaceA],
    );
    expect(conversation.rows[0]?.contact_id).toBe(fixture.contactA);
  }, 15_000);

  it("rolls back everything when audit insertion fails", async () => {
    const fixture = await createFixture();
    await expect(createOrderDraft(fixture.input, fixture.context, { repositories: failingRepositories("insertAuditLog") }))
      .rejects.toThrow("FORCED_insertAuditLog");
    expect(await sideEffectCounts(fixture.workspaceA)).toEqual({ orders: 0, audits: 0, events: 0, timeline: 0 });
  }, 15_000);

  it("rolls back everything when domain event insertion fails", async () => {
    const fixture = await createFixture();
    await expect(createOrderDraft(fixture.input, fixture.context, { repositories: failingRepositories("insertDomainEvent") }))
      .rejects.toThrow("FORCED_insertDomainEvent");
    expect(await sideEffectCounts(fixture.workspaceA)).toEqual({ orders: 0, audits: 0, events: 0, timeline: 0 });
  }, 15_000);

  it("rolls back everything when contact timeline insertion fails", async () => {
    const fixture = await createFixture();
    await expect(createOrderDraft(fixture.input, fixture.context, { repositories: failingRepositories("insertContactTimeline") }))
      .rejects.toThrow("FORCED_insertContactTimeline");
    expect(await sideEffectCounts(fixture.workspaceA)).toEqual({ orders: 0, audits: 0, events: 0, timeline: 0 });
  }, 15_000);

  it("rejects foreign workspace references without writing anything", async () => {
    const fixture = await createFixture();
    await expect(createOrderDraft({ ...fixture.input, contactId: fixture.contactB }, fixture.context))
      .rejects.toMatchObject({ code: "ORDER_REFERENCE_NOT_FOUND", field: "contactId" });
    await expect(createOrderDraft({ ...fixture.input, sourceMessageId: fixture.messageB }, fixture.context))
      .rejects.toMatchObject({ code: "ORDER_REFERENCE_NOT_FOUND", field: "sourceMessageId" });
    await expect(createOrderDraft({ ...fixture.input, assignedMembershipId: fixture.membershipB }, fixture.context))
      .rejects.toMatchObject({ code: "ORDER_REFERENCE_NOT_FOUND", field: "assignedMembershipId" });
    expect(await sideEffectCounts(fixture.workspaceA)).toEqual({ orders: 0, audits: 0, events: 0, timeline: 0 });
  }, 15_000);

  it("rejects a source message linked to another conversation", async () => {
    const fixture = await createFixture();
    await expect(createOrderDraft({ ...fixture.input, sourceMessageId: fixture.messageA2 }, fixture.context))
      .rejects.toMatchObject({ code: "ORDER_REFERENCE_CONFLICT", field: "sourceMessageId" });
    expect(await sideEffectCounts(fixture.workspaceA)).toEqual({ orders: 0, audits: 0, events: 0, timeline: 0 });
  }, 15_000);

  it("rejects a conversation linked to another contact", async () => {
    const fixture = await createFixture();
    await expect(createOrderDraft({ ...fixture.input, conversationId: fixture.conversationA2, sourceMessageId: null }, fixture.context))
      .rejects.toMatchObject({ code: "ORDER_REFERENCE_CONFLICT", field: "conversationId" });
    expect(await sideEffectCounts(fixture.workspaceA)).toEqual({ orders: 0, audits: 0, events: 0, timeline: 0 });
  }, 15_000);

  it("rejects an opportunity linked to another contact", async () => {
    const fixture = await createFixture();
    await expect(createOrderDraft({ ...fixture.input, opportunityId: fixture.opportunityA2 }, fixture.context))
      .rejects.toMatchObject({ code: "ORDER_REFERENCE_CONFLICT", field: "opportunityId" });
    expect(await sideEffectCounts(fixture.workspaceA)).toEqual({ orders: 0, audits: 0, events: 0, timeline: 0 });
  }, 15_000);
});
