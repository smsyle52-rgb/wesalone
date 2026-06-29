export type PoolClient = import("pg").PoolClient;

export interface OrderDraftRecord {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  channel: string;
  contactId: string | null;
  conversationId: string | null;
  assignedMembershipId: string | null;
  totalAmount: string;
  paidAmount: string;
  discount: string;
  currency: string;
  notes: string | null;
  deliveryType: string;
  deliveryStatus: string | null;
  deliveryFee: string;
  codEnabled: boolean;
  createdAt: Date;
}

export interface CreateOrderDraftRepositories {
  workspaceExists(client: PoolClient, workspaceId: string): Promise<boolean>;
  findContact(client: PoolClient, workspaceId: string, contactId: string): Promise<{ id: string } | null>;
  findConversation(
    client: PoolClient,
    workspaceId: string,
    conversationId: string,
  ): Promise<{ id: string; contactId: string | null } | null>;
  findOpportunity(
    client: PoolClient,
    workspaceId: string,
    opportunityId: string,
  ): Promise<{ id: string; contactId: string | null } | null>;
  findSourceMessage(
    client: PoolClient,
    workspaceId: string,
    sourceMessageId: string,
  ): Promise<{ id: string; conversationId: string } | null>;
  findMembership(
    client: PoolClient,
    workspaceId: string,
    membershipId: string,
  ): Promise<{ id: string } | null>;
  insertOrder(client: PoolClient, values: InsertOrderDraftValues): Promise<OrderDraftRecord>;
  insertAuditLog(client: PoolClient, values: InsertOrderAuditValues): Promise<void>;
  insertDomainEvent(client: PoolClient, values: InsertOrderDomainEventValues): Promise<void>;
  insertContactTimeline(client: PoolClient, values: InsertOrderTimelineValues): Promise<void>;
}

export interface InsertOrderDraftValues {
  workspaceId: string;
  orderNumber: string;
  channel: string;
  contactId: string | null;
  conversationId: string | null;
  opportunityId: string | null;
  sourceMessageId: string | null;
  assignedMembershipId: string | null;
  deliveryFee: number;
  discount: number;
  currency: "YER" | "SAR" | "USD";
  notes: string | null;
  deliveryType: "pickup" | "local" | "shipping";
  deliveryAgentPhone: string | null;
  carrierName: string | null;
  carrierPhone: string | null;
  deliveryReceiptUrl: string | null;
  deliveryAddress: string | null;
  codEnabled: boolean;
  createdBy: string;
}

export interface InsertOrderAuditValues {
  workspaceId: string;
  actorId: string;
  actorLabel: string;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  entityId: string;
  entityLabel: string;
  newData: Record<string, unknown>;
}

export interface InsertOrderDomainEventValues {
  workspaceId: string;
  entityId: string;
  payload: Record<string, unknown>;
}

export interface InsertOrderTimelineValues {
  workspaceId: string;
  contactId: string;
  entityId: string;
  orderNumber: string;
  createdBy: string;
}

