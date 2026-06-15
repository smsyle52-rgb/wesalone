import { createHash } from "node:crypto";
import { logger } from "../lib/logger";

// Vertex AI text-embedding-005 returns 768-dimensional vectors for retrieval embeddings.
const VECTOR_SIZE = 768;
const CACHE_LIMIT = 1000;
const EMBEDDING_MODEL = process.env.VERTEX_EMBEDDING_MODEL ?? "text-embedding-005";
const EMBEDDINGS_DRY_RUN =
  process.env.EMBEDDINGS_DRY_RUN !== "false" &&
  process.env.AI_EMBEDDINGS_DRY_RUN !== "false";
const VERTEX_PROJECT_ID =
  process.env.VERTEX_PROJECT_ID ??
  process.env.GCP_PROJECT_ID ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GCLOUD_PROJECT;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION ?? process.env.GCP_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

type CacheEntry = {
  vector: number[];
  model: string;
  provider: "vertex" | "pseudo";
};

const cache = new Map<string, CacheEntry>();

function cacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function setCache(key: string, entry: CacheEntry): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, entry);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function pseudoVector(text: string): number[] {
  const seed = createHash("sha256").update(text).digest();
  const vector = new Array<number>(VECTOR_SIZE);
  let norm = 0;

  for (let i = 0; i < VECTOR_SIZE; i += 1) {
    const byte = seed[i % seed.length];
    const value = (byte / 255) * 2 - 1;
    vector[i] = value;
    norm += value * value;
  }

  const scale = Math.sqrt(norm) || 1;
  return vector.map((value) => Number((value / scale).toFixed(8)));
}

async function getMetadataAccessToken(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
      headers: { "Metadata-Flavor": "Google" },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`metadata token request failed with status ${res.status}`);
    const data = await res.json() as { access_token?: string };
    if (!data.access_token) throw new Error("metadata server did not return access_token");
    return data.access_token;
  } finally {
    clearTimeout(timeout);
  }
}

async function embedWithVertex(text: string): Promise<number[]> {
  if (!VERTEX_PROJECT_ID) throw new Error("Vertex project is not configured");
  const token = await getMetadataAccessToken();
  const host = VERTEX_LOCATION === "global" ? "aiplatform.googleapis.com" : `${VERTEX_LOCATION}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1/projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}:predict`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [{ content: text, task_type: "RETRIEVAL_DOCUMENT" }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vertex embedding failed with status ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as {
    predictions?: Array<{ embeddings?: { values?: number[] } }>;
  };
  const vector = data.predictions?.[0]?.embeddings?.values;
  if (!Array.isArray(vector) || vector.length === 0) throw new Error("Vertex embedding returned no vector");
  return vector;
}

export async function embedWithMetadata(text: string): Promise<CacheEntry> {
  const trimmed = text.trim();
  const key = cacheKey(trimmed);
  const cached = cache.get(key);
  if (cached) return cached;

  if (!trimmed) {
    const empty = { vector: pseudoVector("empty"), model: "pseudo-hash-v1", provider: "pseudo" as const };
    setCache(key, empty);
    return empty;
  }

  if (!EMBEDDINGS_DRY_RUN && VERTEX_PROJECT_ID) {
    try {
      const entry = { vector: await embedWithVertex(trimmed), model: EMBEDDING_MODEL, provider: "vertex" as const };
      setCache(key, entry);
      return entry;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Vertex embedding failed; using deterministic fallback");
    }
  }

  const entry = { vector: pseudoVector(trimmed), model: "pseudo-hash-v1", provider: "pseudo" as const };
  setCache(key, entry);
  return entry;
}

export async function embed(text: string): Promise<number[]> {
  return (await embedWithMetadata(text)).vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom ? dot / denom : 0;
}
