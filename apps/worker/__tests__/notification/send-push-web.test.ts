// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const sendNotification = vi.fn()
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification },
}))

vi.mock("expo-server-sdk", () => ({
  Expo: { isExpoPushToken: () => false },
}))

vi.mock("../../src/env", () => ({
  env: {
    EXPO_PUSH_ENABLED: false,
    WEB_PUSH_VAPID_PUBLIC_KEY: "public",
    WEB_PUSH_VAPID_PRIVATE_KEY: "private",
    WEB_PUSH_SUBJECT: "mailto:test@example.com",
  },
}))

const findByOrFail = vi.fn()
const listUserIdsByWorkspaceId = vi.fn()
const listByWorkspaceId = vi.fn()
const findByUserIds = vi.fn()
const deleteByTokens = vi.fn().mockResolvedValue(undefined)

vi.mock("@chatbotx.io/business", () => ({
  conversationService: { findByOrFail },
  workspaceMemberService: { listUserIdsByWorkspaceId, listByWorkspaceId },
  deviceTokenService: { findByUserIds, deleteByTokens },
  contactService: { findById: vi.fn().mockResolvedValue({ fullName: "Ali" }) },
  workspaceService: { find: vi.fn().mockResolvedValue({ language: "en" }) },
}))

vi.mock("../../src/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}))

const { sendPushForNotificationJob } = await import(
  "../../src/notification/handlers/send-push"
)

const subscription = (id: string) =>
  JSON.stringify({
    endpoint: `https://push.example.com/${id}`,
    keys: { p256dh: "p", auth: "a" },
  })

const member = (
  userId: string,
  overrides: {
    browser?: boolean
    newMessageToHuman?: boolean
    permissions?: Record<string, boolean>
  } = {},
) => ({
  userId,
  permissions: overrides.permissions ?? { contacts: true },
  notificationTypes: { newMessageToHuman: overrides.newMessageToHuman ?? true },
  notificationChannels: { browser: overrides.browser ?? true },
})

const incomingJob = {
  type: "notifyIncomingMessage",
  data: {
    workspaceId: "ws-1",
    conversationId: "conv-1",
    messageId: "msg-1",
    messageText: "Hello",
  },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  sendNotification.mockResolvedValue({ statusCode: 201 })
  findByOrFail.mockResolvedValue({
    id: "conv-1",
    assignedUserId: null,
    contactId: "contact-1",
  })
  listUserIdsByWorkspaceId.mockResolvedValue(["u1", "u2", "u3", "u4"])
})

describe("sendPushForNotificationJob — browser push", () => {
  test("sends only to members who turned on browser + new-message alerts", async () => {
    listByWorkspaceId.mockResolvedValue([
      member("u1"),
      member("u2", { browser: false }),
      member("u3", { newMessageToHuman: false }),
      // Assigned-only member: the chat is unassigned, so not theirs.
      member("u4", { permissions: { onlyAssignedContacts: true } }),
    ])
    findByUserIds.mockResolvedValue(
      ["u1", "u2", "u3", "u4"].map((userId) => ({
        userId,
        platform: "web",
        token: subscription(userId),
      })),
    )

    await sendPushForNotificationJob(incomingJob)

    expect(sendNotification).toHaveBeenCalledTimes(1)
    const [target, payload] = sendNotification.mock.calls[0]
    expect(target.endpoint).toBe("https://push.example.com/u1")
    expect(JSON.parse(payload)).toMatchObject({
      title: "Ali",
      body: "Hello",
      url: "/space/ws-1/inbox?conversationId=conv-1",
      tag: "wesal-conversation-conv-1",
    })
  })

  test("an assigned-only member hears about the chat assigned to them", async () => {
    findByOrFail.mockResolvedValue({
      id: "conv-1",
      assignedUserId: "u4",
      contactId: "contact-1",
    })
    listByWorkspaceId.mockResolvedValue([
      member("u4", { permissions: { onlyAssignedContacts: true } }),
    ])
    findByUserIds.mockResolvedValue([
      { userId: "u4", platform: "web", token: subscription("u4") },
    ])

    await sendPushForNotificationJob(incomingJob)

    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  test("prunes revoked and malformed subscriptions, never Expo-style deletion", async () => {
    listByWorkspaceId.mockResolvedValue([member("u1"), member("u2")])
    findByUserIds.mockResolvedValue([
      { userId: "u1", platform: "web", token: subscription("u1") },
      { userId: "u2", platform: "web", token: "not-json" },
    ])
    sendNotification.mockRejectedValue(
      Object.assign(new Error("gone"), { statusCode: 410 }),
    )

    await sendPushForNotificationJob(incomingJob)

    expect(deleteByTokens).toHaveBeenCalledTimes(1)
    expect(deleteByTokens.mock.calls[0][0].tokens.sort()).toEqual(
      [subscription("u1"), "not-json"].sort(),
    )
  })

  test("a temporary push failure keeps the subscription", async () => {
    listByWorkspaceId.mockResolvedValue([member("u1")])
    findByUserIds.mockResolvedValue([
      { userId: "u1", platform: "web", token: subscription("u1") },
    ])
    sendNotification.mockRejectedValue(
      Object.assign(new Error("busy"), { statusCode: 503 }),
    )

    await sendPushForNotificationJob(incomingJob)

    expect(deleteByTokens).not.toHaveBeenCalled()
  })
})
