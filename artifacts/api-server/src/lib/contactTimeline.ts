import { db, contactTimelineTable } from "@workspace/db";
import { logger } from "./logger";

export async function addContactTimeline(params: {
  workspaceId: string;
  contactId: string;
  eventType: string;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(contactTimelineTable).values({
      workspaceId: params.workspaceId,
      contactId: params.contactId,
      eventType: params.eventType,
      title: params.title,
      description: params.description ?? null,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      createdBy: params.createdBy ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write contact timeline event");
  }
}
