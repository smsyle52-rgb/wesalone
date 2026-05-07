import rateLimit from "express-rate-limit";

const msg = { error: "عدد المحاولات كبير، حاول لاحقاً", code: "RATE_LIMIT" };

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
