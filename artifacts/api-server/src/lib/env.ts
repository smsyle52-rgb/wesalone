/**
 * Centralized environment variable validation.
 * Import this FIRST in index.ts before any other module.
 * Fails fast with a clear error — never logs secret values.
 */

const isProduction = process.env["NODE_ENV"] === "production";

function requireEnv(name: string, hint: string): string {
  const val = process.env[name];
  if (!val || val.trim() === "") {
    throw new Error(`[env] Missing required env var: ${name}. ${hint}`);
  }
  return val;
}

function optionalEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

// ── Required ──────────────────────────────────────────────────────────────────
const DATABASE_URL = requireEnv("DATABASE_URL", "PostgreSQL connection string is required.");
const SESSION_SECRET = requireEnv("SESSION_SECRET", "Used to sign session cookies.");
const PORT = requireEnv("PORT", "HTTP server port.");

// ── Production-only strength check ────────────────────────────────────────────
if (isProduction && SESSION_SECRET.length < 32) {
  throw new Error("[env] SESSION_SECRET must be at least 32 characters in production.");
}

// ── Optional ──────────────────────────────────────────────────────────────────
const NODE_ENV         = optionalEnv("NODE_ENV", "development")!;
const GEMINI_API_KEY   = optionalEnv("GEMINI_API_KEY");        // AI features optional
const ALLOWED_ORIGINS  = optionalEnv("ALLOWED_ORIGINS");       // CORS allow list (comma-sep)
const STORAGE_PROVIDER = optionalEnv("STORAGE_PROVIDER");      // 'gcs' | 'local'
const GCS_BUCKET       = optionalEnv("GCS_BUCKET");            // Google Cloud Storage bucket
const LOG_LEVEL        = optionalEnv("LOG_LEVEL", "info")!;
const SERVE_STATIC     = optionalEnv("SERVE_STATIC");          // 'true' → API serves dist/public (Cloud Run single-container)
const META_WEBHOOK_VERIFY_TOKEN = optionalEnv("META_WEBHOOK_VERIFY_TOKEN");
const META_WEBHOOK_SECRET       = optionalEnv("META_WEBHOOK_SECRET");
const META_APP_SECRET           = optionalEnv("META_APP_SECRET");
const INTERNAL_SECRET            = isProduction
  ? requireEnv("INTERNAL_SECRET", "Shared secret for internal worker endpoints.")
  : optionalEnv("INTERNAL_SECRET", "")!;

export const env = {
  NODE_ENV,
  DATABASE_URL,
  SESSION_SECRET,
  PORT: Number(PORT),
  GEMINI_API_KEY,
  ALLOWED_ORIGINS,
  STORAGE_PROVIDER,
  GCS_BUCKET,
  LOG_LEVEL,
  SERVE_STATIC: SERVE_STATIC === "true",
  META_WEBHOOK_VERIFY_TOKEN,
  META_WEBHOOK_SECRET,
  META_APP_SECRET,
  INTERNAL_SECRET,
  isProduction,
} as const;
