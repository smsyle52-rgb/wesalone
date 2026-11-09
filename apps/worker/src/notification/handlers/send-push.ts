import {
  contactService,
  conversationService,
  deviceTokenService,
  workspaceMemberService,
  workspaceService,
} from "@chatbotx.io/business"
import type {
  ConversationModel,
  UserDeviceTokenModel,
} from "@chatbotx.io/database/types"
import type { NotificationJobData } from "@chatbotx.io/worker-config"
import { Expo, type ExpoPushMessage, type ExpoPushToken } from "expo-server-sdk"
import { logger } from "../../lib/logger"
import { buildNotificationContent } from "../lib/build-notification-content"
import { getExpoClient } from "../lib/expo"
import {
  isWebPushConfigured,
  parseWebPushSubscription,
  sendWebPush,
} from "../lib/web-push"
import { selectWebPushRecipients } from "../lib/web-push-recipients"

/**
 * Recipients = the assigned user, else every workspace member (unassigned
 * conversations fan out — noisy for large workspaces but acceptable for v1;
 * presence-aware suppression is a post-MVP concern).
 */
const resolveRecipientUserIds = async (
  job: NotificationJobData,
  conversation: ConversationModel,
): Promise<string[]> => {
  if (job.type === "notifyConversationAssigned") {
    return [job.data.assignedUserId]
  }

  const excludeUserId = job.data.excludeUserId
  const recipientUserIds = conversation.assignedUserId
    ? [conversation.assignedUserId]
    : await workspaceMemberService.listUserIdsByWorkspaceId({
        workspaceId: job.data.workspaceId,
      })

  return excludeUserId
    ? recipientUserIds.filter((userId) => userId !== excludeUserId)
    : recipientUserIds
}

const resolveNotificationContent = async (
  job: NotificationJobData,
  conversation: ConversationModel,
): Promise<{ title: string; body: string }> => {
  const { workspaceId } = job.data

  const [contact, workspace] = await Promise.all([
    contactService.findById({
      workspaceId,
      id: conversation.contactId,
    }),
    workspaceService.find({ where: { id: workspaceId } }),
  ])

  return buildNotificationContent({
    job,
    contactFullName: contact?.fullName,
    workspaceLanguage: workspace?.language,
  })
}

type NotificationContent = { title: string; body: string }

/** Browser subscriptions are stored as device tokens with platform "web". */
const isWebToken = (deviceToken: UserDeviceTokenModel): boolean =>
  deviceToken.platform === "web"

export const sendPushForNotificationJob = async (
  job: NotificationJobData,
): Promise<void> => {
  const expo = getExpoClient()
  const webPushReady = isWebPushConfigured()
  if (!(expo || webPushReady)) {
    return
  }

  const conversation = await conversationService.findByOrFail({
    where: { id: job.data.conversationId, workspaceId: job.data.workspaceId },
  })

  const recipientUserIds = await resolveRecipientUserIds(job, conversation)
  if (recipientUserIds.length === 0) {
    return
  }

  const deviceTokens = await deviceTokenService.findByUserIds({
    userIds: recipientUserIds,
  })
  if (deviceTokens.length === 0) {
    return
  }

  let content: Promise<NotificationContent> | undefined
  const getContent = () => {
    content ??= resolveNotificationContent(job, conversation)
    return content
  }

  const webTokens = deviceTokens.filter(isWebToken)
  const mobileTokens = deviceTokens.filter((token) => !isWebToken(token))

  // Browser push is independent of Expo: one failing must not stop the other.
  const [webResult, expoResult] = await Promise.allSettled([
    webPushReady && webTokens.length > 0
      ? sendBrowserPush({
          job,
          conversation,
          recipientUserIds,
          webTokens,
          getContent,
        })
      : Promise.resolve(),
    expo && mobileTokens.length > 0
      ? sendExpoPush({ expo, job, mobileTokens, getContent })
      : Promise.resolve(),
  ])
  if (webResult.status === "rejected") {
    logger.warn({ err: webResult.reason }, "browser push failed")
  }
  if (expoResult.status === "rejected") {
    throw expoResult.reason
  }
}

