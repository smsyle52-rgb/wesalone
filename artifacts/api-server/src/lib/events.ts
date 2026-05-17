import { EventEmitter } from "node:events";
import { db, domainEventsTable } from "@workspace/db";
import { logger } from "./logger";
import type { SessionUser } from "./types";

type DomainEventType =
  | "message.received"
  | "conversation.opened"
  | "contact.tag.added"
  | "order.created"
  | "payment.confirmed";

export type WorkspaceRealtimeEvent = {
  type: string;
  workspaceId: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

const workspaceEvents = new EventEmitter();
workspaceEvents.setMaxListeners(1000);

export function emitWorkspaceEvent(event: Omit<WorkspaceRealtimeEvent, "createdAt"> & { createdAt?: string }): void {
  workspaceEvents.emit(event.workspaceId, {
    ...event,
    createdAt: event.createdAt ?? new Date().toISOString(),
  });
}

export function subscribeWorkspaceEvents(workspaceId: string, listener: (event: WorkspaceRealtimeEvent) => void): () => void {
  workspaceEvents.on(workspaceId, listener);
  return () => workspaceEvents.off(workspaceId, listener);
}

export async function publishDomainEvent(opts: {
  eventType: DomainEventType;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  sessionUser: SessionUser;
}) {
  try {
    await db.insert(domainEventsTable).values({
      workspaceId: opts.sessionUser.activeWorkspaceId,
      eventType: opts.eventType,
      entityType: opts.entityType,
      entityId: opts.entityId,
      payload: {
        ...(opts.payload ?? {}),
        actorUserId: opts.sessionUser.userId,
        actorMembershipId: opts.sessionUser.activeMembershipId,
      },
    });
    emitWorkspaceEvent({
      workspaceId: opts.sessionUser.activeWorkspaceId,
      type: opts.eventType,
      entityType: opts.entityType,
      entityId: opts.entityId,
      payload: opts.payload ?? {},
    });
  } catch (err) {
    logger.warn({ err, eventType: opts.eventType, entityId: opts.entityId }, "Failed to publish domain event");
  }
}
