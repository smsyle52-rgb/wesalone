import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc, count, sum, inArray } from "drizzle-orm";
import {
  db, debtsTable, collectionNotesTable, contactsTable, ordersTable, paymentsTable,
} from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import { addContactTimeline } from "../../lib/contactTimeline";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";

const router = Router();
router.use(requireSession);

const VALID_CURRENCIES = ["YER", "SAR", "USD"] as const;
const VALID_STATUSES = ["open", "partial", "paid", "overdue", "written_off", "cancelled"] as const;

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  open: ["partial", "paid", "overdue", "written_off", "cancelled"],
  partial: ["paid", "overdue", "written_off", "cancelled"],
  overdue: ["partial", "paid", "written_off", "cancelled"],
  paid: [],
  written_off: [],
  cancelled: [],
};

const createSchema = z.object({
  contactId: z.string().uuid("معرف العميل غير صحيح"),
  orderId: z.string().uuid("معرف الطلب غير صحيح").optional().nullable(),
  sourcePaymentId: z.string().uuid("معرف الدفعة المصدر غير صحيح").optional().nullable(),
  amount: z.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  currency: z.enum(VALID_CURRENCIES).default("YER"),
  remainingAmount: z.number().min(0, "المبلغ المتبقي لا يمكن أن يكون سالباً").optional(),
  dueAt: z.string().optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  assignedMembershipId: z.string().uuid().optional().nullable(),
});

const updateSchema = z.object({
  remainingAmount: z.number().min(0).optional(),
  dueAt: z.string().optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  assignedMembershipId: z.string().uuid().optional().nullable(),
});

const statusSchema = z.object({
  status: z.enum(VALID_STATUSES),
  cancelReason: z.string().trim().min(1, "يجب إدخال سبب الإلغاء").optional(),
  writeOffReason: z.string().trim().min(1, "يجب إدخال سبب الشطب").optional(),
  remainingAmount: z.number().min(0).optional(),
});

const collectionNoteCreateSchema = z.object({
  note: z.string().trim().min(1, "الملاحظة مطلوبة").max(5000),
  promisedPaymentDate: z.string().optional().nullable(),
  promisedAmount: z.number().positive("المبلغ الموعود يجب أن يكون أكبر من صفر").optional().nullable(),
});

const collectionNoteUpdateSchema = z.object({
  note: z.string().trim().min(1, "الملاحظة مطلوبة").max(5000).optional(),
  promisedPaymentDate: z.string().optional().nullable(),
  promisedAmount: z.number().positive("المبلغ الموعود يجب أن يكون أكبر من صفر").optional().nullable(),
});

function agingBucket(dueAt: Date | null): string {
  if (!dueAt) return "غير مستحق";
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - dueAt.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "غير مستحق";
  if (diffDays <= 7) return "1-7 أيام";
  if (diffDays <= 30) return "8-30 يوم";
  return "أكثر من 30 يوم";
}

function debtStatusLabel(status: string): string {
  const m: Record<string, string> = {
    open: "مفتوح", partial: "جزئي", paid: "مدفوع",
    overdue: "متأخر", written_off: "مشطوب", cancelled: "ملغي",
  };
  return m[status] ?? status;
}

