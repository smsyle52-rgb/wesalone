import { getIdFromParams } from "@chatbotx.io/utils"
import { Loader2Icon } from "lucide-react"
import { cookies } from "next/headers"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { FullBleed } from "@/components/full-bleed"
import { ChatLayout } from "@/features/chat/chat-layout"
import { getInboxInitialState } from "@/features/chat/queries/get-inbox-initial-state.query"
import { ChatStoreProvider } from "@/features/chat/store/chat-store-provider"
import {
  buildContactPermissionScope,
  type ContactPermissionScope,
} from "@/features/contacts/permissions"
import { requireContactsAccess } from "@/lib/auth/require-workspace-permission"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"

type InboxPageProps = {
  params: Promise<{ workspaceId: string }>
  searchParams?: Promise<{ conversationId?: string }>
}

export default async function InboxPage({
  params,
  searchParams,
}: InboxPageProps) {
  const workspaceId = getIdFromParams(await params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  await requireContactsAccess(workspaceId)

  const layout = (await cookies()).get("csm:layout:inbox")
  const savedLayout = layout ? JSON.parse(layout.value) : [25, 50, 25]
  const userAndWorkspace = await getCurrentUserAndTargetWorkspace(workspaceId)
  if (!userAndWorkspace) {
    return notFound()
  }
  const { user, targetWorkspaceMember } = userAndWorkspace
  const contactPermissionScope = buildContactPermissionScope({
    permissions: targetWorkspaceMember.permissions,
    userId: user.id,
  })
  if (!contactPermissionScope) {
    return notFound()
  }

  const conversationId = (await searchParams)?.conversationId
  // Stored JSON may miss keys; absent means off.
  const notificationTypes = (targetWorkspaceMember.notificationTypes ??
    {}) as Partial<Record<"newMessageToHuman", boolean>>
  const notificationChannels = (targetWorkspaceMember.notificationChannels ??
    {}) as Partial<Record<"browser", boolean>>
  const browserNotifications =
    notificationTypes.newMessageToHuman === true &&
    notificationChannels.browser === true

  return (
    <FullBleed>
      <Suspense
        fallback={
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Loader2Icon className="animate-spin" />
          </div>
        }
      >
        <InboxContent
          browserNotifications={browserNotifications}
          canViewEmailAndPhone={contactPermissionScope.canViewEmailAndPhone}
          contactPermissionScope={contactPermissionScope}
          conversationId={conversationId}
          layout={savedLayout}
          workspaceId={workspaceId}
        />
      </Suspense>
    </FullBleed>
  )
}

async function InboxContent({
  browserNotifications,
  canViewEmailAndPhone,
  contactPermissionScope,
  conversationId,
  layout,
  workspaceId,
}: {
  browserNotifications: boolean
  canViewEmailAndPhone: boolean
  contactPermissionScope: ContactPermissionScope
  conversationId?: string
  layout: [number, number, number]
  workspaceId: string
}) {
  const initialState = await getInboxInitialState({
    workspaceId,
    conversationId,
    contactPermissionScope,
  })

  return (
    <ChatStoreProvider initialState={initialState ?? undefined}>
      <ChatLayout
        browserNotifications={browserNotifications}
        canViewEmailAndPhone={canViewEmailAndPhone}
        layout={layout}
        workspaceId={workspaceId}
      />
    </ChatStoreProvider>
  )
}
