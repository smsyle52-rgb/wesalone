/**
 * Pure part of the assigned-only conversation scope (no service imports), so
 * the inbox `where` builder stays importable in lightweight unit tests.
 *
 * A member limited to "assigned contacts only" may read a conversation only
 * when it is assigned to them, or to an inbox team they belong to — the same
 * rule the realtime gateway applies to live events (`chatScope: "assigned"`).
 * `undefined` scope means unrestricted.
 */
export type ConversationAssigneeScope = {
  userId: string
  teamIds: string[]
}

/** `where` fragment that keeps only conversations visible to the scope. */
export function buildAssigneeScopeWhere(
  scope: ConversationAssigneeScope,
): Record<string, unknown> {
  return {
    OR: [
      { assignedUserId: scope.userId },
      ...(scope.teamIds.length > 0
        ? [{ assignedInboxTeamId: { in: scope.teamIds } }]
        : []),
    ],
  }
}
