import { z } from "zod"

/** Wesal: names shared by the analytics export API, route and button (no server code). */
export const analyticsExportSections = z.enum([
  "contacts",
  "conversations",
  "all",
])
export type AnalyticsExportSection = z.infer<typeof analyticsExportSections>

export const analyticsExportSheetKeys = [
  "summary",
  "contactsPerDay",
  "newContactsPerDay",
  "blockedContactsPerDay",
  "messagesBySender",
  "messagesByAdmin",
  "humanAgentStats",
  "agentResponseSeries",
  "conversationHandoffs",
  "conversationFollowUps",
  "conversationArchived",
  "conversationAssigned",
  "conversationAssignedByAdmin",
  "uniqueConversationsByAdmin",
  "botMessagesByResult",
  "botMessagesWithResponse",
  "botMessagesNoResponse",
  "botMessagesAiProviders",
] as const
export type AnalyticsExportSheetKey = (typeof analyticsExportSheetKeys)[number]
