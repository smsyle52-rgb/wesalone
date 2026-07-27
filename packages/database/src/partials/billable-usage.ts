import { z } from "zod"

export const billableUsageStatuses = z.enum([
  "reserved",
  "settled",
  "released",
  "settlement_pending",
])
export type BillableUsageStatus = z.infer<typeof billableUsageStatuses>

export const billableUsageCategories = z.enum([
  "language",
  "image_analysis",
  "image_generation",
  "image_editing",
  "transcription",
  "speech",
  "embedding_document",
  "embedding_query",
  "knowledge_search",
  "summarization",
  "web_search",
  "tool",
])
export type BillableUsageCategory = z.infer<typeof billableUsageCategories>