// ── GET /debts ─────────────────────────────────────────────────────────────────
router.get("/", requirePermission("debts:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const status = req.query.status as string | undefined;
  const overdue = req.query.overdue === "true";
  const contactId = req.query.contactId as string | undefined;
  const orderId = req.query.orderId as string | undefined;
  const search = req.query.search as string | undefined;
  const assignedMembershipId = req.query.assignedMembershipId as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [eq(debtsTable.workspaceId, activeWorkspaceId)];
  if (status) conditions.push(eq(debtsTable.status, status));
  if (overdue) conditions.push(eq(debtsTable.status, "overdue"));
  if (contactId) conditions.push(eq(debtsTable.contactId, contactId));
  if (orderId) conditions.push(eq(debtsTable.orderId, orderId));
  if (assignedMembershipId) conditions.push(eq(debtsTable.assignedMembershipId, assignedMembershipId));

  const [debts, [{ total }]] = await Promise.all([
    db.select({
      id: debtsTable.id,
      contactId: debtsTable.contactId,
      contactName: contactsTable.name,
      orderId: debtsTable.orderId,
      amount: debtsTable.amount,
      currency: debtsTable.currency,
      remainingAmount: debtsTable.remainingAmount,
      status: debtsTable.status,
      dueAt: debtsTable.dueAt,
      description: debtsTable.description,
      assignedMembershipId: debtsTable.assignedMembershipId,
      createdAt: debtsTable.createdAt,
      updatedAt: debtsTable.updatedAt,
    })
      .from(debtsTable)
      .leftJoin(contactsTable, eq(debtsTable.contactId, contactsTable.id))
      .where(and(...conditions))
      .orderBy(desc(debtsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(debtsTable).where(and(...conditions)),
  ]);

  const mapped = debts.map((d) => ({
    ...d,
    amount: Number(d.amount),
    remainingAmount: Number(d.remainingAmount),
    agingBucket: agingBucket(d.dueAt),
    statusLabel: debtStatusLabel(d.status),
  }));

  res.json({ debts: mapped, total: Number(total), page, limit });
});

// ── POST /debts ────────────────────────────────────────────────────────────────
router.post("/", requirePermission("debts:create"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId, name: actorName } = req.sessionUser;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }

  const data = parsed.data;

  if (data.remainingAmount !== undefined && data.remainingAmount > data.amount) {
    res.status(400).json({ error: "المبلغ المتبقي لا يمكن أن يكون أكبر من المبلغ الأصلي", code: "VALIDATION_ERROR" });
    return;
  }

  const contact = await db.select({ id: contactsTable.id }).from(contactsTable)
    .where(and(eq(contactsTable.id, data.contactId), eq(contactsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!contact.length) {
    res.status(404).json({ error: "العميل غير موجود", code: "NOT_FOUND" });
    return;
  }

  if (data.orderId) {
    const order = await db.select({ id: ordersTable.id, status: ordersTable.status, paidAmount: ordersTable.paidAmount, totalAmount: ordersTable.totalAmount })
      .from(ordersTable)
      .where(and(eq(ordersTable.id, data.orderId), eq(ordersTable.workspaceId, activeWorkspaceId)))
      .limit(1);
    if (!order.length) {
      res.status(404).json({ error: "الطلب غير موجود", code: "NOT_FOUND" });
      return;
    }
    if (["cancelled", "returned"].includes(order[0].status)) {
      res.status(422).json({ error: "لا يمكن إنشاء دين على طلب ملغي أو مرتجع", code: "ORDER_TERMINAL" });
      return;
    }
    const rem = Number(order[0].totalAmount ?? 0) - Number(order[0].paidAmount ?? 0);
    if (rem <= 0) {
      res.status(422).json({ error: "لا يوجد مبلغ متبقٍ على هذا الطلب", code: "ORDER_FULLY_PAID" });
      return;
    }
  }

  if (data.sourcePaymentId) {
    const pmt = await db.select({ id: paymentsTable.id }).from(paymentsTable)
      .where(and(eq(paymentsTable.id, data.sourcePaymentId), eq(paymentsTable.workspaceId, activeWorkspaceId)))
      .limit(1);
    if (!pmt.length) {
      res.status(404).json({ error: "الدفعة المصدر غير موجودة", code: "NOT_FOUND" });
      return;
    }
  }

  const remaining = data.remainingAmount ?? data.amount;

  const [debt] = await db.insert(debtsTable).values({
    workspaceId: activeWorkspaceId,
    contactId: data.contactId,
    orderId: data.orderId ?? null,
    sourcePaymentId: data.sourcePaymentId ?? null,
    amount: String(data.amount),
    currency: data.currency,
    remainingAmount: String(remaining),
    status: "open",
    dueAt: data.dueAt ? new Date(data.dueAt) : null,
    description: data.description ?? null,
    notes: data.notes ?? null,
    createdBy: userId,
    assignedMembershipId: data.assignedMembershipId ?? null,
  }).returning();

  await Promise.all([
    createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "debt_create",
      entityType: "debt",
      entityId: debt.id,
      entityLabel: `دين ${data.amount} ${data.currency}`,
      newData: { amount: data.amount, currency: data.currency, contactId: data.contactId },
    }),
    addContactTimeline({
      workspaceId: activeWorkspaceId,
      contactId: data.contactId,
      eventType: "debt_created",
      title: `تم تسجيل دين بمبلغ ${data.amount} ${data.currency}`,
      description: data.description ?? undefined,
      entityType: "debt",
      entityId: debt.id,
      createdBy: userId,
    }),
  ]);

  res.status(201).json({ debt: { ...debt, amount: Number(debt.amount), remainingAmount: Number(debt.remainingAmount) } });
});

