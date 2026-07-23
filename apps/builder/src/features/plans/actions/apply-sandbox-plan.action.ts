"use server"

import {
  findWesalOnePlan,
  userQuotaService,
  workspaceService,
} from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { applySandboxPlanRequest } from "../schema/action"

// Sandbox/test-only: applies a Wesal One plan's native-mappable quota limits
// to the WORKSPACE OWNER's UserQuota row (never the acting member's own row —
// billing belongs to the space, not whoever happens to click the button).
// Disabled outright in production — real activation goes through the
// reviewed subscription-payment flow (features/plans/actions/*-subscription-payment.action.ts).
// No payment, no Stripe, no order/commerce code touched — see
// userQuotaService.applySandboxPlan for why this is deliberately minimal.
export const applySandboxPlanAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .inputSchema(applySandboxPlanRequest)
  .action(async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) => {
    if (process.env.NODE_ENV === "production") {
      throw new ChatbotXException(
        "The sandbox plan switcher is disabled in production.",
      )
    }

    const currentUserAndWorkspace =
      await getCurrentUserAndTargetWorkspace(workspaceId)
    if (!currentUserAndWorkspace) {
      throw new ChatbotXException(
        "You are not authorized to change this workspace's plan.",
      )
    }

    const permissions =
      currentUserAndWorkspace.targetWorkspaceMember.permissions
    if (!hasWorkspacePermission(permissions, "superAdmin")) {
      throw new ChatbotXException(
        "You are not authorized to change this workspace's plan. You need to be a super admin to do this.",
      )
    }

    const plan = findWesalOnePlan(parsedInput.planSlug)
    if (!plan) {
      throw new ChatbotXException("Unknown plan")
    }

    const workspace = await workspaceService.findById({ id: workspaceId })

    await userQuotaService.applySandboxPlan({
      userId: workspace.ownerId,
      plan,
    })

    return { planSlug: plan.slug }
  })
