import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, serviceHeartbeatsTable } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const version = process.env.npm_package_version ?? "0.0.0";

/** Public: liveness — server is up */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/livez", (_req, res) => {
  res.json({ ok: true, status: "live", version, uptime: Math.round(process.uptime()) });
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Public: readiness — server is up AND can reach the database */
router.get("/readyz", async (_req, res): Promise<void> => {
  const uptime = Math.round(process.uptime());
  try {
    await withTimeout(db.execute(sql`SELECT 1`), 1000);
    const [heartbeat] = await db
      .select()
      .from(serviceHeartbeatsTable)
      .where(eq(serviceHeartbeatsTable.serviceName, "outbox-worker"))
      .limit(1);
    const heartbeatAgeMs = heartbeat ? Date.now() - heartbeat.lastBeatAt.getTime() : Number.POSITIVE_INFINITY;
    if (!heartbeat || heartbeatAgeMs > 60_000) {
      res.status(503).json({ ok: false, status: "not_ready", db: "ok", reason: "outbox-worker-stale", version, uptime });
      return;
    }
    res.json({ ok: true, status: "ready", db: "ok", outboxWorker: "ok", version, uptime });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "db-error";
    res.status(503).json({ ok: false, status: "not_ready", db: "error", reason, version, uptime });
  }
});

export default router;