// ── GET /debts/:id ─────────────────────────────────────────────────────────────
router.get("/:id", requirePermission("debts:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);

  const [debt] = await db.select({
    id: debtsTable.id,
    workspaceId: debtsTable.workspaceId,
    contactId: debtsTable.contactId,
    contactName: contactsTable.name,
    orderId: debtsTable.orderId,
    sourcePaymentId: debtsTable.sourcePaymentId,
    amount: debtsTable.amount,
    currency: debtsTable.currency,
    remainingAmount: debtsTable.remainingAmount,
    status: debtsTable.status,
    dueAt: debtsTable.dueAt,
    description: debtsTable.description,
    notes: debtsTable.notes,
    createdBy: debtsTable.createdBy,
    assignedMembershipId: debtsTable.assignedMembershipId,
    paidAt: debtsTable.paidAt,
    writtenOffAt: debtsTable.writtenOffAt,
    cancelledAt: debtsTable.cancelledAt,
    cancelReason: debtsTable.cancelReason,
    writeOffReason: debtsTable.writeOffReason,
    createdAt: debtsTable.createdAt,
    updatedAt: debtsTable.updatedAt,
  })
    .from(debtsTable)
    .leftJoin(contactsTable, eq(debtsTable.contactId, contactsTable.id))
    .where(and(eq(debtsTable.id, id), eq(debtsTable.workspaceId, activeWorkspaceId)))
    .limit(1);

  if (!debt) {
    res.status(404).json({ error: "الدين غير موجود", code: "NOT_FOUND" });
    return;
  }

  res.json({
    debt: {
      ...debt,
      amount: Number(debt.amount),
      remainingAmount: Number(debt.remainingAmount),
      agingBucket: agingBucket(debt.dueAt),
      statusLabel: debtStatusLabel(debt.status),
    },
  });
});

// ── PATCH /debts/:id ───────────────────────────────────────────────────────────
router.patch("/:id", requirePermission("debts:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const id = String(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }

  const [existing] = await db.select().from(debtsTable)
    .where(and(eq(debtsTable.id, id), eq(debtsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "الدين غير موجود", code: "NOT_FOUND" });
    return;
  }

  if (["paid", "written_off", "cancelled"].includes(existing.status)) {
    res.status(422).json({ error: "لا يمكن تعديل دين في حالة نهائية", code: "DEBT_TERMINAL" });
    return;
  }

  const d = parsed.data;

  if (d.remainingAmount !== undefined && d.remainingAmount > Number(existing.amount)) {
    res.status(400).json({ error: "المبلغ المتبقي لا يمكن أن يكون أكبر من المبلغ الأصلي", code: "VALIDATION_ERROR" });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (d.remainingAmount !== undefined) updates.remainingAmount = String(d.remainingAmount);
  if (d.dueAt !== undefined) updates.dueAt = d.dueAt ? new Date(d.dueAt) : null;
  if (d.description !== undefined) updates.description = d.description;
  if (d.notes !== undefined) updates.notes = d.notes;
  if (d.assignedMembershipId !== undefined) updates.assignedMembershipId = d.assignedMembershipId;

  const [updated] = await db.update(debtsTable).set(updates).where(eq(debtsTable.id, id)).returning();

  await Promise.all([
    createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "debt_update",
      entityType: "debt",
      entityId: updated.id,
      entityLabel: `دين ${updated.amount} ${updated.currency}`,
      oldData: { remainingAmount: existing.remainingAmount, status: existing.status },
      newData: updates,
    }),
    addContactTimeline({
      workspaceId: activeWorkspaceId,
      contactId: existing.contactId,
      eventType: "debt_updated",
      title: `تم تحديث الدين`,
      entityType: "debt",
      entityId: updated.id,
      createdBy: userId,
    }),
  ]);

  res.json({ debt: { ...updated, amount: Number(updated.amount), remainingAmount: Number(updated.remainingAmount) } });
});

