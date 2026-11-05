// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

// Assigned-only scoping is covered by conversation-assignee-scope.test.ts;
// here the caller is an unrestricted member.
vi.mock("@/features/conversations/lib/assignee-scope", () => ({
  resolveConversationAssigneeScope: vi.fn().mockResolvedValue(undefined),
  resolveAssigneeScopeForUser: vi.fn().mockResolvedValue(undefined),
  assertConversationVisible: vi.fn(),
  assertConversationsVisible: vi.fn(),
  assertContactsVisible: vi.fn(),
  assertContactInboxVisible: vi.fn(),
}))

const mockUpdateReadStatus = vi.fn()

vi.mock("@chatbotx.io/business", () => ({
  conversationService: {
    updateReadStatus: (...args: unknown[]) => mockUpdateReadStatus(...args),
  },
}))

vi.mock("@/lib/safe-action", () => ({
  workspaceActionClient: {
    bindArgsSchemas: () => ({ action: (fn: unknown) => fn }),
  },
}))

const { readConversationAction: readConversationActionUntyped } = await import(
  "../src/features/conversations/actions/read-conversation.action"
)
const readConversationAction = readConversationActionUntyped as unknown as (
  props: unknown,
) => Promise<{ agentLastReadAt: string }>

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateReadStatus.mockResolvedValue(undefined)
})

describe("readConversationAction", () => {
  test("persists a read timestamp and returns exactly the value it wrote", async () => {
    const result = await readConversationAction({
      bindArgsParsedInputs: ["workspace-1", "conversation-1"],
      ctx: { user: { id: "user-1" }, workspaceMemberPermissions: {} },
    } as never)

    expect(mockUpdateReadStatus).toHaveBeenCalledTimes(1)
    const [{ workspaceId, id, agentLastReadAt }] = mockUpdateReadStatus.mock
      .calls[0] as [{ workspaceId: string; id: string; agentLastReadAt: Date }]
    expect(workspaceId).toBe("workspace-1")
    expect(id).toBe("conversation-1")
    expect(result.agentLastReadAt).toBe(agentLastReadAt.toISOString())
  })

  test("propagates a service rejection", async () => {
    mockUpdateReadStatus.mockRejectedValue(new Error("Conversation not found"))

    await expect(
      readConversationAction({
        bindArgsParsedInputs: ["workspace-1", "missing"],
        ctx: { user: { id: "user-1" }, workspaceMemberPermissions: {} },
      } as never),
    ).rejects.toThrow("Conversation not found")
  })
})
