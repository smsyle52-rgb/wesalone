import express, { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "node:crypto";
import { auditFromRequest, createAuditLog, type AuditAction } from "../../lib/audit";
import type { AuthenticatedRequest } from "../../lib/types";
import { requirePermission } from "../../middlewares/requirePermission";
import { requireSession } from "../../middlewares/requireSession";
import {
  BUSINESS_PROFILE_IMAGE_MAX_BYTES,
  BUSINESS_PROFILE_IMAGE_MIME_TYPES,
  businessProfileUpdateSchema,
} from "./whatsapp-business-profile.schema";
import {
  syncBusinessProfile,
  updateBusinessProfile,
  updateBusinessProfilePhoto,
} from "./whatsapp-business-profile.service";
import {
  buildBusinessProfileAuditData,
  WhatsAppBusinessProfileError,
} from "../../services/meta-whatsapp-business-profile";

const router = Router();
router.use(requireSession);

const rawImageParser = express.raw({ type: "*/*", limit: BUSINESS_PROFILE_IMAGE_MAX_BYTES });

function contentType(req: AuthenticatedRequest): string {
  return String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

function sanitizeFileName(value: unknown, mimeType: string): string {
  const fallback = mimeType === "image/png" ? "business-profile.png" : "business-profile.jpg";
  if (typeof value !== "string" || !value.trim()) return fallback;
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return sanitized || fallback;
}

function parseProfileImage(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const mimeType = contentType(req);
  if (!BUSINESS_PROFILE_IMAGE_MIME_TYPES.includes(mimeType as (typeof BUSINESS_PROFILE_IMAGE_MIME_TYPES)[number])) {
    res.status(415).json({
      error: "نوع الصورة غير مدعوم. استخدم JPEG أو PNG.",
      code: "PROFILE_IMAGE_MIME_NOT_ALLOWED",
      correlationId: randomUUID(),
    });
    return;
  }

  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > BUSINESS_PROFILE_IMAGE_MAX_BYTES) {
    res.status(413).json({
      error: "حجم الصورة يتجاوز الحد المسموح وهو 5 ميجابايت.",
      code: "PROFILE_IMAGE_TOO_LARGE",
      correlationId: randomUUID(),
    });
    return;
  }

  rawImageParser(req, res, (error) => {
    if (error) {
      const tooLarge = (error as { type?: string }).type === "entity.too.large";
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge
          ? "حجم الصورة يتجاوز الحد المسموح وهو 5 ميجابايت."
          : "تعذر قراءة ملف الصورة.",
        code: tooLarge ? "PROFILE_IMAGE_TOO_LARGE" : "PROFILE_IMAGE_INVALID",
        correlationId: randomUUID(),
      });
      return;
    }
    next();
  });
}

function sendProfileError(res: Response, error: unknown, correlationId: string) {
  if (error instanceof WhatsAppBusinessProfileError) {
    res.status(error.statusCode).json({
      error: error.messageAr,
      code: error.code,
      correlationId,
      meta: error.safeMeta,
      lastSyncedProfile: error.lastSyncedProfile,
      lastSyncedAt: error.lastSyncedAt,
    });
    return;
  }
  throw error;
}

async function writeAudit(params: {
  req: AuthenticatedRequest;
  action: AuditAction;
  accountId: string;
  accountLabel?: string;
  correlationId: string;
  operation: "sync" | "update" | "photo_update";
  status: "success" | "failed";
  changedFields?: string[];
  error?: unknown;
}) {
  await createAuditLog({
    ...auditFromRequest(params.req, params.req.sessionUser),
    requestId: params.correlationId,
    action: params.action,
    severity: params.status === "success" ? "info" : "warning",
    entityType: "channel_account",
    entityId: params.accountId,
    entityLabel: params.accountLabel ?? "WhatsApp Business Profile",
    newData: buildBusinessProfileAuditData({
      correlationId: params.correlationId,
      operation: params.operation,
      status: params.status,
      changedFields: params.changedFields,
      error: params.error,
    }),
  });
}

