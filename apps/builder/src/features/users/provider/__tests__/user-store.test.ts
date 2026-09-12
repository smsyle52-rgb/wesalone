import { ORPCError } from "@orpc/client"
import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listWorkspaceMembersAuthenticatedAPI: vi.fn(),
  listInboxTeamsAuthenticatedAPI: vi.fn(),
}))

vi.mock("@/lib/orpc/orpc", () => ({
  client: {
    workspaceMembersAPI: {
      listWorkspaceMembersAuthenticatedAPI:
        mocks.listWorkspaceMembersAuthenticatedAPI,
    },
    inboxTeamsAPI: {
      listInboxTeamsAuthenticatedAPI: mocks.listInboxTeamsAuthenticatedAPI,
    },
  },
}))

const { createUserStore } = await import("../user-store")

beforeEach(() => {
  mocks.listWorkspaceMembersAuthenticatedAPI.mockReset()
  mocks.listInboxTeamsAuthenticatedAPI.mockReset()
})

describe("getAllWorkspaceMembers", () => {
  test("fetches workspace members with workspaceId and maxPerPage", async () => {
    mocks.listWorkspaceMembersAuthenticatedAPI.mockResolvedValueOnce({
      data: [{ id: "member-1", name: "Alice" }],
    })

    const store = createUserStore({ workspaceId: "workspace-1" })

    await store.getState().getAllWorkspaceMembers()

    expect(mocks.listWorkspaceMembersAuthenticatedAPI).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      perPage: 999_999_999,
    })
    expect(store.getState().workspaceMembers).toEqual([
      { id: "member-1", name: "Alice" },
    ])
  })

  test("is a no-op when workspaceId is empty", async () => {
    const store = createUserStore({ workspaceId: "" })

    await store.getState().getAllWorkspaceMembers()

    expect(mocks.listWorkspaceMembersAuthenticatedAPI).not.toHaveBeenCalled()
  })

  test("is a no-op while a fetch is already in flight, independent of inbox teams loading", async () => {
    let resolveFetch!: (value: { data: unknown[] }) => void
    const pending = new Promise<{ data: unknown[] }>((resolve) => {
      resolveFetch = resolve
    })
    mocks.listWorkspaceMembersAuthenticatedAPI.mockReturnValueOnce(pending)

    const store = createUserStore({ workspaceId: "workspace-1" })

    const first = store.getState().getAllWorkspaceMembers()
    // A separate loading flag — the in-flight members fetch must not block
    // the (now inert) inbox-teams call.
    await store.getState().getAllInboxTeams()

    expect(mocks.listInboxTeamsAuthenticatedAPI).not.toHaveBeenCalled()

    await store.getState().getAllWorkspaceMembers()
    expect(mocks.listWorkspaceMembersAuthenticatedAPI).toHaveBeenCalledTimes(1)

    resolveFetch({ data: [] })
    await first
  })

  test("sets the ORPCError message on a rejected request", async () => {
    mocks.listWorkspaceMembersAuthenticatedAPI.mockRejectedValueOnce(
      new ORPCError("INTERNAL_SERVER_ERROR", { message: "HTTP 500" }),
    )

    const store = createUserStore({ workspaceId: "workspace-1" })

    await store.getState().getAllWorkspaceMembers()

    expect(store.getState().error).toBe("HTTP 500")
    expect(store.getState().loadingWorkspaceMembers).toBe(false)
  })

  test("falls back to a generic message for a non-ORPCError rejection", async () => {
    mocks.listWorkspaceMembersAuthenticatedAPI.mockRejectedValueOnce(
      new Error("network down"),
    )

    const store = createUserStore({ workspaceId: "workspace-1" })

    await store.getState().getAllWorkspaceMembers()

    expect(store.getState().error).toBe("Failed to fetch workspace members")
  })
})

describe("getAllInboxTeams", () => {
  /**
   * Inbox teams could only ever be created from the commercially licensed
   * settings pages, which this deployment does not ship — the endpoint is
   * gone, so the store clears the list instead of calling it. Kept as a test
   * rather than deleted: a future upstream merge that re-wires the fetch
   * would otherwise reintroduce a call that 404s on every workspace load.
   */
  test("clears the list without calling the removed endpoint", async () => {
    const store = createUserStore({
      workspaceId: "workspace-1",
      inboxTeams: [{ id: "team-1", name: "Sales" }] as never,
      loadingInboxTeams: true,
    })

    await store.getState().getAllInboxTeams()

    expect(mocks.listInboxTeamsAuthenticatedAPI).not.toHaveBeenCalled()
    expect(store.getState().inboxTeams).toEqual([])
    expect(store.getState().loadingInboxTeams).toBe(false)
    expect(store.getState().error).toBeNull()
  })
})

describe("initializeAgentsAndInboxTeams", () => {
  test("fetches both workspace members and inbox teams in parallel and marks initialized", async () => {
    mocks.listWorkspaceMembersAuthenticatedAPI.mockResolvedValueOnce({
      data: [{ id: "member-1", name: "Alice" }],
    })

    const store = createUserStore({ workspaceId: "workspace-1" })

    await store.getState().initializeAgentsAndInboxTeams()

    expect(mocks.listWorkspaceMembersAuthenticatedAPI).toHaveBeenCalledTimes(1)
    expect(mocks.listInboxTeamsAuthenticatedAPI).not.toHaveBeenCalled()
    expect(store.getState().workspaceMembers).toEqual([
      { id: "member-1", name: "Alice" },
    ])
    expect(store.getState().inboxTeams).toEqual([])
    expect(store.getState().initialized).toBe(true)
  })

  test("does not fetch again once already initialized", async () => {
    mocks.listWorkspaceMembersAuthenticatedAPI.mockResolvedValue({ data: [] })

    const store = createUserStore({ workspaceId: "workspace-1" })

    await store.getState().initializeAgentsAndInboxTeams()
    await store.getState().initializeAgentsAndInboxTeams()

    expect(mocks.listWorkspaceMembersAuthenticatedAPI).toHaveBeenCalledTimes(1)
  })
})
