import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const version = process.env.npm_package_version ?? "0.0.0";

/** Public: liveness — server is up */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/** Public: readiness — server is up AND can reach the database */
router.get("/readyz", async (_req, res): Promise<void> => {
  const uptime = Math.round(process.uptime());
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ready", db: "ok", version, uptime });
  } catch {
    res.status(503).json({ status: "not_ready", db: "error", version, uptime });
  }
});

export default router;
