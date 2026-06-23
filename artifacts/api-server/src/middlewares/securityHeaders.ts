import type { Request, Response, NextFunction } from "express";

// Content-Security-Policy. Shipped as Report-Only first so it observes violations WITHOUT breaking
// the live SPA. Tuned for: self-hosted assets, Facebook SDK (login popup), GCS/FB images, same-origin
// API/SSE. Flip the header name to "Content-Security-Policy" to enforce after reports come back clean.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://graph.facebook.com https://connect.facebook.net",
  "frame-src 'self' https://www.facebook.com https://web.facebook.com",
  "form-action 'self'",
].join("; ");

/**
 * Adds security response headers to every request, including a Report-Only CSP (see above).
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Content-Security-Policy-Report-Only", CONTENT_SECURITY_POLICY);
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
