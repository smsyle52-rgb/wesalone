import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { ingestWebhookEvent } from "./webhookIngest.service";
import { handleMetaWebhook } from "./meta-webhook.handler";
import { logger } from "../../lib/logger";

const router = Router();

const metaWebhookProviders = new Set(["whatsapp", "whatsapp_cloud", "meta", "instagram", "messenger"]);

function getRawBody(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

function isValidMetaSignature(rawBody: Buffer, signatureHeader: string, appSecret: string): boolean {
  const providedHex = signatureHeader.replace(/^sha256=/i, "").trim();
  const expectedHex = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function verifyWebhookSignature(req: Request, res: Response, next: NextFunction): void {
  const provider = String(req.params.provider ?? "");

  if (!metaWebhookProviders.has(provider)) {
    req.log?.warn({ provider }, "unverified provider");
    next();
    return;
  }

  const appSecret = process.env.META_APP_SECRET;
  const signatureHeader = req.header("x-hub-signature-256");

  if (!appSecret) {
    req.log?.warn({ provider }, "webhook signature verification skipped because META_APP_SECRET is not configured");
    next();
    return;
  }

  if (!signatureHeader) {
    req.log?.warn({ provider, hasSignature: false }, "webhook signature missing");
    res.status(401).json({ accepted: false, reason: "invalid_signature" });
    return;
  }

  if (!isValidMetaSignature(getRawBody(req), signatureHeader, appSecret)) {
    req.log?.warn({ provider }, "webhook signature mismatch");
    res.status(401).json({ accepted: false, reason: "invalid_signature" });
    return;
  }

  next();
}

function parseWebhookPayload(req: Request, res: Response, next: NextFunction): void {
  try {
    const rawBody = getRawBody(req);
    req.body = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
    next();
  } catch (err) {
    logger.warn({ err, provider: req.params.provider }, "Invalid webhook JSON payload");
    res.status(400).json({ accepted: false, reason: "invalid_json" });
  }
}

router.post("/:provider", verifyWebhookSignature, parseWebhookPayload, async (req: Request, res: Response) => {
  const result = await ingestWebhookEvent({
    provider: String(req.params.provider),
    headers: req.headers,
    payload: req.body,
  });

  if (!result.accepted) {
    res.status(400).json({ accepted: false, reason: result.reason });
    return;
  }

  if (!result.event) {
    res.status(500).json({ accepted: false, reason: "event_not_recorded" });
    return;
  }

  const metaResult = metaWebhookProviders.has(String(req.params.provider))
    ? await handleMetaWebhook(req.body)
    : null;

  res.status(result.duplicate ? 200 : 202).json({
    accepted: true,
    duplicate: result.duplicate,
    eventId: result.event.id,
    status: result.duplicate ? "ignored" : result.event.status,
    meta: metaResult,
  });
});

router.get("/meta", (req: Request, res: Response) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).send("Forbidden");
});

export default router;
