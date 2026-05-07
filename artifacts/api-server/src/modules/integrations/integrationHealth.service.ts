import { and, count, desc, eq } from "drizzle-orm";
import {
  db,
  deadLetterEventsTable,
  integrationHealthChecksTable,
} from "@workspace/db";
import { createAuditLog } from "../../lib/audit";
import type { HealthStatus, IntegrationProvider } from "./integrationTypes";

export async function listIntegrationHealth(workspaceId: string) {
  const healthChecks = await db
    .select()
    .from(integrationHealthChecksTable)
    .where(eq(integrationHealthChecksTable.workspaceId, workspaceId))
    .orderBy(desc(integrationHealthChecksTable.lastCheckedAt));

  const [deadLetters] = await db
    .select({ total: count() })
    .from(deadLetterEventsTable)
    .where(eq(deadLetterEventsTable.workspaceId, workspaceId));

  return {
    healthChecks,
    deadLetterCount: Number(deadLetters?.total ?? 0),
  };
}

export async function setIntegrationHealth(params: {
  workspaceId: string;
  provider: IntegrationProvider;
  providerAccountId?: string | null;
  status: HealthStatus;
  latencyMs?: number | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const conditions = [
    eq(integrationHealthChecksTable.workspaceId, params.workspaceId),
    eq(integrationHealthChecksTable.provider, params.provider),
  ];

  if (params.providerAccountId) {
    conditions.push(eq(integrationHealthChecksTable.providerAccountId, params.providerAccountId));
  }

  const [existing] = await db
    .select()
    .from(integrationHealthChecksTable)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    const [health] = await db
      .update(integrationHealthChecksTable)
      .set({
        status: params.status,
        lastCheckedAt: new Date(),
        latencyMs: params.latencyMs ?? null,
        message: params.message ?? null,
        metadata: params.metadata ?? {},
      })
      .where(eq(integrationHealthChecksTable.id, existing.id))
      .returning();
    await createAuditLog({
      workspaceId: params.workspaceId,
      actorType: "system",
      action: "integration_health_update",
      entityType: "integration_health_check",
      entityId: health.id,
      entityLabel: params.provider,
      oldData: { status: existing.status },
      newData: { status: params.status },
    });
    return health;
  }

  const [health] = await db
    .insert(integrationHealthChecksTable)
    .values({
      workspaceId: params.workspaceId,
      provider: params.provider,
      providerAccountId: params.providerAccountId ?? null,
      status: params.status,
      latencyMs: params.latencyMs ?? null,
      message: params.message ?? null,
      metadata: params.metadata ?? {},
    })
    .returning();
  await createAuditLog({
    workspaceId: params.workspaceId,
    actorType: "system",
    action: "integration_health_update",
    entityType: "integration_health_check",
    entityId: health.id,
    entityLabel: params.provider,
    newData: { status: params.status },
  });
  return health;
}
