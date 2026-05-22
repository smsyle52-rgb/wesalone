import { Router, type Response } from "express";
import { db, sectorProfilesTable } from "@workspace/db";
import { asc } from "drizzle-orm";
import { requireSession } from "../../middlewares/requireSession";
import { requirePermission } from "../../middlewares/requirePermission";
import type { AuthenticatedRequest } from "../../lib/types";

const router = Router();
router.use(requireSession);

router.get("/", requirePermission("ai:read"), async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const sectors = await db.select().from(sectorProfilesTable).orderBy(asc(sectorProfilesTable.nameAr));
  res.json({ sectors });
});

export default router;
