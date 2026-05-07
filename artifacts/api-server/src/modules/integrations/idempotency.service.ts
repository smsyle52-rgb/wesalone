import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, idempotencyKeysTable } from "@workspace/db";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function hashValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function beginIdempotency(params: {
  workspaceId?: string | null;
  key: string;
  scope: string;
  expiresAt?: Date | null;
}) {
  const [existing] = await db
    .select()
    .from(idempotencyKeysTable)
    .where(and(eq(idempotencyKeysTable.scope, params.scope), eq(idempotencyKeysTable.key, params.key)))
    .limit(1);

  if (existing) return { duplicate: true, record: existing };

  try {
    const [record] = await db
      .insert(idempotencyKeysTable)
      .values({
        workspaceId: params.workspaceId ?? null,
        key: params.key,
        scope: params.scope,
        status: "processing",
        expiresAt: params.expiresAt ?? null,
      })
      .returning();

    return { duplicate: false, record };
  } catch {
    const [record] = await db
      .select()
      .from(idempotencyKeysTable)
      .where(and(eq(idempotencyKeysTable.scope, params.scope), eq(idempotencyKeysTable.key, params.key)))
      .limit(1);

    if (record) return { duplicate: true, record };
    throw new Error("Failed to begin idempotency guard");
  }
}

export async function completeIdempotency(id: string, responseHash?: string | null) {
  const [record] = await db
    .update(idempotencyKeysTable)
    .set({ status: "completed", responseHash: responseHash ?? null })
    .where(eq(idempotencyKeysTable.id, id))
    .returning();
  return record;
}

export async function failIdempotency(id: string, responseHash?: string | null) {
  const [record] = await db
    .update(idempotencyKeysTable)
    .set({ status: "failed", responseHash: responseHash ?? null })
    .where(eq(idempotencyKeysTable.id, id))
    .returning();
  return record;
}

export async function detectDuplicateIdempotency(scope: string, key: string) {
  const [record] = await db
    .select()
    .from(idempotencyKeysTable)
    .where(and(eq(idempotencyKeysTable.scope, scope), eq(idempotencyKeysTable.key, key)))
    .limit(1);

  return record ?? null;
}