// ── PATCH /debts/:id/status ────────────────────────────────────────────────────
router.patch("/:id/status", requirePermission("debts:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const id = String(req.params.id);
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }

  const { status: newStatus, cancelReason, writeOffReason, remainingAmount: newRemaining } = parsed.data;

  const [existing] = await db.select().from(debtsTable)
    .where(and(eq(debtsTable.id, id), eq(debtsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "الدين غير موجود", code: "NOT_FOUND" });
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(newStatus)) {
    res.status(422).json({
      error: `لا يمكن الانتقال من حالة "${debtStatusLabel(existing.status)}" إلى "${debtStatusLabel(newStatus)}"`,
      code: "INVALID_TRANSITION",
    });
    return;
  }

  if (newStatus === "written_off" && !writeOffReason) {
    res.status(400).json({ error: "يجب إدخال سبب الشطب", code: "WRITE_OFF_REASON_REQUIRED" });
    return;
  }

  if (newStatus === "cancelled" && !cancelReason) {
    res.status(400).json({ error: "يجب إدخال سبب الإلغاء", code: "CANCEL_REASON_REQUIRED" });
    return;
  }

  if (newStatus === "written_off") {
    const canWriteOff = req.sessionUser.permissions?.includes("debts:write_off");
    if (!canWriteOff) {
      res.status(403).json({ error: "ليس لديك صلاحية شطب الديون", code: "FORBIDDEN" });
      return;
    }
  }

  if (newStatus === "cancelled") {
    const canCancel = req.sessionUser.permissions?.includes("debts:cancel");
    if (!canCancel) {
      res.status(403).json({ error: "ليس لديك صلاحية إلغاء الديون", code: "FORBIDDEN" });
      return;
    }
  }

  if (newRemaining !== undefined && newRemaining > Number(existing.amount)) {
    res.status(400).json({ error: "المبلغ المتبقي لا يمكن أن يكون أكبر من المبلغ الأصلي", code: "VALIDATION_ERROR" });
    return;
  }

  const now = new Date();
  const updates: Record<string, unknown> = { status: newStatus, updatedAt: now };

  if (newRemaining !== undefined) updates.remainingAmount = String(newRemaining);
  if (newStatus === "paid") {
    updates.paidAt = now;
    updates.remainingAmount = "0";
  }
  if (newStatus === "written_off") {
    updates.writtenOffAt = now;
    updates.writeOffReason = writeOffReason;
    updates.remainingAmount = "0";
  }
  if (newStatus === "cancelled") {
    updates.cancelledAt = now;
    updates.cancelReason = cancelReason;
  }

  const [updated] = await db.update(debtsTable).set(updates).where(eq(debtsTable.id, id)).returning();

  const auditAction = newStatus === "written_off" ? "debt_write_off"
    : newStatus === "cancelled" ? "debt_cancel"
    : "debt_status_change";

  await Promise.all([
    createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: auditAction,
      severity: newStatus === "written_off" ? "warning" : "info",
      entityType: "debt",
      entityId: updated.id,
      entityLabel: `دين ${updated.amount} ${updated.currency}`,
      oldData: { status: existing.status },
      newData: { status: newStatus, cancelReason, writeOffReason },
    }),
    addContactTimeline({
      workspaceId: activeWorkspaceId,
      contactId: existing.contactId,
      eventType: newStatus === "written_off" ? "debt_written_off"
        : newStatus === "cancelled" ? "debt_cancelled"
        : newStatus === "paid" ? "debt_paid"
        : "debt_status_changed",
      title: `تغيّرت حالة الدين إلى "${debtStatusLabel(newStatus)}"`,
      description: cancelReason ?? writeOffReason ?? undefined,
      entityType: "debt",
      entityId: updated.id,
      createdBy: userId,
    }),
  ]);

  res.json({ debt: { ...updated, amount: Number(updated.amount), remainingAmount: Number(updated.remainingAmount) } });
});

// ── DELETE /debts/:id ──────────────────────────────────────────────────────────
router.delete("/:id", requirePermission("debts:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);

  const [existing] = await db.select().from(debtsTable)
    .where(and(eq(debtsTable.id, id), eq(debtsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "الدين غير موجود", code: "NOT_FOUND" });
    return;
  }

  if (!["cancelled", "paid", "written_off"].includes(existing.status)) {
    res.status(422).json({ error: "لا يمكن حذف دين إلا بعد إغلاقه (مدفوع/مشطوب/ملغي)", code: "DEBT_NOT_TERMINAL" });
    return;
  }

  await db.delete(debtsTable).where(eq(debtsTable.id, id));

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "delete",
    entityType: "debt",
    entityId: existing.id,
    entityLabel: `دين ${existing.amount} ${existing.currency}`,
  });

  res.json({ message: "تم حذف الدين بنجاح" });
});

