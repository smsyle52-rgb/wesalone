import { workspaceMemberService } from "@chatbotx.io/business"
import { ORPCError } from "@orpc/server"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"

// NOT requireWorkspacePermission (apps/builder/src/lib/auth/require-workspace-permission.ts):
// that helper is a Server Component page/layout guard — it calls next/navigation's
// notFound(), whose special error is only intercepted by Next's own render
// pipeline. Thrown from inside an oRPC .handler(), it isn't recognized by
// authorizedAPI's onError (which only maps ChatbotXException/ModelNotfoundException)
// and surfaces as a mis-mapped 500 instead of a clean 403. ORPCError is oRPC's
// native error type and is returned to the client as-is.
export async function requireEcommercePermission(props: {
  workspaceId: string
  userId: string
}): Promise<void> {
  const { workspaceId, userId } = props
  const member = await workspaceMemberService.findMembership({
    workspaceId,
    userId,
  })
  if (!(member && hasWorkspacePermission(member.permissions, "ecommerce"))) {
    throw new ORPCError("FORBIDDEN", {
      message: "This workspace member cannot access commerce features.",
    })
  }
}
