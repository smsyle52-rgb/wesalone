import { conversationService, inboxTeamService } from "@chatbotx.io/business"
import { notFoundException } from "@chatbotx.io/business/errors"
import type { WorkspaceMemberPermissions } from "@chatbotx.io/database/partials"
import { getAssignedContactsUserId } from "@/features/contacts/permissions"
import { hasContactsAccess } from "@/lib/auth/permission-routes"
import {
  buildAssigneeScopeWhere,
  type ConversationAssigneeScope,
} from "./assignee-scope-where"

export {
  buildAssigneeScopeWhere,
  type ConversationAssigneeScope,
} from "./assignee-scope-where"

type Permissions = WorkspaceMemberPermissions | Record<string, unknown>

/** Loads the member's teams for an already-known restricted user id. */
export async function resolveAssigneeScopeForUser(input: {
  workspaceId: string
  restrictToAssignedUserId: string | undefined
}): Promise<ConversationAssigneeScope | undefined> {
  if (!input.restrictToAssignedUserId) {
    return
  }
  const teamIds = await inboxTeamService.listTeamIdsByUserId({
    workspaceId: input.workspaceId,
    userId: input.restrictToAssignedUserId,
  })
  return { userId: input.restrictToAssignedUserId, teamIds }
}

/**
 * Resolves the conversation scope for an authenticated member. A member with
 * neither contacts access nor assigned-only access sees nothing (not-found),
 * matching how the contacts section treats the same member.
 */
export async function resolveConversationAssigneeScope(input: {
  workspaceId: string
  userId: string
  permissions: Permissions
}): Promise<ConversationAssigneeScope | undefined> {
  if (!hasContactsAccess(input.permissions)) {
    throw notFoundException("Conversation not found")
  }
  return await resolveAssigneeScopeForUser({
    workspaceId: input.workspaceId,
    restrictToAssignedUserId: getAssignedContactsUserId({
      permissions: input.permissions,
      userId: input.userId,
    }),
  })
}

/**
 * Throws not-found unless the conversation is visible to the scope. Always
 * reads the live assignment (never the cached row), so reassigning a chat takes
 * effect on the very next request.
 */
export async function assertConversationVisible(input: {
  workspaceId: string
  conversationId: string
  scope: ConversationAssigneeScope | undefined
}): Promise<void> {
  if (!input.scope) {
    return
  }
  const visible = await conversationService.findFirstQuery({
    where: {
      id: input.conversationId,
      workspaceId: input.workspaceId,
      ...buildAssigneeScopeWhere(input.scope),
    },
  })
  if (!visible) {
    throw notFoundException("Conversation not found")
  }
}

/** Same check for a contact-inbox id (messages listed without a conversation). */
export async function assertContactInboxVisible(input: {
  workspaceId: string
  contactInboxId: string
  scope: ConversationAssigneeScope | undefined
}): Promise<void> {
  if (!input.scope) {
    return
  }
  const visible = await conversationService.findFirstQuery({
    where: {
      workspaceId: input.workspaceId,
      contactInboxes: { id: input.contactInboxId },
      ...buildAssigneeScopeWhere(input.scope),
    },
  })
  if (!visible) {
    throw notFoundException("Conversation not found")
  }
}

/**
 * Bulk actions (archive, bot on/off, …): every id must be visible to the
 * scope, otherwise nothing runs. All-or-nothing keeps a crafted request from
 * touching another agent's conversation hidden among the caller's own.
 */
export async function assertConversationsVisible(input: {
  workspaceId: string
  conversationIds: string[]
  scope: ConversationAssigneeScope | undefined
}): Promise<void> {
  if (!input.scope || input.conversationIds.length === 0) {
    return
  }
  const ids = [...new Set(input.conversationIds)]
  const visible = await conversationService.findManyQuery({
    where: {
      workspaceId: input.workspaceId,
      id: { in: ids },
      ...buildAssigneeScopeWhere(input.scope),
    },
  })
  if (visible.length !== ids.length) {
    throw notFoundException("Conversation not found")
  }
}

/** Contact-keyed bulk actions (assign): each contact needs a visible conversation. */
export async function assertContactsVisible(input: {
  workspaceId: string
  contactIds: string[]
  scope: ConversationAssigneeScope | undefined
}): Promise<void> {
  if (!input.scope || input.contactIds.length === 0) {
    return
  }
  const ids = [...new Set(input.contactIds)]
  const visible = await conversationService.findManyQuery({
    where: {
      workspaceId: input.workspaceId,
      contactId: { in: ids },
      ...buildAssigneeScopeWhere(input.scope),
    },
  })
  const visibleContactIds = new Set(visible.map((c) => String(c.contactId)))
  if (ids.some((id) => !visibleContactIds.has(id))) {
    throw notFoundException("Conversation not found")
  }
}
