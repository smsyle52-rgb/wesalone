import { resolveTenantByDomain } from "@chatbotx.io/auth/tenant"
import {
  isPlatformAdmin,
  isSuperAdmin,
  quotaEnforcementService,
  userQuotaService,
} from "@chatbotx.io/business"
import { ROOT_TENANT_ID } from "@chatbotx.io/database/schema"
import type { Metadata } from "next"
import { ExpiredBanner } from "@/components/expired-banner"
import { WorkspaceDeletionPendingToast } from "@/components/workspace-deletion-pending-toast"
import { isCloud } from "@/env"
import { MarketingHome } from "@/features/marketing/marketing-home"
import { AccountRail } from "@/features/workspaces/components/account-rail"
import WorkspacesList from "@/features/workspaces/components/workspaces-list"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { enforcePasswordCurrent } from "@/lib/auth/require-password-current"
import { getCurrentUserAndAllLinkedWorkspaces } from "@/lib/auth/utils"
import { getDomainFromHeader } from "@/lib/domain"
import {
  buildQuotaMetrics,
  resolveBlockReason,
  resolveTrialEndsAt,
} from "@/lib/quota-metrics"

// Arabic stays the default for every visitor, but the page also exists in
// English behind `?lang=en`. Without these alternates a crawler has no way to
// discover it: Google reviewed wesal.one, got the Arabic page, and rejected a
// startup-credit application saying it could not identify the product.
export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: {
      ar: "/",
      en: "/?lang=en",
      "x-default": "/",
    },
  },
}

export default async function MainPage() {
  const userAndWorkspaces = await getCurrentUserAndAllLinkedWorkspaces()
  if (!userAndWorkspaces) {
    return <MarketingHome />
  }

  const { user, allWorkspaces, allWorkspaceMembers } = userAndWorkspaces

  // Reseller-provisioned accounts must set their own password before anything
  // else. Enforced in every protected layout/page, not just here.
  enforcePasswordCurrent(user)

  // Plan + usage limits only apply to the hosted cloud edition. Self-hosted
  // community/enterprise installs use every feature freely — no quota gating.
  const cloud = isCloud()
  const domain = await getDomainFromHeader()
  const [usageSummary, atLimit, quota, platformAdmin, tenantId] =
    await Promise.all([
      cloud ? quotaEnforcementService.getUsageSummary(user.id) : null,
      cloud ? quotaEnforcementService.getAtLimitMap(user.id) : null,
      cloud ? userQuotaService.getForUser(user.id) : null,
      isPlatformAdmin(user),
      resolveTenantByDomain(domain),
    ])
  // "Served with platform identity" — not the same claim as user.tenantId,
  // which the session never carries (see SessionUser in lib/auth/utils.ts).
  // Gates the Redeem link: /portal/redeem 404s on non-platform hosts.
  const isPlatformContext = tenantId === ROOT_TENANT_ID

  const ownerWorkspaceIds = allWorkspaceMembers
    .filter((member) => member.role === "owner")
    .map((member) => member.workspace.id)
  const superAdminWorkspaceIds = allWorkspaceMembers
    .filter((member) =>
      hasWorkspacePermission(member.permissions, "superAdmin"),
    )
    .map((member) => member.workspace.id)

  const trialEndsAt = resolveTrialEndsAt(quota)
  const blockReason = resolveBlockReason(
    quota?.planStatus ?? null,
    trialEndsAt,
    atLimit?.mac ?? false,
  )
  const blocked = blockReason !== null

  const userInfo = { name: user.name, email: user.email, image: user.image }

  return (
    <div className="mx-auto w-full max-w-6xl px-6">
      <WorkspaceDeletionPendingToast />
      <ExpiredBanner blocked={cloud && blocked} reason={blockReason} />
      <div className="flex flex-col gap-8 py-8 md:flex-row md:items-start">
        <AccountRail
          isPlatformAdmin={platformAdmin}
          isPlatformContext={isPlatformContext}
          isSuperAdmin={isSuperAdmin(user)}
          metrics={buildQuotaMetrics(usageSummary)}
          planName={quota?.planName ?? null}
          planStatus={quota?.planStatus ?? null}
          trialEndsAt={trialEndsAt}
          user={userInfo}
        />

        <WorkspacesList
          blocked={cloud && blocked}
          isAtLimit={atLimit?.workspaces ?? false}
          ownerWorkspaceIds={ownerWorkspaceIds}
          reason={blockReason}
          superAdminWorkspaceIds={superAdminWorkspaceIds}
          user={userInfo}
          workspaces={allWorkspaces}
        />
      </div>
    </div>
  )
}
