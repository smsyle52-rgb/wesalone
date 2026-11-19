// @vitest-environment node

import { describe, expect, test } from "vitest"
import { buildConversationWhere } from "@/features/conversations/queries/build-conversation-where"

describe("buildConversationWhere — cursor", () => {
  test("the tie-break branch keeps lastActivityAt as an explicit eq", () => {
    const lastActivityAt = new Date("2026-11-01T20:57:29.000Z")
    const where = buildConversationWhere(
      "ws-1",
      {},
      { lastActivityAt, id: "42" },
    )

    // A bare Date here is read by Drizzle's relational `where` as an empty
    // operator object and the column is dropped, leaving `id < cursor.id`
    // alone — the inbox then looped over newer conversations with older ids.
    expect(where.OR).toEqual([
      { lastActivityAt: { lt: lastActivityAt } },
      { lastActivityAt: { isNull: true } },
      { lastActivityAt: { eq: lastActivityAt }, id: { lt: "42" } },
    ])
  })

  test("a null-activity cursor only pages through the null tail", () => {
    const where = buildConversationWhere(
      "ws-1",
      {},
      { lastActivityAt: null, id: "42" },
    )

    expect(where.OR).toEqual([
      { lastActivityAt: { isNull: true }, id: { lt: "42" } },
    ])
  })
})
