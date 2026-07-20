import { aiProviders } from "@chatbotx.io/ai"
import { getActivePlatformAiOverride } from "@chatbotx.io/ai/server"
import { db } from "@chatbotx.io/database/client"

type ListAIIntegrationsProps = {
  where: {
    workspaceId: string
  }
}

export async function listAIIntegrations(props: ListAIIntegrationsProps) {
  return await db.query.integrationModel.findMany({
    where: {
      integrationType: {
        in: [...aiProviders.options],
      },
      workspaceId: props.where.workspaceId,
    },
  })
}

// The platform's single internal Vertex AI provider (see platform-ai
// settings) now covers every workspace, so this is true whenever either the
// platform override is active OR the workspace still has a legacy
// bring-your-own-key integration from before that switch.
export async function hasAIIntegration(workspaceId: string): Promise<boolean> {
  const platformOverride = await getActivePlatformAiOverride()
  if (platformOverride) {
    return true
  }

  const exists = await db.query.integrationModel.findFirst({
    where: {
      integrationType: {
        in: [...aiProviders.options],
      },
      workspaceId,
    },
  })

  return !!exists
}
