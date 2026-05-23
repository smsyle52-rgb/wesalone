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
const AI_PROVIDER      = optionalEnv("AI_PROVIDER");           // 'vertex' | 'gemini' | 'mock'
const VERTEX_PROJECT_ID = optionalEnv("VERTEX_PROJECT_ID") ?? optionalEnv("GCP_PROJECT_ID") ?? optionalEnv("GOOGLE_CLOUD_PROJECT");
const VERTEX_LOCATION  = optionalEnv("VERTEX_LOCATION") ?? optionalEnv("GCP_LOCATION");
const VERTEX_MODEL     = optionalEnv("VERTEX_MODEL");
const AI_MAX_OUTPUT_TOKENS = optionalEnv("AI_MAX_OUTPUT_TOKENS");
const AI_TEMPERATURE   = optionalEnv("AI_TEMPERATURE");
const ALLOWED_ORIGINS  = optionalEnv("ALLOWED_ORIGINS");       // CORS allow list (comma-sep)
const PUBLIC_BASE_URL  = optionalEnv("PUBLIC_BASE_URL") ?? optionalEnv("APP_BASE_URL");
const STORAGE_PROVIDER = optionalEnv("STORAGE_PROVIDER");      // 'gcs' | 'local'
const GCS_BUCKET       = optionalEnv("GCS_BUCKET");            // Google Cloud Storage bucket
const LOG_LEVEL        = optionalEnv("LOG_LEVEL", "info")!;
const SERVE_STATIC     = optionalEnv("SERVE_STATIC");          // 'true' → API serves dist/public (Cloud Run single-container)

export const env = {
  NODE_ENV,
  DATABASE_URL,
  SESSION_SECRET,
  PORT: Number(PORT),
  GEMINI_API_KEY,
  AI_PROVIDER,
  VERTEX_PROJECT_ID,
  VERTEX_LOCATION,
  VERTEX_MODEL,
  AI_MAX_OUTPUT_TOKENS,
  AI_TEMPERATURE,
  ALLOWED_ORIGINS,
  PUBLIC_BASE_URL,
  STORAGE_PROVIDER,
  GCS_BUCKET,
  LOG_LEVEL,
  SERVE_STATIC: SERVE_STATIC === "true",
  isProduction,
} as const;
