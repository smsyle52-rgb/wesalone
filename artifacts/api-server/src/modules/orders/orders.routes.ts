import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, count, sum, ilike } from "drizzle-orm";
import { db, ordersTable, orderItemsTable, contactsTable, conversationsTable, opportunitiesTable, paymentsTable } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { addContactTimeline } from "../../lib/contactTimeline";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

const ORDER_TRANSITIONS: Record<string, string[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: ["returned"],
  returned: [],
  cancelled: [],
};

const STATUS_LABELS: Record<string, string> = {
  new: "جديد", confirmed: "مؤكد", processing: "قيد المعالجة",
  ready: "جاهز", delivered: "تم التسليم", returned: "مُرتجع", cancelled: "ملغي",
};

function derivePaymentStatus(total: number, paid: number): "unpaid" | "partial" | "paid" {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

async function recalcTotal(orderId: string, workspaceId: string): Promise<string> {
  const [{ itemsSum }] = await db.select({ itemsSum: sum(orderItemsTable.total) })
    .from(orderItemsTable)
    .where(and(eq(orderItemsTable.orderId, orderId), eq(orderItemsTable.workspaceId, workspaceId)));
  const [ord] = await db.select({ discount: ordersTable.discount, paidAmount: ordersTable.paidAmount })
    .from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  const total = Math.max(0, Number(itemsSum ?? 0) - Number(ord?.discount ?? 0));
  const paidAmount = Number(ord?.paidAmount ?? 0);
  const paymentStatus = derivePaymentStatus(total, paidAmount);
  await db.update(ordersTable)
    .set({ totalAmount: String(total), paymentStatus, updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));
  return String(total);
}

const createSchema = z.object({
  contactId: z.string().uuid("معرّف العميل غير صحيح").optional(),
  conversationId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  sourceMessageId: z.string().uuid().optional(),
  assignedMembershipId: z.string().uuid().optional(),
  channel: z.enum(["manual", "whatsapp", "phone", "website", "walk_in"]).default("manual"),
  currency: z.enum(["YER", "SAR", "USD"]).default("YER"),
  discount: z.number().min(0).default(0),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  channel: z.enum(["manual", "whatsapp", "phone", "website", "walk_in"]).optional(),
  currency: z.enum(["YER", "SAR", "USD"]).optional(),
  assignedMembershipId: z.string().uuid().optional().nullable(),
  discount: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
});

const statusSchema = z.object({
  status: z.enum(["new", "confirmed", "processing", "ready", "delivered", "returned", "cancelled"]),
  cancelReason: z.string().optional(),
  returnedReason: z.string().optional(),
});

const itemSchema = z.object({
  name: z.string().min(1, "اسم البند مطلوب"),
  description: z.string().optional(),
  quantity: z.number().int().min(1, "الكمية يجب أن تكون 1 على الأقل"),
  unitPrice: z.number().min(0, "السعر يجب أن يكون 0 أو أكثر"),
  currency: z.enum(["YER", "SAR", "USD"]).optional(),
});

// GET /api/orders
router.get("/", requirePermission("orders:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const statusFilter = req.query.status as string | undefined;
  const channelFilter = req.query.channel as string | undefined;
  const contactFilter = req.query.contactId as string | undefined;
  const searchFilter = req.query.search as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const conditions = [eq(ordersTable.workspaceId, activeWorkspaceId)];
  if (statusFilter) conditions.push(eq(ordersTable.status, statusFilter));
  if (channelFilter) conditions.push(eq(ordersTable.channel, channelFilter));
  if (contactFilter) conditions.push(eq(ordersTable.contactId, contactFilter));
  if (searchFilter) conditions.push(ilike(ordersTable.orderNumber, `%${searchFilter}%`));

  const [orders, [{ total }], countRows] = await Promise.all([
    db.select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status,
      channel: ordersTable.channel, totalAmount: ordersTable.totalAmount, paidAmount: ordersTable.paidAmount,
      discount: ordersTable.discount, currency: ordersTable.currency, notes: ordersTable.notes,
      contactId: ordersTable.contactId, conversationId: ordersTable.conversationId,
      opportunityId: ordersTable.opportunityId, confirmedAt: ordersTable.confirmedAt,
      deliveredAt: ordersTable.deliveredAt, cancelledAt: ordersTable.cancelledAt,
      returnedAt: ordersTable.returnedAt, cancelReason: ordersTable.cancelReason,
      returnedReason: ordersTable.returnedReason, createdAt: ordersTable.createdAt,
      updatedAt: ordersTable.updatedAt, contactName: contactsTable.name, contactPhone: contactsTable.phone,
    })
      .from(ordersTable)
      .leftJoin(contactsTable, eq(ordersTable.contactId, contactsTable.id))
      .where(and(...conditions))
      .orderBy(desc(ordersTable.createdAt))
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(ordersTable).where(and(...conditions)),
    db.select({ status: ordersTable.status, cnt: count() })
      .from(ordersTable).where(eq(ordersTable.workspaceId, activeWorkspaceId)).groupBy(ordersTable.status),
  ]);

  const counts: Record<string, number> = {};
  for (const row of countRows) counts[row.status] = Number(row.cnt);

  res.json({ orders, total: Number(total), counts });
});