export const sqlCreateOrderDraftRepositories: CreateOrderDraftRepositories = {
  async workspaceExists(client, workspaceId) {
    const result = await client.query("SELECT id FROM workspaces WHERE id = $1 LIMIT 1 FOR SHARE", [workspaceId]);
    return Boolean(result.rowCount);
  },

  async findContact(client, workspaceId, contactId) {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2 LIMIT 1 FOR SHARE",
      [contactId, workspaceId],
    );
    return result.rows[0] ?? null;
  },

  async findConversation(client, workspaceId, conversationId) {
    const result = await client.query<{ id: string; contact_id: string | null }>(
      "SELECT id, contact_id FROM conversations WHERE id = $1 AND workspace_id = $2 LIMIT 1 FOR SHARE",
      [conversationId, workspaceId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, contactId: row.contact_id } : null;
  },

  async findOpportunity(client, workspaceId, opportunityId) {
    const result = await client.query<{ id: string; contact_id: string | null }>(
      "SELECT id, contact_id FROM opportunities WHERE id = $1 AND workspace_id = $2 LIMIT 1 FOR SHARE",
      [opportunityId, workspaceId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, contactId: row.contact_id } : null;
  },

  async findSourceMessage(client, workspaceId, sourceMessageId) {
    const result = await client.query<{ id: string; conversation_id: string }>(
      "SELECT id, conversation_id FROM messages WHERE id = $1 AND workspace_id = $2 LIMIT 1 FOR SHARE",
      [sourceMessageId, workspaceId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, conversationId: row.conversation_id } : null;
  },

  async findMembership(client, workspaceId, membershipId) {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM workspace_memberships WHERE id = $1 AND workspace_id = $2 LIMIT 1 FOR SHARE",
      [membershipId, workspaceId],
    );
    return result.rows[0] ?? null;
  },

  async insertOrder(client, values) {
    const result = await client.query<OrderDraftRecord>(
      `INSERT INTO orders
       (workspace_id, order_number, status, payment_status, channel, contact_id, conversation_id,
        opportunity_id, source_message_id, assigned_membership_id, total_amount, paid_amount,
        discount, currency, notes, delivery_type, delivery_status, delivery_agent_phone,
        carrier_name, carrier_phone, delivery_receipt_url, delivery_address, delivery_fee,
        cod_enabled, created_by)
       VALUES ($1,$2,'Draft','Unpaid',$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id, order_number AS "orderNumber", status, payment_status AS "paymentStatus",
                 channel, contact_id AS "contactId", conversation_id AS "conversationId",
                 assigned_membership_id AS "assignedMembershipId", total_amount AS "totalAmount",
                 paid_amount AS "paidAmount", discount, currency, notes,
                 delivery_type AS "deliveryType", delivery_status AS "deliveryStatus",
                 delivery_fee AS "deliveryFee", cod_enabled AS "codEnabled", created_at AS "createdAt"`,
      [
        values.workspaceId,
        values.orderNumber,
        values.channel,
        values.contactId,
        values.conversationId,
        values.opportunityId,
        values.sourceMessageId,
        values.assignedMembershipId,
        values.deliveryFee,
        values.discount,
        values.currency,
        values.notes,
        values.deliveryType,
        values.deliveryType === "pickup" ? null : "preparing",
        values.deliveryAgentPhone,
        values.carrierName,
        values.carrierPhone,
        values.deliveryReceiptUrl,
        values.deliveryAddress,
        values.deliveryFee,
        values.codEnabled,
        values.createdBy,
      ],
    );
    const order = result.rows[0];
    if (!order) throw new Error("ORDER_INSERT_FAILED");
    return order;
  },

  async insertAuditLog(client, values) {
    await client.query(
      `INSERT INTO audit_logs
       (workspace_id, actor_type, actor_id, actor_label, action, severity, entity_type,
        entity_id, entity_label, new_data, request_id, ip_address, user_agent)
       VALUES ($1,'user',$2,$3,'create','info','order',$4,$5,$6,$7,$8,$9)`,
      [
        values.workspaceId,
        values.actorId,
        values.actorLabel,
        values.entityId,
        values.entityLabel,
        values.newData,
        values.requestId,
        values.ipAddress,
        values.userAgent,
      ],
    );
  },

  async insertDomainEvent(client, values) {
    await client.query(
      `INSERT INTO domain_events (workspace_id, event_type, entity_type, entity_id, payload)
       VALUES ($1,'order.created','order',$2,$3)`,
      [values.workspaceId, values.entityId, values.payload],
    );
  },

  async insertContactTimeline(client, values) {
    await client.query(
      `INSERT INTO contact_timeline
       (workspace_id, contact_id, event_type, entity_type, entity_id, title, created_by)
       VALUES ($1,$2,'order_created','order',$3,$4,$5)`,
      [
        values.workspaceId,
        values.contactId,
        values.entityId,
        `تم إنشاء طلب: ${values.orderNumber}`,
        values.createdBy,
      ],
    );
  },
};
