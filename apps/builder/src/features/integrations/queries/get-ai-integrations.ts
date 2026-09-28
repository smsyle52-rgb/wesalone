import { aiProviders } from "@chatbotx.io/ai"
import { getActivePlatformAiOverride } from "@chatbotx.io/ai/server"
import { integrationService } from "@chatbotx.io/business"

// The platform's single internal Vertex AI provider (see platform-ai
// settings) now covers every workspace, so this is true whenever either the
// platform override is active OR the workspace still has a legacy
// bring-your-own-key integration from before that switch.
export async function hasAIIntegration(workspaceId: string): Promise<boolean> {
  const platformOverride = await getActivePlatformAiOverride()
  if (platformOverride) {
    return true
  }

  return await integrationService.hasIntegrationOfTypes({
    workspaceId,
    integrationTypes: [...aiProviders.options],
  })
}
