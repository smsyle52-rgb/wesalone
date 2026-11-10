import {
  agentResponseAnalyticsService,
  botMessageAnalyticsService,
  contactAnalyticsService,
  conversationAnalyticsService,
  macAnalyticsService,
  messageAnalyticsService,
} from "@chatbotx.io/analytics"
import type { TimeRangeQueryWithFilter } from "@chatbotx.io/analytics/schemas"
import type {
  AnalyticsExportSection,
  AnalyticsExportSheetKey,
} from "./analytics-export-schema"

export {
  type AnalyticsExportSection,
  type AnalyticsExportSheetKey,
  analyticsExportSections,
  analyticsExportSheetKeys,
} from "./analytics-export-schema"

/**
 * Wesal: one export of the Analytics dashboard (contacts and conversations
 * sections) as plain tables. The public API (`analytics.export`) returns these
 * tables as JSON; the dashboard's export button turns the same tables into an
 * Excel or CSV file. Both read the same services as the dashboard charts, so
 * the numbers match what is on screen for the same range and filters.
 */

export type AnalyticsExportCell = string | number | boolean | null
export type AnalyticsExportRow = Record<string, AnalyticsExportCell>
export type AnalyticsExportSheet = {
  key: AnalyticsExportSheetKey
  columns: string[]
  rows: AnalyticsExportRow[]
}

const toCell = (value: unknown): AnalyticsExportCell => {
  if (value === null || value === undefined) {
    return null
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (typeof value === "bigint") {
    return value.toString()
  }
  return JSON.stringify(value)
}

/** Flattens a service result (array of row objects) into one table. */
const toSheet = (
  key: AnalyticsExportSheetKey,
  data: unknown,
): AnalyticsExportSheet => {
  const list = Array.isArray(data) ? data : []
  const columns: string[] = []
  const rows = list.map((item) => {
    const row: AnalyticsExportRow = {}
    const entries =
      item && typeof item === "object"
        ? Object.entries(item as Record<string, unknown>)
        : [["value", item] as [string, unknown]]
    for (const [column, value] of entries) {
      if (column === "workspaceId") {
        continue
      }
      if (!columns.includes(column)) {
        columns.push(column)
      }
      row[column] = toCell(value)
    }
    return row
  })
  return { key, columns, rows }
}

type SheetLoader = (input: TimeRangeQueryWithFilter) => Promise<unknown>

const contactsSheets: [AnalyticsExportSheetKey, SheetLoader][] = [
  ["contactsPerDay", (q) => contactAnalyticsService.getContactCountsPerDay(q)],
  ["newContactsPerDay", (q) => contactAnalyticsService.getNewContactsPerDay(q)],
  [
    "blockedContactsPerDay",
    (q) => contactAnalyticsService.getBlockedContactsPerDay(q),
  ],
]

const conversationsSheets: [AnalyticsExportSheetKey, SheetLoader][] = [
  [
    "messagesBySender",
    (q) =>
      messageAnalyticsService.getMessagesBySender({ ...q, granularity: "day" }),
  ],
  ["messagesByAdmin", (q) => messageAnalyticsService.getMessagesByAdmin(q)],
  ["humanAgentStats", (q) => messageAnalyticsService.getHumanAgentStats(q)],
  [
    "agentResponseSeries",
    (q) => agentResponseAnalyticsService.getAgentResponseSeries(q),
  ],
  [
    "conversationHandoffs",
    (q) => conversationAnalyticsService.getHandoffsByDay(q),
  ],
  [
    "conversationFollowUps",
    (q) => conversationAnalyticsService.getFollowUpsByDay(q),
  ],
  [
    "conversationArchived",
    (q) => conversationAnalyticsService.getArchivedByDay(q),
  ],
  [
    "conversationAssigned",
    (q) => conversationAnalyticsService.getAssignedByDay(q),
  ],
  [
    "conversationAssignedByAdmin",
    (q) => conversationAnalyticsService.getAssignedByAdmin(q),
  ],
  [
    "uniqueConversationsByAdmin",
    (q) => conversationAnalyticsService.getUniqueConversationsByAdmin(q),
  ],
  [
    "botMessagesByResult",
    (q) =>
      botMessageAnalyticsService.getMessagesByResult({
        ...q,
        granularity: "day",
      }),
  ],
  [
    "botMessagesWithResponse",
    (q) =>
      botMessageAnalyticsService.getMessagesWithResponse({
        ...q,
        granularity: "day",
      }),
  ],
  [
    "botMessagesNoResponse",
    (q) =>
      botMessageAnalyticsService.getMessagesWithNoResponse({
        ...q,
        granularity: "day",
      }),
  ],
  [
    "botMessagesAiProviders",
    (q) => botMessageAnalyticsService.getAIProviderStats(q),
  ],
]

const loadSummary = async (
  q: TimeRangeQueryWithFilter,
  section: AnalyticsExportSection,
): Promise<AnalyticsExportSheet> => {
  const rows: AnalyticsExportRow[] = [
    { metric: "from", value: q.from.toISOString() },
    { metric: "to", value: q.to.toISOString() },
    { metric: "timezone", value: q.timezone },
  ]
  if (section !== "conversations") {
    const [contacts, newContacts, blocked, active] = await Promise.all([
      contactAnalyticsService.getContactsCount(q),
      contactAnalyticsService.getNewContactsCount(q),
      contactAnalyticsService.getBlockedContactsCount(q),
      macAnalyticsService.getActiveContactsByWorkspaceForRange(q),
    ])
    rows.push(
      { metric: "contactsCount", value: toCell(contacts) },
      { metric: "newContactsCount", value: toCell(newContacts) },
      { metric: "blockedContactsCount", value: toCell(blocked) },
      { metric: "activeContactsCount", value: toCell(active) },
    )
  }
  return { key: "summary", columns: ["metric", "value"], rows }
}

export const buildAnalyticsExport = async (props: {
  query: TimeRangeQueryWithFilter
  section: AnalyticsExportSection
}): Promise<AnalyticsExportSheet[]> => {
  const { query, section } = props
  const loaders = [
    ...(section === "conversations" ? [] : contactsSheets),
    ...(section === "contacts" ? [] : conversationsSheets),
  ]
  const [summary, ...sheets] = await Promise.all([
    loadSummary(query, section),
    ...loaders.map(async ([key, load]) => toSheet(key, await load(query))),
  ])
  return [summary, ...sheets]
}
