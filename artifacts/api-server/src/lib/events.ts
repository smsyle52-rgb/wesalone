import { db, domainEventsTable } from "@workspace/db";
import { logger } from "./logger";
import type { SessionUser } from "./types";

type DomainEventType =
  | "message.received"
  | "conversation.opened"
  | "contact.tag.added"
  | "order.created"
  | "payment.confirmed";

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
  } catch (err) {
    logger.warn({ err, eventType: opts.eventType, entityId: opts.entityId }, "Failed to publish domain event");
  }
}
