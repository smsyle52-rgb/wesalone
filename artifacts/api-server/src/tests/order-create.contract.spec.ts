import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrderDraft: vi.fn(),
  emitWorkspaceEvent: vi.fn(),
  warn: vi.fn(),
  session: {
    userId: "11111111-1111-4111-8111-111111111111",
    activeWorkspaceId: "22222222-2222-4222-8222-222222222222",
    activeMembershipId: "33333333-3333-4333-8333-333333333333",
    permissions: ["orders:create"],
    roleSlugs: ["owner"],
    name: "Route Actor",
    email: "route@example.test",
  },
}));

vi.mock("../middlewares/requireSession", () => ({
  requireSession: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.sessionUser = mocks.session;
    req.id = "route-request-id";
    next();
  },
}));

vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/events", () => ({ emitWorkspaceEvent: mocks.emitWorkspaceEvent }));
vi.mock("../lib/logger", () => ({ logger: { warn: mocks.warn } }));

vi.mock("../modules/commerce/application/create-order-draft", () => {
  class OrderReferenceNotFoundError extends Error {
    readonly code = "ORDER_REFERENCE_NOT_FOUND";
    constructor(readonly field: string) {
      super("not found");
      this.name = "OrderReferenceNotFoundError";
    }
  }
  class OrderReferenceConflictError extends Error {
    readonly code = "ORDER_REFERENCE_CONFLICT";
    constructor(readonly field: string) {
      super("conflict");
      this.name = "OrderReferenceConflictError";
    }
  }
  return {
    createOrderDraft: mocks.createOrderDraft,
    OrderReferenceNotFoundError,
    OrderReferenceConflictError,
  };
});

import orderCreateRouter from "../modules/commerce/order-create.routes";
import { OrderReferenceConflictError, OrderReferenceNotFoundError } from "../modules/commerce/application/create-order-draft";

const responseOrder = {
  id: "44444444-4444-4444-8444-444444444444",
  orderNumber: "ORD-20260628-ABCDEF12",
  status: "Draft",
  paymentStatus: "Unpaid",
  channel: "whatsapp",
  contactId: "55555555-5555-4555-8555-555555555555",
  conversationId: "66666666-6666-4666-8666-666666666666",
  assignedMembershipId: "33333333-3333-4333-8333-333333333333",
  totalAmount: "25.00",
  paidAmount: "0.00",
  discount: "0.00",
  currency: "YER",
  notes: "Inbox order",
  deliveryType: "local",
  deliveryStatus: "preparing",
  deliveryFee: "25.00",
  codEnabled: true,
  createdAt: "2026-06-28T12:00:00.000Z",
};

const realtimeEvent = {
  workspaceId: mocks.session.activeWorkspaceId,
  type: "order.created",
  entityType: "order",
  entityId: responseOrder.id,
  payload: {
    orderNumber: responseOrder.orderNumber,
    contactId: responseOrder.contactId,
    conversationId: responseOrder.conversationId,
    channel: responseOrder.channel,
  },
};

async function postOrder(body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use("/orders", orderCreateRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "route-contract-test",
        "x-request-id": "header-request-id",
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    });
  }
}

beforeEach(() => {
  mocks.createOrderDraft.mockReset();
  mocks.emitWorkspaceEvent.mockReset();
  mocks.warn.mockReset();
  mocks.createOrderDraft.mockResolvedValue({ order: responseOrder, realtimeEvent });
});

afterEach(() => { vi.clearAllMocks(); });

describe("POST /orders contract", () => {
  it("preserves 201, the exact response envelope and Inbox linkage fields", async () => {
    const response = await postOrder({
      contactId: responseOrder.contactId,
      conversationId: responseOrder.conversationId,
      assignedMembershipId: responseOrder.assignedMembershipId,
      channel: "whatsapp",
      currency: "YER",
      notes: "Inbox order",
      deliveryType: "local",
      deliveryFee: 25,
      codEnabled: true,
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ order: responseOrder });
    expect(response.body).not.toHaveProperty("idempotencyKey");
    expect(response.body).not.toHaveProperty("idempotency");
    expect(mocks.createOrderDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: responseOrder.contactId,
        conversationId: responseOrder.conversationId,
        channel: "whatsapp",
      }),
      expect.objectContaining({
        workspaceId: mocks.session.activeWorkspaceId,
        actorUserId: mocks.session.userId,
        actorMembershipId: mocks.session.activeMembershipId,
        actorLabel: mocks.session.name,
        requestId: "header-request-id",
        userAgent: "route-contract-test",
      }),
    );
    expect(mocks.emitWorkspaceEvent).toHaveBeenCalledWith(realtimeEvent);
  });

  it("does not emit realtime until the atomic command resolves", async () => {
    let resolveCommand!: (value: { order: typeof responseOrder; realtimeEvent: typeof realtimeEvent }) => void;
    mocks.createOrderDraft.mockImplementation(() => new Promise((resolve) => { resolveCommand = resolve; }));

    const responsePromise = postOrder({
      contactId: responseOrder.contactId,
      conversationId: responseOrder.conversationId,
      channel: "whatsapp",
    });

    await vi.waitFor(() => {
      expect(mocks.createOrderDraft).toHaveBeenCalledTimes(1);
    });
    expect(mocks.emitWorkspaceEvent).not.toHaveBeenCalled();
    resolveCommand({ order: responseOrder, realtimeEvent });
    const response = await responsePromise;
    expect(response.status).toBe(201);
    expect(mocks.emitWorkspaceEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful response when realtime emission fails after commit", async () => {
    mocks.emitWorkspaceEvent.mockImplementation(() => { throw new Error("realtime unavailable"); });
    const response = await postOrder({ channel: "manual" });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ order: responseOrder });
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for invalid payloads without invoking the command", async () => {
    const response = await postOrder({ channel: "invalid-channel" });
    expect(response.status).toBe(400);
    expect(mocks.createOrderDraft).not.toHaveBeenCalled();
  });

  it("returns 404 for missing or foreign references", async () => {
    mocks.createOrderDraft.mockRejectedValue(new OrderReferenceNotFoundError("sourceMessageId"));
    const response = await postOrder({ channel: "whatsapp" });
    expect(response).toEqual({
      status: 404,
      body: {
        error: "أحد المراجع لا ينتمي لمساحة العمل",
        code: "ORDER_REFERENCE_NOT_FOUND",
        field: "sourceMessageId",
      },
    });
  });

  it("returns 409 ORDER_REFERENCE_CONFLICT for incompatible relationships", async () => {
    mocks.createOrderDraft.mockRejectedValue(new OrderReferenceConflictError("conversationId"));
    const response = await postOrder({ channel: "whatsapp" });
    expect(response).toEqual({
      status: 409,
      body: {
        error: "مراجع الطلب غير متوافقة",
        code: "ORDER_REFERENCE_CONFLICT",
        field: "conversationId",
      },
    });
  });
});
