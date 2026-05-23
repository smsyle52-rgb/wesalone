import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./lib/session";
import { AppError } from "./lib/errors";
import { securityHeaders, requestId } from "./middlewares/securityHeaders";
import { env } from "./lib/env";
import { apiLimiter, webhookLimiter } from "./lib/rateLimiter";
import webhooksRouter from "./modules/integrations/webhooks.routes";

const app: Express = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.set("trust proxy", 1);

app.use(helmet());
app.use(securityHeaders);

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const headerValue = req.headers["x-request-id"];
      const requestIdValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      const id = requestIdValue?.trim() || uuidv4();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
        return callback(new Error("Not allowed by CORS"));
      }
      const normalizedOrigin = origin.replace(/\/$/, "");
      if (allowedOrigins.includes(normalizedOrigin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(requestId);
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/webhooks/")) {
    next();
    return;
  }
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (contentLength > 1_000_000) {
    logger.warn({ path: req.path, contentLength }, "Request payload rejected");
    res.status(413).json({ error: "حجم الطلب أكبر من الحد المسموح", code: "PAYLOAD_TOO_LARGE" });
    return;
  }
  next();
});
app.use("/api/webhooks", webhookLimiter);
app.use("/api/webhooks", express.raw({ type: "application/json", limit: "2mb" }), webhooksRouter);
app.use("/api", apiLimiter);
app.use((req, res, next) => {
  if (req.path.startsWith("/api/webhooks/")) {
    next();
    return;
  }
  express.json({ limit: "1mb" })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: "200kb" }));
app.use(sessionMiddleware);

app.use("/api", router);

// ── Static frontend serving (Cloud Run single-container mode) ──────────────────
// Only active when SERVE_STATIC=true. In Replit, the web artifact serves itself.
if (env.SERVE_STATIC) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // In production build, dist/index.mjs lives in artifacts/api-server/dist/
  // Frontend build lives in artifacts/web/dist/public/
  const staticDir = path.resolve(__dirname, "..", "..", "..", "artifacts", "web", "dist", "public");
  app.use(express.static(staticDir, { index: false }));
  logger.info({ staticDir }, "Serving static frontend");

  // SPA fallback — all non-API routes return index.html
  app.use((req: Request, res: Response) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
} else {
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "المسار غير موجود", code: "NOT_FOUND" });
  });
}

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.messageAr, code: err.code });
    return;
  }
  logger.error({ err, requestId: req.id, url: req.url, method: req.method }, "Unhandled error");
  res.status(500).json({ error: "حدث خطأ غير متوقع", code: "INTERNAL_ERROR" });
});

export default app;
