import { createHmac } from "node:crypto"
import { isWaBridgeWorkspace } from "@chatbotx.io/sdk"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chatbotx.io/ui/components/ui/card"
import { QrCodeIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

/**
 * Wesal: link to the WhatsApp Web bridge's QR page for this workspace. The
 * path token is HMAC(WA_BRIDGE_ADMIN_TOKEN, workspaceId), so a workspace's
 * link opens only its own session. Renders nothing outside bridge workspaces
 * or when the bridge is not configured.
 */
export async function WaBridgeCard({ workspaceId }: { workspaceId: string }) {
  const secret = process.env.WA_BRIDGE_ADMIN_TOKEN
  if (!(secret && isWaBridgeWorkspace(workspaceId))) {
    return null
  }
  const token = createHmac("sha256", secret).update(workspaceId).digest("hex")
  const href = `/wa-bridge/admin/${token}/${workspaceId}/`
  const t = await getTranslations("waBridge")

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-2">
        <Button asChild>
          <a href={href} rel="noopener noreferrer" target="_blank">
            <QrCodeIcon aria-hidden />
            {t("open")}
          </a>
        </Button>
        <p className="text-muted-foreground text-xs">{t("hint")}</p>
      </CardContent>
    </Card>
  )
}
