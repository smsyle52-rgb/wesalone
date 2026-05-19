import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const msg = { error: "عدد المحاولات كبير، حاول لاحقاً", code: "RATE_LIMIT" };

function sessionOrIpKey(req: Request): string {
  const sessionUser = req.session?.user;
  if (sessionUser?.activeWorkspaceId && sessionUser.userId) {
    return `${sessionUser.activeWorkspaceId}:${sessionUser.userId}`;
  }
  return ipKeyGenerator(req.ip ?? "unknown");
}

/** Auth: 10 requests per 15 minutes per IP */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
});

/** AI runs: 30 requests per minute per IP */
export const aiRunLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Payment confirm/reject: 20 per minute per IP */
export const paymentActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Report generate: 10 per minute per IP */
export const reportGenerateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Password change: 5 attempts per 15 minutes per IP */
export const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Webhooks: 600 requests per minute per IP */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
});

/** General API: 300 requests per minute per session-or-IP */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: msg,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: sessionOrIpKey,
  skip: (req) => req.path.startsWith("/webhooks"),
});
