import { boolean, index, pgTable, text, timestamp, numeric, uuid, jsonb } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

export const ordersTable = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    orderNumber: text("order_number").notNull(),
    status: text("status").notNull().default("new"),
    channel: text("channel").notNull().default("manual"),
    contactId: uuid("contact_id").references(() => contactsTable.id),
    conversationId: uuid("conversation_id").references(() => conversationsTable.id),
    opportunityId: uuid("opportunity_id"),
    sourceMessageId: uuid("source_message_id"),
    assignedMembershipId: uuid("assigned_membership_id"),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("YER"),
    notes: text("notes"),
    cancelReason: text("cancel_reason"),
    returnedReason: text("returned_reason"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    // النطاق 11 (توسعة التوصيل): نوع التسليم وحالته + بيانات المندوب/مكتب النقل + السند + الرسوم + الدفع عند الاستلام
    deliveryType: text("delivery_type").notNull().default("pickup"), // pickup | local | shipping
    deliveryStatus: text("delivery_status"), // preparing | ready | out_for_delivery | handed_to_carrier | delivered (null = لا توصيل بعد)
    deliveryAgentPhone: text("delivery_agent_phone"), // رقم مندوب التوصيل الداخلي
    carrierName: text("carrier_name"), // اسم مكتب النقل (خارج المدينة)
    carrierPhone: text("carrier_phone"), // رقم مكتب النقل
    deliveryReceiptUrl: text("delivery_receipt_url"), // رابط صورة سند الشحن
    deliveryAddress: text("delivery_address"), // عنوان التوصيل
    deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 }).notNull().default("0"), // رسوم التوصيل (تُضاف للإجمالي)
    codEnabled: boolean("cod_enabled").notNull().default(false), // الدفع عند الاستلام مفعّل
    items: jsonb("items"),
    createdBy: uuid("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_orders_ws_status").on(table.workspaceId, table.status)],
);

export type Order = typeof ordersTable.$inferSelect;
export type InsertOrder = typeof ordersTable.$inferInsert;