router.get(
  "/accounts/:channelAccountId/business-profile",
  requirePermission("integrations:read"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const correlationId = randomUUID();
    const accountId = String(req.params.channelAccountId);
    try {
      const result = await syncBusinessProfile(req.sessionUser.activeWorkspaceId, accountId);
      await writeAudit({
        req,
        action: "whatsapp_business_profile_sync",
        accountId: result.account.id,
        accountLabel: result.account.displayName,
        correlationId,
        operation: "sync",
        status: "success",
      });
      res.json({
        profile: result.profile,
        lastSyncedProfile: result.profile,
        lastSyncedAt: result.syncedAt,
        source: "meta",
        correlationId,
      });
    } catch (error) {
      try {
        await writeAudit({
          req,
          action: "whatsapp_business_profile_sync",
          accountId,
          correlationId,
          operation: "sync",
          status: "failed",
          error,
        });
      } catch {
        // Audit failure must not mask the original safe error.
      }
      try {
        sendProfileError(res, error, correlationId);
      } catch (unexpected) {
        next(unexpected);
      }
    }
  },
);

router.patch(
  "/accounts/:channelAccountId/business-profile",
  requirePermission("integrations:update"),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const correlationId = randomUUID();
    const accountId = String(req.params.channelAccountId);
    const parsed = businessProfileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "بيانات الملف التجاري غير صالحة",
        code: "BUSINESS_PROFILE_VALIDATION_ERROR",
        correlationId,
      });
      return;
    }

    try {
      const result = await updateBusinessProfile(req.sessionUser.activeWorkspaceId, accountId, parsed.data);
      const changedFields = Object.keys(parsed.data);
      await writeAudit({
        req,
        action: "whatsapp_business_profile_update",
        accountId: result.account.id,
        accountLabel: result.account.displayName,
        correlationId,
        operation: "update",
        status: "success",
        changedFields,
      });
      res.json({
        profile: result.profile,
        lastSyncedProfile: result.profile,
        lastSyncedAt: result.syncedAt,
        source: "meta",
        message: "تم تحديث الملف التجاري وتأكيده من Meta",
        correlationId,
      });
    } catch (error) {
      try {
        await writeAudit({
          req,
          action: "whatsapp_business_profile_update",
          accountId,
          correlationId,
          operation: "update",
          status: "failed",
          changedFields: Object.keys(parsed.data),
          error,
        });
      } catch {
        // Audit failure must not mask the original safe error.
      }
      try {
        sendProfileError(res, error, correlationId);
      } catch (unexpected) {
        next(unexpected);
      }
    }
  },
);

router.post(
  "/accounts/:channelAccountId/business-profile/photo",
  requirePermission("integrations:update"),
  parseProfileImage,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const correlationId = randomUUID();
    const accountId = String(req.params.channelAccountId);
    const mimeType = contentType(req);
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const fileName = sanitizeFileName(req.headers["x-file-name"], mimeType);

    try {
      const result = await updateBusinessProfilePhoto(req.sessionUser.activeWorkspaceId, accountId, {
        buffer,
        mimeType,
        fileName,
      });
      await writeAudit({
        req,
        action: "whatsapp_business_profile_photo_update",
        accountId: result.account.id,
        accountLabel: result.account.displayName,
        correlationId,
        operation: "photo_update",
        status: "success",
        changedFields: ["profile_picture_url"],
      });
      res.json({
        profile: result.profile,
        lastSyncedProfile: result.profile,
        lastSyncedAt: result.syncedAt,
        source: "meta",
        message: "تم رفع الصورة وتحديث الملف التجاري وتأكيده من Meta",
        correlationId,
      });
    } catch (error) {
      try {
        await writeAudit({
          req,
          action: "whatsapp_business_profile_photo_update",
          accountId,
          correlationId,
          operation: "photo_update",
          status: "failed",
          changedFields: ["profile_picture_url"],
          error,
        });
      } catch {
        // Audit failure must not mask the original safe error.
      }
      try {
        sendProfileError(res, error, correlationId);
      } catch (unexpected) {
        next(unexpected);
      }
    }
  },
);

export default router;
