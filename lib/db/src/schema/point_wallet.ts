import {
  pgTable, text, timestamp, uuid, bigint, integer, jsonb, index, boolean,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";
import { usersTable } from "./users";

// محفظة واحدة لكل workspace — الرصيد يُحسب من grants لا من عمود ثابت
export const pointWalletsTable = pgTable("point_wallets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").unique().notNull().references(() => workspacesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"), // active | frozen | suspended
  version: integer("version").notNull().default(0),   // optimistic lock للمستقبل
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// كتالوج حزم الشحن — قابل للتعديل إدارياً
export const pointTopupProductsTable = pgTable("point_topup_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").unique().notNull(),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  descriptionAr: text("description_ar"),
  descriptionEn: text("description_en"),
  points: integer("points").notNull(),           // نقاط مرئية (5000 / 20000 / 50000)
  priceCents: integer("price_cents").notNull(),  // السعر بالسنت USD
  currency: text("currency").notNull().default("USD"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  allowedPlanSlugs: text("allowed_plan_slugs").array().notNull().default([]), // فارغ = كل المدفوعة
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// منحة رصيد مستقلة — كل شحنة أو منحة شهرية grant منفصل
// originalMicroPoints / remainingMicroPoints: BIGINT — 1 نقطة مرئية = 1,000,000 micro
export const pointGrantsTable = pgTable("point_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "restrict" }),
  walletId: uuid("wallet_id").notNull().references(() => pointWalletsTable.id),
  grantType: text("grant_type").notNull(),
  // monthly_subscription | purchased | admin_adjustment | refund | promotional
  originalMicroPoints: bigint("original_micro_points", { mode: "bigint" }).notNull(),
  remainingMicroPoints: bigint("remaining_micro_points", { mode: "bigint" }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }), // null = لا ينتهي (الباقة الشهرية)
  status: text("status").notNull().default("active"),
  // active | exhausted | expired | frozen | reversed
  sourceType: text("source_type"), // point_purchase_order | subscription | admin | system
  sourceId: text("source_id"),
  idempotencyKey: text("idempotency_key").unique().notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_point_grants_ws_status").on(table.workspaceId, table.status),
  index("idx_point_grants_ws_expires").on(table.workspaceId, table.expiresAt),
  index("idx_point_grants_wallet").on(table.walletId),
]);

// أمر شراء نقاط — دورة حياة كاملة من إنشاء حتى اعتماد
export const pointPurchaseOrdersTable = pgTable("point_purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "restrict" }),
  topupProductId: uuid("topup_product_id").notNull().references(() => pointTopupProductsTable.id),
  // snapshots — لا تتأثر بتغيير الحزمة لاحقاً
  productSlugSnapshot: text("product_slug_snapshot").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  pointsSnapshot: integer("points_snapshot").notNull(),
  priceCentsSnapshot: integer("price_cents_snapshot").notNull(),
  currencySnapshot: text("currency_snapshot").notNull().default("USD"),
  // دورة الحالة
  status: text("status").notNull().default("pending_payment"),
  // pending_payment | under_review | approved | rejected | expired | cancelled | refunded | chargeback
  // إثبات الدفع: يُقدَّم عبر payment_submissions بـsubmission_type='point_topup'
  // اعتماد / رفض
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => usersTable.id),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedBy: uuid("rejected_by").references(() => usersTable.id),
  rejectionReason: text("rejection_reason"),
  // مرجع الـgrant المُنشأ عند الاعتماد (exactly-once guard)
  creditedGrantId: uuid("credited_grant_id").references(() => pointGrantsTable.id),
  // ما دفعه العميل فعلاً (يُملأ عند submitPaymentProof)
  paidAmountMinor: text("paid_amount_minor"),  // مبلغ بالوحدات الصغرى كـstring آمن
  paidCurrency: text("paid_currency"),          // رمز ISO (YER, USD, SAR …)
  // الاسترداد
  // full_refund | partial_refund | points_reversal | chargeback
  refundType: text("refund_type"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  refundedBy: uuid("refunded_by").references(() => usersTable.id),
  refundedAmountMinor: text("refunded_amount_minor"),  // المبلغ المُستردّ كـstring
  refundedCurrency: text("refunded_currency"),
  refundReason: text("refund_reason"),
  refundIdempotencyKey: text("refund_idempotency_key").unique(),
  idempotencyKey: text("idempotency_key").unique().notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_point_purchase_orders_ws_status").on(table.workspaceId, table.status),
  index("idx_point_purchase_orders_status_created").on(table.status, table.createdAt),
]);

// سجل مالي غير قابل للتعديل المباشر — التصحيح بحركة عكسية جديدة فقط
export const pointLedgerTable = pgTable("point_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspacesTable.id, { onDelete: "restrict" }),
  walletId: uuid("wallet_id").notNull().references(() => pointWalletsTable.id),
  grantId: uuid("grant_id").references(() => pointGrantsTable.id),
  transactionType: text("transaction_type").notNull(),
  // credit | debit | expiration | reversal | refund | admin_adjustment
  microPoints: bigint("micro_points", { mode: "bigint" }).notNull(), // موجب=إضافة، سالب=خصم
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  idempotencyKey: text("idempotency_key").unique().notNull(),
  reason: text("reason"),
  actorType: text("actor_type"), // user | system | admin | webhook
  actorId: text("actor_id"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_point_ledger_ws_created").on(table.workspaceId, table.createdAt),
  index("idx_point_ledger_wallet").on(table.walletId),
  index("idx_point_ledger_grant").on(table.grantId),
]);

export type PointWallet = typeof pointWalletsTable.$inferSelect;
export type PointTopupProduct = typeof pointTopupProductsTable.$inferSelect;
export type PointGrant = typeof pointGrantsTable.$inferSelect;
export type PointPurchaseOrder = typeof pointPurchaseOrdersTable.$inferSelect;
export type PointLedgerEntry = typeof pointLedgerTable.$inferSelect;
