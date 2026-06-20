import type { Request, Response, NextFunction } from "express";

/**
 * Adds basic security response headers to every request.
 * Does NOT set Content-Security-Policy — that is the frontend's responsibility.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

/**
 * Exposes the pino-http request ID as X-Request-Id response header.
 * Allows clients and logs to correlate requests end-to-end.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Request-Id", String(req.id ?? ""));
  next();
}
