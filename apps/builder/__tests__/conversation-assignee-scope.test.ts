// @vitest-environment node

import { describe, expect, test } from "vitest"
import { buildAssigneeScopeWhere } from "@/features/conversations/lib/assignee-scope-where"
import { buildConversationWhere } from "@/features/conversations/queries/build-conversation-where"

const WORKSPACE_ID = "1"

describe("buildAssigneeScopeWhere", () => {
  test("limits to the member's own conversations when they have no teams", () => {
    expect(buildAssigneeScopeWhere({ userId: "7", teamIds: [] })).toEqual({
      OR: [{ assignedUserId: "7" }],
    })
  })

  test("also allows conversations assigned to the member's teams", () => {
    expect(
      buildAssigneeScopeWhere({ userId: "7", teamIds: ["30", "31"] }),
    ).toEqual({
      OR: [
        { assignedUserId: "7" },
        { assignedInboxTeamId: { in: ["30", "31"] } },
      ],
    })
  })
})

describe("buildConversationWhere with an assigned-only scope", () => {
  const scope = { userId: "7", teamIds: [] }
  const scopeClause = { OR: [{ assignedUserId: "7" }] }

  test("unrestricted members get no assignee clause", () => {
    const where = buildConversationWhere(WORKSPACE_ID, {}, null)
    expect(JSON.stringify(where)).not.toContain("assignedUserId")
  })

  test("restricted members always carry the scope clause in AND", () => {
    const where = buildConversationWhere(WORKSPACE_ID, {}, null, {
      assignee: scope,
    })
    expect(where.AND).toContainEqual(scopeClause)
  })

  test("the cursor OR does not replace the scope", () => {
    const where = buildConversationWhere(
      WORKSPACE_ID,
      {},
      { lastActivityAt: new Date("2026-11-05T00:00:00Z"), id: "99" },
      { assignee: scope },
    )
    expect(where.OR).toBeDefined()
    expect(where.AND).toContainEqual(scopeClause)
  })

  test("other filters that write AND keep the scope", () => {
    const where = buildConversationWhere(
      WORKSPACE_ID,
      { tags: ["unread"] },
      null,
      { assignee: scope },
    )
    expect(where.AND).toContainEqual(scopeClause)
  })

  test("the assignee filter cannot widen the scope", () => {
    const where = buildConversationWhere(
      WORKSPACE_ID,
      { assignedId: "u_8" },
      null,
      { assignee: scope },
    )
    expect(where.AND).toContainEqual(scopeClause)
  })
})