// POST /api/orders
router.post("/", requirePermission("orders:create"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId, userId } = req.sessionUser;

  let contact: { id: string; name: string } | undefined;
  if (parsed.data.contactId) {
    const [c] = await db.select({ id: contactsTable.id, name: contactsTable.name })
      .from(contactsTable)
      .where(and(eq(contactsTable.id, parsed.data.contactId), eq(contactsTable.workspaceId, activeWorkspaceId))).limit(1);
    if (!c) { res.status(404).json({ error: "العميل غير موجود أو لا ينتمي لهذا الحساب" }); return; }
    contact = c;
  }

  if (parsed.data.conversationId) {
    const [c] = await db.select({ id: conversationsTable.id }).from(conversationsTable)
      .where(and(eq(conversationsTable.id, parsed.data.conversationId), eq(conversationsTable.workspaceId, activeWorkspaceId))).limit(1);
    if (!c) { res.status(404).json({ error: "المحادثة غير موجودة أو لا تنتمي لهذا الحساب" }); return; }
  }

  if (parsed.data.opportunityId) {
    const [o] = await db.select({ id: opportunitiesTable.id }).from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.id, parsed.data.opportunityId), eq(opportunitiesTable.workspaceId, activeWorkspaceId))).limit(1);
    if (!o) { res.status(404).json({ error: "الفرصة غير موجودة أو لا تنتمي لهذا الحساب" }); return; }
  }

  const [{ total: existingCount }] = await db.select({ total: count() })
    .from(ordersTable).where(eq(ordersTable.workspaceId, activeWorkspaceId));
  const orderNumber = `ORD${String(Number(existingCount) + 1).padStart(5, "0")}`;

  const [order] = await db.insert(ordersTable).values({
    workspaceId: activeWorkspaceId, orderNumber, status: "new",
    channel: parsed.data.channel, contactId: parsed.data.contactId,
    conversationId: parsed.data.conversationId, opportunityId: parsed.data.opportunityId,
    sourceMessageId: parsed.data.sourceMessageId, assignedMembershipId: parsed.data.assignedMembershipId,
    currency: parsed.data.currency, discount: String(parsed.data.discount),
    notes: parsed.data.notes, createdBy: userId,
  }).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "create", severity: "info", entityType: "order",
    entityId: order.id,
    entityLabel: `طلب ${order.orderNumber}${contact ? ` — ${contact.name}` : ""}`,
    newData: { orderNumber: order.orderNumber, status: order.status, channel: order.channel, currency: order.currency },
  });

  if (parsed.data.contactId) {
    await addContactTimeline({
      workspaceId: activeWorkspaceId, contactId: parsed.data.contactId,
      eventType: "order_created", title: `تم إنشاء طلب: ${order.orderNumber}`,
      entityType: "order", entityId: order.id, createdBy: userId,
    });
  }

  res.status(201).json({ order });
});

