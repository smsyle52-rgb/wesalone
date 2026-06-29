import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  sqlCreateOrderDraftRepositories,
  type CreateOrderDraftRepositories,
  type OrderDraftRecord,
  type PoolClient,
} from "./create-order-draft.repositories";

export interface CreateOrderDraftInput {
  contactId?: string | null;
  conversationId?: string | null;
  opportunityId?: string | null;
  sourceMessageId?: string | null;
  assignedMembershipId?: string | null;
  channel: "manual" | "whatsapp" | "phone" | "website" | "walk_in";
  currency: "YER" | "SAR" | "USD";
  discount: number;
  notes?: string | null;
  deliveryType: "pickup" | "local" | "shipping";
  deliveryAgentPhone?: string | null;
  carrierName?: string | null;
  carrierPhone?: string | null;
  deliveryReceiptUrl?: string | null;
  deliveryAddress?: string | null;
  deliveryFee: number;
  codEnabled: boolean;
}

export interface CommerceCommandContext {
  workspaceId: string;
  actorUserId: string;
  actorMembershipId: string;
  actorLabel: string;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export type OrderReferenceField = "workspaceId" | "contactId" | "conversationId" | "opportunityId" | "sourceMessageId" | "assignedMembershipId";

export class OrderReferenceNotFoundError extends Error {
  readonly code = "ORDER_REFERENCE_NOT_FOUND";
  constructor(readonly field: OrderReferenceField) {
    super("Order reference was not found in the active workspace");
    this.name = "OrderReferenceNotFoundError";
  }
}

export class OrderReferenceConflictError extends Error {
  readonly code = "ORDER_REFERENCE_CONFLICT";
  constructor(readonly field: OrderReferenceField) {
    super("Order references are not compatible");
    this.name = "OrderReferenceConflictError";
  }
}

export interface OrderCreatedRealtimeDescriptor {
  workspaceId: string;
  type: "order.created";
  entityType: "order";
  entityId: string;
  payload: {
    orderNumber: string;
    contactId: string | null;
    conversationId: string | null;
    channel: CreateOrderDraftInput["channel"];
  };
}

export interface CreateOrderDraftResult {
  order: OrderDraftRecord;
  realtimeEvent: OrderCreatedRealtimeDescriptor;
}

export interface CreateOrderDraftDependencies {
  connect(): Promise<PoolClient>;
  repositories: CreateOrderDraftRepositories;
  now(): Date;
  randomUUID(): string;
}

const defaultDependencies: CreateOrderDraftDependencies = {
  connect: () => pool.connect(),
  repositories: sqlCreateOrderDraftRepositories,
  now: () => new Date(),
  randomUUID,
};

function orderNumber(now: Date, uuid: string): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `ORD-${date}-${uuid.slice(0, 8).toUpperCase()}`;
}

async function validateReferences(client: PoolClient, repositories: CreateOrderDraftRepositories, input: CreateOrderDraftInput, context: CommerceCommandContext): Promise<void> {
  if (!(await repositories.workspaceExists(client, context.workspaceId))) throw new OrderReferenceNotFoundError("workspaceId");
  if (input.contactId && !(await repositories.findContact(client, context.workspaceId, input.contactId))) throw new OrderReferenceNotFoundError("contactId");

  if (input.conversationId) {
    const conversation = await repositories.findConversation(client, context.workspaceId, input.conversationId);
    if (!conversation) throw new OrderReferenceNotFoundError("conversationId");
    if (input.contactId && conversation.contactId && conversation.contactId !== input.contactId) throw new OrderReferenceConflictError("conversationId");
  }

  if (input.opportunityId) {
    const opportunity = await repositories.findOpportunity(client, context.workspaceId, input.opportunityId);
    if (!opportunity) throw new OrderReferenceNotFoundError("opportunityId");
    if (input.contactId && opportunity.contactId && opportunity.contactId !== input.contactId) throw new OrderReferenceConflictError("opportunityId");
  }

  if (input.sourceMessageId) {
    if (!input.conversationId) throw new OrderReferenceConflictError("sourceMessageId");
    const sourceMessage = await repositories.findSourceMessage(client, context.workspaceId, input.sourceMessageId);
    if (!sourceMessage) throw new OrderReferenceNotFoundError("sourceMessageId");
    if (sourceMessage.conversationId !== input.conversationId) throw new OrderReferenceConflictError("sourceMessageId");
  }

  if (input.assignedMembershipId && !(await repositories.findMembership(client, context.workspaceId, input.assignedMembershipId))) {
    throw new OrderReferenceNotFoundError("assignedMembershipId");
  }
}

export async function createOrderDraft(input: CreateOrderDraftInput, context: CommerceCommandContext, dependencyOverrides: Partial<CreateOrderDraftDependencies> = {}): Promise<CreateOrderDraftResult> {
  const dependencies: CreateOrderDraftDependencies = { ...defaultDependencies, ...dependencyOverrides };
  const client = await dependencies.connect();
  let committed = false;

  try {
    await client.query("BEGIN");
    await validateReferences(client, dependencies.repositories, input, context);

    const generatedOrderNumber = orderNumber(dependencies.now(), dependencies.randomUUID());
    const order = await dependencies.repositories.insertOrder(client, {
      workspaceId: context.workspaceId,
      orderNumber: generatedOrderNumber,
      channel: input.channel,
      contactId: input.contactId ?? null,
      conversationId: input.conversationId ?? null,
      opportunityId: input.opportunityId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      assignedMembershipId: input.assignedMembershipId ?? null,
      deliveryFee: input.deliveryFee,
      discount: input.discount,
      currency: input.currency,
      notes: input.notes ?? null,
      deliveryType: input.deliveryType,
      deliveryAgentPhone: input.deliveryAgentPhone ?? null,
      carrierName: input.carrierName ?? null,
      carrierPhone: input.carrierPhone ?? null,
      deliveryReceiptUrl: input.deliveryReceiptUrl ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      codEnabled: input.codEnabled,
      createdBy: context.actorUserId,
    });

    await dependencies.repositories.insertAuditLog(client, {
      workspaceId: context.workspaceId,
      actorId: context.actorUserId,
      actorLabel: context.actorLabel,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      entityId: order.id,
      entityLabel: order.orderNumber,
      newData: {
        status: "Draft",
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        assignedMembershipId: input.assignedMembershipId ?? null,
      },
    });

    await dependencies.repositories.insertDomainEvent(client, {
      workspaceId: context.workspaceId,
      entityId: order.id,
      payload: {
        orderNumber: order.orderNumber,
        status: "Draft",
        contactId: input.contactId ?? null,
        conversationId: input.conversationId ?? null,
        channel: input.channel,
        actorUserId: context.actorUserId,
        actorMembershipId: context.actorMembershipId,
      },
    });

    if (input.contactId) {
      await dependencies.repositories.insertContactTimeline(client, {
        workspaceId: context.workspaceId,
        contactId: input.contactId,
        entityId: order.id,
        orderNumber: order.orderNumber,
        createdBy: context.actorUserId,
      });
    }

    await client.query("COMMIT");
    committed = true;
    return {
      order,
      realtimeEvent: {
        workspaceId: context.workspaceId,
        type: "order.created",
        entityType: "order",
        entityId: order.id,
        payload: {
          orderNumber: order.orderNumber,
          contactId: input.contactId ?? null,
          conversationId: input.conversationId ?? null,
          channel: input.channel,
        },
      },
    };
  } catch (error) {
    if (!committed) {
      try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    }
    throw error;
  } finally {
    client.release();
  }
}
