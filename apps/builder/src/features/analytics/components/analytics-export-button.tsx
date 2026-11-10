"use client"

import { useAnalysisStore } from "@chatbotx.io/analytics-nextjs/provider/analysis-store-context"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chatbotx.io/ui/components/ui/dropdown-menu"
import { DownloadIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useWorkspaceId } from "@/hooks/routing"
import type { AnalyticsExportSection } from "../lib/analytics-export-schema"

/**
 * Wesal: downloads the dashboard's current range and Channel / Inbox filter as
 * Excel or CSV. The file comes from `dashboard/export`, which builds the same
 * tables as the public `analytics.export` procedure.
 */
export function AnalyticsExportButton({
  section,
}: {
  section: AnalyticsExportSection
}) {
  const t = useTranslations("analytics.export")
  const workspaceId = useWorkspaceId()
  const from = useAnalysisStore((state) => state.from)
  const to = useAnalysisStore((state) => state.to)
  const channels = useAnalysisStore((state) => state.channels)
  const inboxIds = useAnalysisStore((state) => state.inboxIds)
  const timezone = useAnalysisStore(
    (state) => state.defaultSearchParams.timezone,
  )

  const href = (format: "xlsx" | "csv", scope: AnalyticsExportSection) => {
    const params = new URLSearchParams({
      section: scope,
      format,
      from: from.toISOString(),
      to: to.toISOString(),
    })
    if (timezone) {
      params.set("tz", timezone)
    }
    for (const channel of channels) {
      params.append("channels", channel)
    }
    for (const inboxId of inboxIds) {
      params.append("inboxIds", inboxId)
    }
    return `/space/${workspaceId}/dashboard/export?${params.toString()}`
  }

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
          <DownloadIcon aria-hidden />
          {t("button")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={
              <a download href={href("xlsx", section)}>
                {t("thisPageExcel")}
              </a>
            }
          />
          <DropdownMenuItem
            render={
              <a download href={href("csv", section)}>
                {t("thisPageCsv")}
              </a>
            }
          />
          <DropdownMenuItem
            render={
              <a download href={href("xlsx", "all")}>
                {t("allExcel")}
              </a>
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