// GET /api/orders/:id
router.get("/:id", requirePermission("orders:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const [order] = await db.select({
    id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status,
    channel: ordersTable.channel, totalAmount: ordersTable.totalAmount, paidAmount: ordersTable.paidAmount,
    paymentStatus: ordersTable.paymentStatus,
    discount: ordersTable.discount, currency: ordersTable.currency, notes: ordersTable.notes,
    contactId: ordersTable.contactId, conversationId: ordersTable.conversationId,
    opportunityId: ordersTable.opportunityId, assignedMembershipId: ordersTable.assignedMembershipId,
    cancelReason: ordersTable.cancelReason, returnedReason: ordersTable.returnedReason,
    confirmedAt: ordersTable.confirmedAt, deliveredAt: ordersTable.deliveredAt,
    cancelledAt: ordersTable.cancelledAt, returnedAt: ordersTable.returnedAt,
    createdAt: ordersTable.createdAt, updatedAt: ordersTable.updatedAt,
    contactName: contactsTable.name, contactPhone: contactsTable.phone,
  })
    .from(ordersTable)
    .leftJoin(contactsTable, eq(ordersTable.contactId, contactsTable.id))
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!order) { res.status(404).json({ error: "الطلب غير موجود" }); return; }

  const items = await db.select().from(orderItemsTable)
    .where(and(eq(orderItemsTable.orderId, order.id), eq(orderItemsTable.workspaceId, activeWorkspaceId)))
    .orderBy(orderItemsTable.createdAt);

  res.json({ order, items });
});

// PATCH /api/orders/:id
router.patch("/:id", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId, userId } = req.sessionUser;

  const [existing] = await db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status, contactId: ordersTable.contactId })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "الطلب غير موجود" }); return; }
  if (existing.status === "cancelled" || existing.status === "returned") {
    res.status(422).json({ error: "لا يمكن تعديل طلب مُلغى أو مُرتجع" }); return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.channel !== undefined) updateData.channel = parsed.data.channel;
  if (parsed.data.currency !== undefined) updateData.currency = parsed.data.currency;
  if ("assignedMembershipId" in parsed.data) updateData.assignedMembershipId = parsed.data.assignedMembershipId;
  if (parsed.data.discount !== undefined) updateData.discount = String(parsed.data.discount);
  if ("notes" in parsed.data) updateData.notes = parsed.data.notes;

  const [order] = await db.update(ordersTable).set(updateData)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId)))
    .returning();

  if (parsed.data.discount !== undefined) await recalcTotal(order.id, activeWorkspaceId);

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update", severity: "info", entityType: "order",
    entityId: order.id, entityLabel: order.orderNumber,
    oldData: { status: existing.status }, newData: updateData,
  });

  if (existing.contactId) {
    await addContactTimeline({
      workspaceId: activeWorkspaceId, contactId: existing.contactId,
      eventType: "order_updated", title: `تم تحديث الطلب: ${order.orderNumber}`,
      entityType: "order", entityId: order.id, createdBy: userId,
    });
  }

  res.json({ order });
});

