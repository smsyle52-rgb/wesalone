import {
  hasContactsAccess,
  hasWorkspacePermission,
  type PermissionsInput,
} from "@chatbotx.io/business/workspace-member/permissions"
import type { NotificationJobData } from "@chatbotx.io/worker-config"

type MemberSettings = {
  userId: string
  permissions: unknown
  notificationTypes: unknown
  notificationChannels: unknown
}

const flag = (value: unknown, key: string): boolean =>
  typeof value === "object" &&
  value !== null &&
  (value as Record<string, unknown>)[key] === true

/**
 * Members of the workspace who should get a browser push for this job. Unlike
 * the mobile app, browser push follows each member's own settings: the
 * "Browser" channel must be on, and new-message alerts also need "New message
 * to human". Members limited to their assigned contacts only hear about
 * conversations assigned to them, and members without contacts access hear
 * about none — the same visibility the inbox gives them.
 */
export const selectWebPushRecipients = (props: {
  job: NotificationJobData
  conversationAssignedUserId: string | null
  members: MemberSettings[]
  candidateUserIds: string[]
}): Set<string> => {
  const candidates = new Set(props.candidateUserIds)
  const selected = new Set<string>()
  for (const member of props.members) {
    if (!candidates.has(member.userId)) {
      continue
    }
    if (!flag(member.notificationChannels, "browser")) {
      continue
    }
    if (
      props.job.type !== "notifyConversationAssigned" &&
      !flag(member.notificationTypes, "newMessageToHuman")
    ) {
      continue
    }
    const permissions = (member.permissions ?? {}) as PermissionsInput
    if (!hasContactsAccess(permissions)) {
      continue
    }
    const assignedOnly =
      !hasWorkspacePermission(permissions, "superAdmin") &&
      hasWorkspacePermission(permissions, "onlyAssignedContacts")
    if (assignedOnly && props.conversationAssignedUserId !== member.userId) {
      continue
    }
    selected.add(member.userId)
  }
  return selected
}
