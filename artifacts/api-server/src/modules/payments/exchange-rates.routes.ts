import { Router, type Response } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db, exchangeRatesTable } from "@workspace/db";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import { createAuditLog, auditFromRequest } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { logger } from "../../lib/logger";

const router = Router();
router.use(requireSession);

const createSchema = z.object({
  fromCurrency: z.enum(["SAR", "USD"], { required_error: "العملة المصدر مطلوبة" }),
  toCurrency: z.literal("YER").default("YER"),
  rate: z.number().positive("سعر الصرف يجب أن يكون أكبر من صفر"),
  effectiveAt: z.string().optional(),
});

const updateSchema = z.object({
  rate: z.number().positive("سعر الصرف يجب أن يكون أكبر من صفر"),
  effectiveAt: z.string().optional(),
});

router.get("/", requirePermission("payments:read"), async (req: AuthenticatedRequest, res: Response) => {
  const { activeWorkspaceId } = req.sessionUser;
  const fromCurrency = req.query.fromCurrency as string | undefined;

  const conditions = [eq(exchangeRatesTable.workspaceId, activeWorkspaceId)];
  if (fromCurrency) conditions.push(eq(exchangeRatesTable.fromCurrency, fromCurrency));

  const rates = await db.select().from(exchangeRatesTable)
    .where(and(...conditions))
    .orderBy(desc(exchangeRatesTable.effectiveAt));

  const latest: Record<string, typeof rates[0]> = {};
  for (const r of rates) {
    const key = `${r.fromCurrency}_${r.toCurrency}`;
    if (!latest[key]) latest[key] = r;
  }

  res.json({ rates, latestRates: Object.values(latest) });
});

router.post("/", requirePermission("settings:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId, userId } = req.sessionUser;

  try {
    const [rate] = await db.insert(exchangeRatesTable).values({
      workspaceId: activeWorkspaceId,
      fromCurrency: parsed.data.fromCurrency,
      toCurrency: parsed.data.toCurrency,
      rate: String(parsed.data.rate),
      setBy: userId,
      effectiveAt: parsed.data.effectiveAt ? new Date(parsed.data.effectiveAt) : new Date(),
    }).returning();

    await createAuditLog({
      ...auditFromRequest(req, req.sessionUser),
      action: "exchange_rate_create", severity: "info", entityType: "exchange_rate",
      entityId: rate.id,
      entityLabel: `1 ${rate.fromCurrency} = ${rate.rate} ${rate.toCurrency}`,
      newData: { fromCurrency: rate.fromCurrency, toCurrency: rate.toCurrency, rate: rate.rate },
    });

    res.status(201).json({ rate });
  } catch (err) {
    logger.error({ err }, "Failed to create exchange rate");
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
});

router.patch("/:id", requirePermission("settings:manage"), async (req: AuthenticatedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { activeWorkspaceId } = req.sessionUser;

  const [existing] = await db.select().from(exchangeRatesTable)
    .where(and(eq(exchangeRatesTable.id, req.params.id as string), eq(exchangeRatesTable.workspaceId, activeWorkspaceId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "سعر الصرف غير موجود" }); return; }

  const [rate] = await db.update(exchangeRatesTable)
    .set({
      rate: String(parsed.data.rate),
      effectiveAt: parsed.data.effectiveAt ? new Date(parsed.data.effectiveAt) : existing.effectiveAt,
    })
    .where(and(eq(exchangeRatesTable.id, req.params.id as string), eq(exchangeRatesTable.workspaceId, activeWorkspaceId)))
    .returning();

  await createAuditLog({
    ...auditFromRequest(req, req.sessionUser),
    action: "exchange_rate_update", severity: "info", entityType: "exchange_rate",
    entityId: rate.id,
    entityLabel: `1 ${rate.fromCurrency} = ${rate.rate} ${rate.toCurrency}`,
    oldData: { rate: existing.rate }, newData: { rate: rate.rate },
  });

  res.json({ rate });
});

export default router;
