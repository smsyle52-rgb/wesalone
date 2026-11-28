"use client"

import type { WorkspaceMemberPermissions } from "@chatbotx.io/database/partials"
import { createContext, type ReactNode, useContext } from "react"
import { canAssignConversations } from "@/lib/auth/permission-routes"

/**
 * The signed-in member's permissions for the current workspace, set once by
 * the workspace layout so client components can hide controls the server
 * would refuse anyway. Null outside a workspace (the server still decides).
 */
const MemberPermissionsContext =
  createContext<WorkspaceMemberPermissions | null>(null)

export function MemberPermissionsProvider({
  permissions,
  children,
}: {
  permissions: WorkspaceMemberPermissions
  children: ReactNode
}) {
  return (
    <MemberPermissionsContext.Provider value={permissions}>
      {children}
    </MemberPermissionsContext.Provider>
  )
}

/** Whether the current member may assign/transfer conversations. */
export function useCanAssignConversations(): boolean {
  const permissions = useContext(MemberPermissionsContext)
  return permissions ? canAssignConversations(permissions) : true
}
