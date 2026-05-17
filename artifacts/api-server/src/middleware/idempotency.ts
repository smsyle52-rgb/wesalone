import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";
import { hashValue } from "../modules/integrations/idempotency.service";
import { logger } from "../lib/logger";

const mutationMethods = new Set(["POST", "PUT", "PATCH"]);
const oneDayMs = 24 * 60 * 60 * 1000;

function keyFromHeader(req: Request): string | null {
  const value = req.header("Idempotency-Key");
  const key = value?.trim();
  return key ? key.slice(0, 256) : null;
}

function responseBodyFrom(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!mutationMethods.has(req.method)) {
    next();
    return;
  }

  const key = keyFromHeader(req);
  const workspaceId = req.session.user?.activeWorkspaceId;
  if (!key || !workspaceId) {
    next();
    return;
  }

  const path = req.originalUrl.split("?")[0] ?? req.originalUrl;
  const scope = `${req.method}:${path}`;
  const expiresAt = new Date(Date.now() + oneDayMs);

  try {
    const existing = await pool.query<{
      status: string;
      response_status: number | null;
      response_body: unknown;
    }>(
      `
      SELECT status, response_status, response_body
      FROM idempotency_keys
      WHERE workspace_id = $1 AND key = $2 AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1
      `,
      [workspaceId, key],
    );

    const existingRow = existing.rows[0];
    if (existingRow?.status === "completed" && existingRow.response_status && existingRow.response_body !== null) {
      res.setHeader("Idempotency-Status", "replayed");
      res.status(existingRow.response_status).json(existingRow.response_body);
      return;
    }

    if (existingRow?.status === "processing") {
      res.status(409).json({ error: "الطلب قيد المعالجة، حاول لاحقاً", code: "IDEMPOTENCY_IN_PROGRESS" });
      return;
    }

    await pool.query(
      `
      INSERT INTO idempotency_keys (workspace_id, key, scope, status, method, path, expires_at)
      VALUES ($1, $2, $3, 'processing', $4, $5, $6)
      ON CONFLICT (workspace_id, key) DO NOTHING
      `,
      [workspaceId, key, scope, req.method, path, expiresAt],
    );
  } catch (err) {
    logger.warn({ err, path, method: req.method }, "Idempotency guard skipped");
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let capturedBody: unknown = null;

  res.json = (body: unknown) => {
    capturedBody = body;
    return originalJson(body);
  };

  res.send = (body?: unknown) => {
    if (capturedBody === null) capturedBody = responseBodyFrom(body);
    return originalSend(body);
  };

  res.on("finish", () => {
    const status = res.statusCode >= 500 ? "failed" : "completed";
    void pool
      .query(
        `
        UPDATE idempotency_keys
        SET status = $1,
            response_hash = $2,
            response_status = $3,
            response_body = $4
        WHERE workspace_id = $5 AND key = $6
        `,
        [status, hashValue(capturedBody), res.statusCode, capturedBody ?? {}, workspaceId, key],
      )
      .catch((err: unknown) => {
        logger.warn({ err, path, method: req.method }, "Failed to persist idempotency result");
      });
  });

  next();
}