// ── GET /debts/:id/notes ───────────────────────────────────────────────────────
router.get("/:id/notes", requirePermission("collection_notes:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);

  const debt = await db.select({ id: debtsTable.id }).from(debtsTable)
    .where(and(eq(debtsTable.id, id), eq(debtsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!debt.length) {
    res.status(404).json({ error: "الدين غير موجود", code: "NOT_FOUND" });
    return;
  }

  const notes = await db.select().from(collectionNotesTable)
    .where(and(eq(collectionNotesTable.debtId, id), eq(collectionNotesTable.workspaceId, activeWorkspaceId)))
    .orderBy(desc(collectionNotesTable.createdAt));

  const mapped = notes.map((n) => ({
    ...n,
    promisedAmount: n.promisedAmount !== null ? Number(n.promisedAmount) : null,
  }));

  res.json({ notes: mapped });
});

// ── POST /debts/:id/notes ──────────────────────────────────────────────────────
router.post("/:id/notes", requirePermission("collection_notes:create"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId, userId } = req.sessionUser;
  const id = String(req.params.id);
  const parsed = collectionNoteCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }

  const [debt] = await db.select().from(debtsTable)
    .where(and(eq(debtsTable.id, id), eq(debtsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!debt) {
    res.status(404).json({ error: "الدين غير موجود", code: "NOT_FOUND" });
    return;
  }

  const data = parsed.data;
  const [note] = await db.insert(collectionNotesTable).values({
    workspaceId: activeWorkspaceId,
    debtId: debt.id,
    contactId: debt.contactId,
    authorId: userId,
    note: data.note,
    promisedPaymentDate: data.promisedPaymentDate ? new Date(data.promisedPaymentDate) : null,
    promisedAmount: data.promisedAmount !== undefined && data.promisedAmount !== null ? String(data.promisedAmount) : null,
  }).returning();

  await Promise.all([
    createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "collection_note_create",
      entityType: "collection_note",
      entityId: note.id,
      entityLabel: `ملاحظة تحصيل على دين`,
      newData: { debtId: debt.id, note: data.note },
    }),
    addContactTimeline({
      workspaceId: activeWorkspaceId,
      contactId: debt.contactId,
      eventType: "collection_note_added",
      title: "تمت إضافة ملاحظة تحصيل",
      description: data.note.slice(0, 200),
      entityType: "collection_note",
      entityId: note.id,
      createdBy: userId,
    }),
  ]);

  res.status(201).json({ note: { ...note, promisedAmount: note.promisedAmount !== null ? Number(note.promisedAmount) : null } });
});

// ── PATCH /debts/:id/notes/:noteId ────────────────────────────────────────────
router.patch("/:id/notes/:noteId", requirePermission("collection_notes:update"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);
  const noteId = String(req.params.noteId);
  const parsed = collectionNoteUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "بيانات غير صحيحة", code: "VALIDATION_ERROR" });
    return;
  }

  const debt = await db.select({ id: debtsTable.id }).from(debtsTable)
    .where(and(eq(debtsTable.id, id), eq(debtsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!debt.length) {
    res.status(404).json({ error: "الدين غير موجود", code: "NOT_FOUND" });
    return;
  }

  const [existing] = await db.select().from(collectionNotesTable)
    .where(and(eq(collectionNotesTable.id, noteId), eq(collectionNotesTable.debtId, id), eq(collectionNotesTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "الملاحظة غير موجودة", code: "NOT_FOUND" });
    return;
  }

  const d = parsed.data;
  const updates: Record<string, unknown> = {};
  if (d.note !== undefined) updates.note = d.note;
  if (d.promisedPaymentDate !== undefined) updates.promisedPaymentDate = d.promisedPaymentDate ? new Date(d.promisedPaymentDate) : null;
  if (d.promisedAmount !== undefined) updates.promisedAmount = d.promisedAmount !== null ? String(d.promisedAmount) : null;

  const [updated] = await db.update(collectionNotesTable).set(updates).where(eq(collectionNotesTable.id, noteId)).returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "collection_note_update",
    entityType: "collection_note",
    entityId: updated.id,
    entityLabel: "تعديل ملاحظة تحصيل",
    oldData: { note: existing.note },
    newData: updates,
  });

  res.json({ note: { ...updated, promisedAmount: updated.promisedAmount !== null ? Number(updated.promisedAmount) : null } });
});

// ── DELETE /debts/:id/notes/:noteId ───────────────────────────────────────────
router.delete("/:id/notes/:noteId", requirePermission("collection_notes:delete"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const id = String(req.params.id);
  const noteId = String(req.params.noteId);

  const debt = await db.select({ id: debtsTable.id }).from(debtsTable)
    .where(and(eq(debtsTable.id, id), eq(debtsTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!debt.length) {
    res.status(404).json({ error: "الدين غير موجود", code: "NOT_FOUND" });
    return;
  }

  const [existing] = await db.select().from(collectionNotesTable)
    .where(and(eq(collectionNotesTable.id, noteId), eq(collectionNotesTable.debtId, id), eq(collectionNotesTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "الملاحظة غير موجودة", code: "NOT_FOUND" });
    return;
  }

  await db.delete(collectionNotesTable).where(eq(collectionNotesTable.id, noteId));

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "collection_note_delete",
    entityType: "collection_note",
    entityId: existing.id,
    entityLabel: "حذف ملاحظة تحصيل",
    oldData: { note: existing.note },
  });

  res.json({ message: "تم حذف الملاحظة بنجاح" });
});

export default router;
