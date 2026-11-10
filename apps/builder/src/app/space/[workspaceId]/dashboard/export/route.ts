import { timeRangeQueryWithFilterSchema } from "@chatbotx.io/analytics/schemas"
import { createXlsxWorkbook } from "@chatbotx.io/imports/xlsx-writer"
import { getLocale, getTranslations } from "next-intl/server"
import { z } from "zod"
import { toCsvRow } from "@/features/ads/lib/csv"
import {
  type AnalyticsExportSheet,
  analyticsExportSections,
  buildAnalyticsExport,
} from "@/features/analytics/lib/analytics-export"
import { resolveGuardedWorkspaceId } from "@/lib/auth/require-workspace-permission"

export const runtime = "nodejs"

/**
 * Wesal: the Analytics dashboard's Export button. Same tables as the public
 * `analytics.export` procedure, written to Excel (one sheet per table) or to
 * one CSV file (tables one after another).
 */
const exportFileRequestSchema = z.object({
  section: analyticsExportSections.default("all"),
  format: z.enum(["xlsx", "csv"]).default("xlsx"),
})

const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"])

export async function GET(
  request: Request,
  props: { params: Promise<{ workspaceId: string }> },
) {
  const workspaceId = await resolveGuardedWorkspaceId(props.params, "analytics")
  const searchParams = new URL(request.url).searchParams

  const options = exportFileRequestSchema.safeParse({
    section: searchParams.get("section") ?? undefined,
    format: searchParams.get("format") ?? undefined,
  })
  const query = timeRangeQueryWithFilterSchema.safeParse({
    workspaceId,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    timezone: searchParams.get("tz") ?? undefined,
    channels: searchParams.getAll("channels"),
    inboxIds: searchParams.getAll("inboxIds"),
  })
  if (!(options.success && query.success)) {
    return Response.json({ code: "invalidRequest" }, { status: 400 })
  }
  const { section, format } = options.data

  const sheets = await buildAnalyticsExport({ query: query.data, section })
  const t = await getTranslations("analytics.export")
  const label = (group: string, key: string) =>
    t.has(`${group}.${key}`) ? t(`${group}.${key}`) : key
  const titled = (sheet: AnalyticsExportSheet) => ({
    name: label("sheets", sheet.key),
    header: sheet.columns.map((column) => label("columns", column)),
    rows: sheet.rows.map((row) =>
      sheet.columns.map((column) => {
        const value = row[column] ?? null
        return sheet.key === "summary" &&
          column === "metric" &&
          typeof value === "string"
          ? label("metrics", value)
          : value
      }),
    ),
  })

  const day = (date: Date) => date.toISOString().slice(0, 10)
  const base = `analytics-${section}-${day(query.data.from)}-${day(query.data.to)}`
  const headers = { "Cache-Control": "private, no-store" }

  if (format === "csv") {
    let csv = "﻿"
    for (const sheet of sheets.map(titled)) {
      csv += toCsvRow([sheet.name])
      csv += toCsvRow(sheet.header)
      for (const row of sheet.rows) {
        csv += toCsvRow(
          row.map((cell) => (typeof cell === "boolean" ? String(cell) : cell)),
        )
      }
      csv += "\n"
    }
    return new Response(csv, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    })
  }

  const rightToLeft = RTL_LOCALES.has((await getLocale()).split("-")[0] ?? "")
  const file = await createXlsxWorkbook(
    sheets.map((sheet) => ({ ...titled(sheet), rightToLeft })),
  )
  return new Response(file, {
    headers: {
      ...headers,
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  })
}