// PATCH /api/orders/:id/status
router.patch("/:id/status", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId, userId } = req.sessionUser;
  const { status: newStatus, cancelReason, returnedReason } = parsed.data;

  const [existing] = await db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status, contactId: ordersTable.contactId })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "الطلب غير موجود" }); return; }

  const allowed = ORDER_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(newStatus)) {
    res.status(422).json({
      error: `لا يمكن تغيير حالة الطلب من "${STATUS_LABELS[existing.status] ?? existing.status}" إلى "${STATUS_LABELS[newStatus] ?? newStatus}"`,
      code: "INVALID_TRANSITION",
    });
    return;
  }

  if (newStatus === "cancelled" && !req.sessionUser.permissions.includes("orders:cancel")) {
    res.status(403).json({ error: "ليس لديك صلاحية إلغاء الطلبات", code: "FORBIDDEN" }); return;
  }

  if (newStatus === "cancelled" && existing.status !== "new" && !cancelReason?.trim()) {
    res.status(400).json({ error: "سبب الإلغاء مطلوب عند إلغاء طلب مؤكد أو في مراحل متقدمة" }); return;
  }

  if (newStatus === "returned" && !returnedReason?.trim()) {
    res.status(400).json({ error: "سبب الإرجاع مطلوب عند إرجاع الطلب" }); return;
  }

  const updateData: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
  if (newStatus === "confirmed") updateData.confirmedAt = new Date();
  if (newStatus === "delivered") updateData.deliveredAt = new Date();
  if (newStatus === "cancelled") {
    updateData.cancelledAt = new Date();
    if (cancelReason) updateData.cancelReason = cancelReason;
  }
  if (newStatus === "returned") {
    updateData.returnedAt = new Date();
    if (returnedReason) updateData.returnedReason = returnedReason;
  }

  const [order] = await db.update(ordersTable).set(updateData)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update", severity: newStatus === "cancelled" ? "warning" : "info",
    entityType: "order", entityId: order.id, entityLabel: order.orderNumber,
    oldData: { status: existing.status }, newData: { status: newStatus, cancelReason, returnedReason },
  });

  if (existing.contactId) {
    const eventType = newStatus === "cancelled" ? "order_cancelled" : "order_status_changed";
    await addContactTimeline({
      workspaceId: activeWorkspaceId, contactId: existing.contactId,
      eventType,
      title: newStatus === "cancelled"
        ? `تم إلغاء الطلب: ${order.orderNumber}${cancelReason ? ` — ${cancelReason}` : ""}`
        : `الطلب ${order.orderNumber}: تغيّرت الحالة إلى ${STATUS_LABELS[newStatus] ?? newStatus}`,
      entityType: "order", entityId: order.id, createdBy: userId,
    });
  }

  res.json({ order });
});

// DELETE /api/orders/:id
router.delete("/:id", requirePermission("orders:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const [existing] = await db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "الطلب غير موجود" }); return; }

  if (existing.status !== "new" && existing.status !== "cancelled") {
    res.status(422).json({ error: "لا يمكن حذف طلب إلا إذا كان جديداً أو ملغياً" }); return;
  }

  // R3 — منع حذف أي طلب مرتبط بأي دفعة (pending أو confirmed أو rejected)
  const [{ paymentCount }] = await db.select({ paymentCount: count() })
    .from(paymentsTable)
    .where(eq(paymentsTable.orderId, existing.id));
  if (Number(paymentCount) > 0) {
    res.status(422).json({
      error: "لا يمكن حذف طلب مرتبط بمدفوعات",
      code: "HAS_PAYMENTS",
      paymentCount: Number(paymentCount),
    });
    return;
  }

  await db.delete(orderItemsTable).where(eq(orderItemsTable.orderId, existing.id));
  await db.delete(ordersTable).where(eq(ordersTable.id, existing.id));

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "delete", severity: "warning", entityType: "order",
    entityId: existing.id, entityLabel: existing.orderNumber,
    oldData: { status: existing.status },
  });

  res.json({ success: true });
});

// ── ORDER ITEMS ───────────────────────────────────────────────────

// GET /api/orders/:id/items
router.get("/:id/items", requirePermission("orders:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const [order] = await db.select({ id: ordersTable.id }).from(ordersTable)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!order) { res.status(404).json({ error: "الطلب غير موجود" }); return; }

  const items = await db.select().from(orderItemsTable)
    .where(and(eq(orderItemsTable.orderId, order.id), eq(orderItemsTable.workspaceId, activeWorkspaceId)))
    .orderBy(orderItemsTable.createdAt);
  res.json({ items });
});