const sendBrowserPush = async (props: {
  job: NotificationJobData
  conversation: ConversationModel
  recipientUserIds: string[]
  webTokens: UserDeviceTokenModel[]
  getContent: () => Promise<NotificationContent>
}): Promise<void> => {
  const { job, conversation } = props
  const members = await workspaceMemberService.listByWorkspaceId({
    workspaceId: job.data.workspaceId,
  })
  const allowed = selectWebPushRecipients({
    job,
    conversationAssignedUserId: conversation.assignedUserId ?? null,
    members,
    candidateUserIds: props.recipientUserIds,
  })
  const targets = props.webTokens.filter((token) => allowed.has(token.userId))
  if (targets.length === 0) {
    return
  }

  const { workspaceId, conversationId } = job.data
  const { title, body } = await props.getContent()
  const payload = {
    title,
    body,
    url: `/space/${workspaceId}/inbox?conversationId=${conversationId}`,
    tag: `wesal-conversation-${conversationId}`,
  }

  const goneTokens: string[] = []
  await Promise.all(
    targets.map(async (deviceToken) => {
      const subscription = parseWebPushSubscription(deviceToken.token)
      if (!subscription) {
        goneTokens.push(deviceToken.token)
        return
      }
      if ((await sendWebPush(subscription, payload)) === "gone") {
        goneTokens.push(deviceToken.token)
      }
    }),
  )
  if (goneTokens.length > 0) {
    await deviceTokenService.deleteByTokens({ tokens: goneTokens })
    logger.info(
      { count: goneTokens.length },
      "pruned expired browser push subscriptions",
    )
  }
}

const sendExpoPush = async (props: {
  expo: NonNullable<ReturnType<typeof getExpoClient>>
  job: NotificationJobData
  mobileTokens: UserDeviceTokenModel[]
  getContent: () => Promise<NotificationContent>
}): Promise<void> => {
  const { expo, job } = props
  const validTokens: ExpoPushToken[] = []
  const invalidTokens: string[] = []
  for (const deviceToken of props.mobileTokens) {
    if (Expo.isExpoPushToken(deviceToken.token)) {
      validTokens.push(deviceToken.token)
    } else {
      invalidTokens.push(deviceToken.token)
    }
  }

  if (invalidTokens.length > 0) {
    await deviceTokenService.deleteByTokens({ tokens: invalidTokens })
  }

  if (validTokens.length === 0) {
    return
  }

  const { workspaceId, conversationId } = job.data
  const messageId = "messageId" in job.data ? job.data.messageId : ""
  const { title, body } = await props.getContent()
  const messages: ExpoPushMessage[] = validTokens.map((token) => ({
    to: token,
    title,
    body,
    data: { workspaceId, conversationId, messageId },
    sound: "default",
    channelId: "default",
    priority: "high",
  }))

  const chunks = expo.chunkPushNotifications(messages)
  const staleTokens: string[] = []
  let failedChunkCount = 0

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk)
      for (const [index, ticket] of tickets.entries()) {
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          const sentMessage = chunk[index]
          if (typeof sentMessage.to === "string") {
            staleTokens.push(sentMessage.to)
          }
        }
      }
    } catch (error) {
      failedChunkCount++
      logger.warn(error, "Expo push chunk failed")
    }
  }

  // If every chunk threw, nothing was delivered — rethrow so BullMQ retries
  // instead of silently dropping the notification. Partial failures stay
  // isolated per-chunk above.
  if (failedChunkCount === chunks.length) {
    throw new Error(`All ${chunks.length} Expo push chunk(s) failed to send`)
  }

  if (staleTokens.length > 0) {
    await deviceTokenService.deleteByTokens({ tokens: staleTokens })
    logger.info(
      { count: staleTokens.length },
      "pruned stale device push tokens",
    )
  }
}
