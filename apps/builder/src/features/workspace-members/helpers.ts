import { FULL_WORKSPACE_MEMBER_PERMISSIONS } from "@chatbotx.io/business/workspace-member/permissions"
import type {
  WorkspaceMemberNotificationTypes,
  WorkspaceMemberPermissions,
} from "@chatbotx.io/database/partials"

export function getSuperAdminPermissions(): WorkspaceMemberPermissions {
  return { ...FULL_WORKSPACE_MEMBER_PERMISSIONS }
}

/**
 * Default for a new invite: a regular support agent who sees only the
 * conversations assigned to them (plus the customer's phone/email), with no
 * admin, flows, broadcast, ecommerce or analytics access. Admins flip
 * "superAdmin" on explicitly.
 */
export function getStaffPermissions(): WorkspaceMemberPermissions {
  return {
    superAdmin: false,
    analytics: false,
    flows: false,
    contacts: false,
    onlyAssignedContacts: true,
    emailAndPhone: true,
    broadcast: false,
    ecommerce: false,
  }
}

export function normalizeContactsPermissions(
  permissions: WorkspaceMemberPermissions,
): WorkspaceMemberPermissions {
  return {
    ...permissions,
    onlyAssignedContacts: permissions.contacts
      ? false
      : permissions.onlyAssignedContacts,
  }
}

export function isEnableAtLeastOneNotification(
  notificationTypes: Partial<WorkspaceMemberNotificationTypes>,
) {
  return (
    notificationTypes.notifyAdmin ||
    notificationTypes.newMessageToHuman ||
    notificationTypes.newOrder
  )
}
