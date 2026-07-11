import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { channelAccountsTable } from "./conversations";

// مزامنة ميتا — الطور 3ب (11 يوليو 2026): جدول staging بحت لسجل دردشة واتساب القديم
// (حتى ~6 أشهر) الذي يصل عبر Coexistence webhook بعد موافقة التاجر أثناء embedded
// signup (انظر handleHistoryEvent في meta.routes.ts). لا عَلاقة له بجداول المحادثات
// الحيّة (conversations/messages) ولا يُقرأ منها أو يُكتب إليها إطلاقاً — يُقرأ فقط من
// منجم outbox-worker/agent-learning.ts (mineHistoryAnswers) نحو learned_answers.
export const waHistoryMessagesTable = pgTable(
  "wa_history_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
    channelAccountId: uuid("channel_account_id").references(() => channelAccountsTable.id, { onDelete: "set null" }),
    customerWaId: text("customer_wa_id").notNull(),
    externalMessageId: text("external_message_id").notNull(),
    // 'inbound' = من العميل، 'outbound' = من التاجر/الوكيل (انظر اشتقاق الاتجاه في meta-history-ingest.ts)
    direction: text("direction").notNull(),
    messageType: text("message_type"),
    content: text("content"),
    messageTimestamp: timestamp("message_timestamp", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    minedAt: timestamp("mined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // إزالة التكرار عبر دفعات history المُعاد إرسالها من ميتا (نفس الرسالة قد تصل أكثر من مرة).
    uniqueIndex("uq_wa_history_messages_ws_external").on(table.workspaceId, table.externalMessageId),
    index("idx_wa_history_messages_ws_customer").on(table.workspaceId, table.customerWaId, table.messageTimestamp),
    // ملاحظة: الفهرس الجزئي (WHERE mined_at IS NULL) لخدمة المنجم مُعرَّف في
    // scripts/migrate-phase345.sql فقط — بنفس نمط فهارس channel_accounts الجزئية
    // الموجودة أصلاً هناك بلا مقابل في طبقة Drizzle.
  ],
);

export type WaHistoryMessage = typeof waHistoryMessagesTable.$inferSelect;
export type InsertWaHistoryMessage = typeof waHistoryMessagesTable.$inferInsert;
