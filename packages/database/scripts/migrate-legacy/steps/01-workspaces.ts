// Step 1: old `workspaces` (+ their owner from `workspace_memberships`) -> new
// `Workspace` + `User` + `WorkspaceMember`.
//
// Scope, matching the approved migration plan exactly: only the OWNER of each
// old workspace is migrated here (not other invited staff — the old system's
// richer 5-role RBAC has no equivalent in the new system's owner/agent split,
// and the plan didn't ask for staff migration). No `Account.password` row is
// created — migrated owners authenticate for the first time via the new
// system's password-reset flow, per the approved decision to force a reset
// rather than bridge bcrypt -> scrypt.
//
// UserQuota (plan/tier enforcement) is intentionally NOT set here — it depends
// on the confirmed subscription plan, which Step 2 (billing) resolves.

import { and, eq } from "drizzle-orm"
import { db } from "../../../src/client"
import { workspaceMemberRoles } from "../../../src/partials"
import { ROOT_TENANT_ID } from "../../../src/partials/shared"
import {
  userModel,
  workspaceMemberModel,
  workspaceModel,
} from "../../../src/schema"
import { getOrCreateId, setId } from "../id-map"
import { fetchOldWorkspaceOwners, fetchOldWorkspaces } from "../old-db"

// Exact default permissions/notifications a real signup gives a new owner —
// copied from workspaceService.create() (packages/business/src/workspace/service.ts)
// so a migrated owner ends up with the same shape as an organically-created one.
const OWNER_PERMISSIONS = {
  superAdmin: true,
  analytics: true,
  flows: true,
  contacts: true,
  onlyAssignedContacts: true,
  emailAndPhone: true,
  broadcast: true,
  ecommerce: true,
}
const OWNER_NOTIFICATION_TYPES = {
  notifyAdmin: true,
  newMessageToHuman: true,
  newOrder: true,
}
const OWNER_NOTIFICATION_CHANNELS = {
  messenger: true,
  email: false,
  telegram: true,
  browser: true,
}

export type WorkspaceMigrationResult = {
  oldWorkspaceId: string
  newWorkspaceId: string
  oldOwnerUserId: string
  newOwnerUserId: string
}

export const migrateWorkspaces = async (): Promise<
  WorkspaceMigrationResult[]
> => {
  const [workspaces, owners] = await Promise.all([
    fetchOldWorkspaces(),
    fetchOldWorkspaceOwners(),
  ])

  const ownerByWorkspaceId = new Map(
    owners.map((owner) => [owner.workspaceId, owner]),
  )
  const results: WorkspaceMigrationResult[] = []
  const skipped: { workspaceId: string; reason: string }[] = []

  for (const workspace of workspaces) {
    const owner = ownerByWorkspaceId.get(workspace.id)
    if (!owner) {
      skipped.push({
        workspaceId: workspace.id,
        reason: "no owner membership found",
      })
      continue
    }

    const mappedUserId = getOrCreateId("user", owner.userId)
    const [existingUser] = await db
      .select({ id: userModel.id })
      .from(userModel)
      .where(
        and(
          eq(userModel.email, owner.email),
          eq(userModel.tenantId, ROOT_TENANT_ID),
        ),
      )
      .limit(1)
    const newUserId = existingUser?.id ?? mappedUserId
    if (existingUser) {
      setId("user", owner.userId, newUserId)
    }
    const newWorkspaceId = getOrCreateId("workspace", workspace.id)

    // A user migrated as owner of an earlier workspace already has a User row —
    // upsert-by-id so re-running this step (e.g. after a partial failure) is safe.
    await db
      .insert(userModel)
      .values({
        id: newUserId,
        name: owner.name,
        email: owner.email,
        emailVerified: true, // they were already a real logged-in customer on the old system
      })
      .onConflictDoNothing({ target: userModel.id })

    await db
      .insert(workspaceModel)
      .values({
        id: newWorkspaceId,
        name: workspace.name,
        language: "ar",
        isActive: workspace.status === "active",
        ownerId: newUserId,
      })
      .onConflictDoNothing({ target: workspaceModel.id })

    const membershipMapKey = `${workspace.id}:${owner.userId}`
    const mappedWorkspaceMemberId = getOrCreateId(
      "workspaceMember",
      membershipMapKey,
    )
    const [existingWorkspaceMember] = await db
      .select({ id: workspaceMemberModel.id })
      .from(workspaceMemberModel)
      .where(
        and(
          eq(workspaceMemberModel.workspaceId, newWorkspaceId),
          eq(workspaceMemberModel.userId, newUserId),
          eq(workspaceMemberModel.role, workspaceMemberRoles.enum.owner),
        ),
      )
      .limit(1)
    const workspaceMemberId =
      existingWorkspaceMember?.id ?? mappedWorkspaceMemberId
    if (existingWorkspaceMember) {
      setId(
        "workspaceMember",
        membershipMapKey,
        workspaceMemberId,
      )
    }

    await db
      .insert(workspaceMemberModel)
      .values({
        id: workspaceMemberId,
        workspaceId: newWorkspaceId,
        userId: newUserId,
        role: workspaceMemberRoles.enum.owner,
        permissions: OWNER_PERMISSIONS,
        notificationTypes: OWNER_NOTIFICATION_TYPES,
        notificationChannels: OWNER_NOTIFICATION_CHANNELS,
      })
      .onConflictDoNothing({ target: workspaceMemberModel.id })

    results.push({
      oldWorkspaceId: workspace.id,
      newWorkspaceId,
      oldOwnerUserId: owner.userId,
      newOwnerUserId: newUserId,
    })
  }

  if (skipped.length > 0) {
    console.warn(
      `Step 1: skipped ${skipped.length} workspace(s) with no resolvable owner:`,
      skipped,
    )
  }
  console.log(
    `Step 1: migrated ${results.length}/${workspaces.length} workspace(s).`,
  )

  return results
}
