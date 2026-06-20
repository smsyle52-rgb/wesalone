import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  notificationsTable,
  notificationPreferencesTable,
  usersTable,
  workspaceMembershipsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

type NotificationInput = {
  workspaceId: string;
  userId?: string | null;
  type: string;
  titleAr: string;
  bodyAr: string;
  link?: string | null;
};

function eventsInclude(events: unknown, type: string): boolean {
  if (!Array.isArray(events)) return true;
  if (events.length === 0) return false;
  return events.includes(type) || events.includes("*");
}

async function shouldNotify(workspaceId: string, userId: string, channel: "in_app" | "email", type: string): Promise<boolean> {
  const [pref] = await db
    .select({ events: notificationPreferencesTable.events })
    .from(notificationPreferencesTable)
    .where(and(
      eq(notificationPreferencesTable.workspaceId, workspaceId),
      eq(notificationPreferencesTable.userId, userId),
      eq(notificationPreferencesTable.channel, channel),
    ))
    .limit(1);

  return pref ? eventsInclude(pref.events, type) : true;
}

export async function sendSystemEmail(to: string, input: { type: string; titleAr: string; bodyAr: string; link?: string | null }): Promise<void> {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
  const from = process.env.EMAIL_FROM ?? "وصال ون <support@wesal.one>";

  if (!webhookUrl || process.env.EMAIL_DRY_RUN === "true") {
    logger.info({ to, type: input.type, title: input.titleAr, link: input.link ?? null }, "Email notification DRY_RUN");
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: input.titleAr,
      text: `${input.bodyAr}${input.link ? `\n\n${input.link}` : ""}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email provider returned ${response.status}`);
  }
}

export async function notifyUser(input: NotificationInput): Promise<void> {
  if (!input.userId) return;

  const inAppEnabled = await shouldNotify(input.workspaceId, input.userId, "in_app", input.type);
  if (inAppEnabled) {
    await db.insert(notificationsTable).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      type: input.type,
      titleAr: input.titleAr,
      bodyAr: input.bodyAr,
      link: input.link ?? null,
    });
  }

  const emailEnabled = await shouldNotify(input.workspaceId, input.userId, "email", input.type);
  if (!emailEnabled) return;

  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, input.userId)).limit(1);
  if (!user?.email) return;

  await sendSystemEmail(user.email, input).catch((err) => {
    logger.warn({ err, type: input.type, userId: input.userId }, "Email notification failed");
  });
}

export async function notifyWorkspace(input: Omit<NotificationInput, "userId">): Promise<void> {
  const memberships = await db
    .select({ userId: workspaceMembershipsTable.userId })
    .from(workspaceMembershipsTable)
    .where(and(
      eq(workspaceMembershipsTable.workspaceId, input.workspaceId),
      eq(workspaceMembershipsTable.status, "active"),
    ));

  for (const membership of memberships) {
    await notifyUser({ ...input, userId: membership.userId });
  }
}

export async function notifyWorkspaceUsers(workspaceId: string, userIds: string[], input: Omit<NotificationInput, "workspaceId" | "userId">): Promise<void> {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueIds.length === 0) return;

  const memberships = await db
    .select({ userId: workspaceMembershipsTable.userId })
    .from(workspaceMembershipsTable)
    .where(and(
      eq(workspaceMembershipsTable.workspaceId, workspaceId),
      eq(workspaceMembershipsTable.status, "active"),
      inArray(workspaceMembershipsTable.userId, uniqueIds),
    ));

  for (const membership of memberships) {
    await notifyUser({ ...input, workspaceId, userId: membership.userId });
  }
}