// POST /api/orders/:id/items
router.post("/:id/items", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId, userId } = req.sessionUser;

  const [order] = await db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status, currency: ordersTable.currency, contactId: ordersTable.contactId })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!order) { res.status(404).json({ error: "الطلب غير موجود" }); return; }
  if (order.status === "cancelled" || order.status === "returned") {
    res.status(422).json({ error: "لا يمكن إضافة بنود لطلب مُلغى أو مُرتجع" }); return;
  }

  const itemTotal = parsed.data.quantity * parsed.data.unitPrice;
  const [item] = await db.insert(orderItemsTable).values({
    workspaceId: activeWorkspaceId, orderId: order.id, name: parsed.data.name,
    description: parsed.data.description, quantity: parsed.data.quantity,
    unitPrice: String(parsed.data.unitPrice), currency: parsed.data.currency ?? order.currency,
    total: String(itemTotal),
  }).returning();

  const newTotal = await recalcTotal(order.id, activeWorkspaceId);

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "create", severity: "info", entityType: "order_item",
    entityId: item.id, entityLabel: `بند "${item.name}" في ${order.orderNumber}`,
    newData: { name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, total: item.total },
  });

  if (order.contactId) {
    await addContactTimeline({
      workspaceId: activeWorkspaceId, contactId: order.contactId,
      eventType: "order_item_added", title: `إضافة بند "${item.name}" للطلب ${order.orderNumber}`,
      entityType: "order", entityId: order.id, createdBy: userId,
    });
  }

  res.status(201).json({ item, orderTotal: newTotal });
});

// PATCH /api/orders/:id/items/:itemId
router.patch("/:id/items/:itemId", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = itemSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId } = req.sessionUser;

  const [order] = await db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!order) { res.status(404).json({ error: "الطلب غير موجود" }); return; }
  if (order.status === "cancelled" || order.status === "returned") {
    res.status(422).json({ error: "لا يمكن تعديل بنود طلب مُلغى أو مُرتجع" }); return;
  }

  const [existing] = await db.select().from(orderItemsTable)
    .where(and(eq(orderItemsTable.id, req.params.itemId as string), eq(orderItemsTable.orderId, order.id), eq(orderItemsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "البند غير موجود" }); return; }

  const newQty = parsed.data.quantity ?? existing.quantity;
  const newPrice = parsed.data.unitPrice ?? Number(existing.unitPrice);
  const newItemTotal = newQty * newPrice;

  const updateData: Record<string, unknown> = { updatedAt: new Date(), total: String(newItemTotal) };
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.quantity !== undefined) updateData.quantity = parsed.data.quantity;
  if (parsed.data.unitPrice !== undefined) updateData.unitPrice = String(parsed.data.unitPrice);
  if (parsed.data.currency !== undefined) updateData.currency = parsed.data.currency;

  const [item] = await db.update(orderItemsTable).set(updateData)
    .where(and(eq(orderItemsTable.id, req.params.itemId as string), eq(orderItemsTable.workspaceId, activeWorkspaceId)))
    .returning();

  const newTotal = await recalcTotal(order.id, activeWorkspaceId);

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "update", severity: "info", entityType: "order_item",
    entityId: item.id, entityLabel: `بند "${item.name}" في ${order.orderNumber}`,
    newData: updateData,
  });

  res.json({ item, orderTotal: newTotal });
});

// DELETE /api/orders/:id/items/:itemId
router.delete("/:id/items/:itemId", requirePermission("orders:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;

  const [order] = await db.select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, status: ordersTable.status })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, req.params.id as string), eq(ordersTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!order) { res.status(404).json({ error: "الطلب غير موجود" }); return; }
  if (order.status === "cancelled" || order.status === "returned") {
    res.status(422).json({ error: "لا يمكن حذف بنود طلب مُلغى أو مُرتجع" }); return;
  }

  const [existing] = await db.select({ id: orderItemsTable.id, name: orderItemsTable.name })
    .from(orderItemsTable)
    .where(and(eq(orderItemsTable.id, req.params.itemId as string), eq(orderItemsTable.orderId, order.id), eq(orderItemsTable.workspaceId, activeWorkspaceId))).limit(1);
  if (!existing) { res.status(404).json({ error: "البند غير موجود" }); return; }

  await db.delete(orderItemsTable)
    .where(and(eq(orderItemsTable.id, req.params.itemId as string), eq(orderItemsTable.workspaceId, activeWorkspaceId)));
  const newTotal = await recalcTotal(order.id, activeWorkspaceId);

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "delete", severity: "info", entityType: "order_item",
    entityId: existing.id, entityLabel: `بند "${existing.name}" في ${order.orderNumber}`,
  });

  res.json({ success: true, orderTotal: newTotal });
});

export default router;
