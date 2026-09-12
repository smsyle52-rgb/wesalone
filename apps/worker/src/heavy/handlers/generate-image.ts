import { aiProviders, aiTimeouts } from "@chatbotx.io/ai"
import {
  aiIntegrationService,
  createAIImageModelInstance,
  getActivePlatformAiCapability,
  getPlatformCapabilityImageModel,
} from "@chatbotx.io/ai/server"
import {
  resolveTenantSettings,
  type UsageReservation,
  usageMeteringService,
} from "@chatbotx.io/business"
import { getPublicFileUrl } from "@chatbotx.io/business/utils"
import {
  type AIGenerateImageSchema,
  getAIGeneratedImagePath,
  IMAGE_AUTO_VALUE,
  IMAGE_BASE64_ENCODING,
  IMAGE_DEFAULT_EXTENSION,
  IMAGE_DEFAULT_MIME_TYPE,
} from "@chatbotx.io/flow-config"
import { generateImage } from "ai"
import { env } from "../../env"
import type { HeavyStepComputeProps } from "../../integration/handlers/flow-utils"
import { getIntegrationContext } from "../../integration/utils/contact"
import { logger } from "../../lib/logger"
import { ExpectedHeavyStepError } from "./errors"
import { getOpenAIImageQuality } from "./image-options"

const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"])

export async function generateImageOutput({
  conversation,
  contactInbox,
  metadata,
  step,
}: HeavyStepComputeProps<AIGenerateImageSchema>): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), aiTimeouts.aiTotal)
  let reservation: UsageReservation | undefined

  try {
    const ctx = await getIntegrationContext({
      workspaceId: conversation.workspaceId,
      contactId: conversation.contactId,
      contactInbox,
    })

    if (!ctx) {
      logger.warn(
        {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
        },
        "[ai-generate-image] Integration context not found, skipping",
      )
      throw new ExpectedHeavyStepError("Integration context not found")
    }

    let buffer: Buffer | null = null

    // Wesal One: the platform image model comes first — merchants have no key
    // of their own, so a workspace integration is only the fallback.
    const [platformCapability, platformModel] = await Promise.all([
      getActivePlatformAiCapability("imageGeneration"),
      getPlatformCapabilityImageModel("imageGeneration"),
    ])
    const modelId = platformCapability?.model ?? step.model
    let model = platformModel

    if (!model) {
      const aiConfig = await aiIntegrationService.findBy({
        workspaceId: conversation.workspaceId,
        provider: step.provider,
      })
      if (!aiConfig) {
        throw new ExpectedHeavyStepError("AI integration not found")
      }
      model = createAIImageModelInstance({
        model: aiConfig,
        provider: step.provider,
        modelId,
      })
    }

    const size =
      !platformModel &&
      step.provider === aiProviders.enum.openai &&
      step.size !== IMAGE_AUTO_VALUE
        ? (step.size as `${number}x${number}`)
        : undefined

    const aspectRatio =
      (platformModel || step.provider === aiProviders.enum.gemini) &&
      step.size !== IMAGE_AUTO_VALUE
        ? (step.size as `${number}:${number}`)
        : undefined

    const providerOptions =
      !platformModel &&
      step.provider === aiProviders.enum.openai &&
      step.quality !== "auto"
        ? {
            openai: {
              quality: getOpenAIImageQuality(modelId, step.quality),
            },
          }
        : undefined

    // A deterministic execution id so BullMQ retries overwrite the same storage
    // object instead of orphaning the previously uploaded file.
    const executionId = metadata?.stepId ?? step.id
    reservation = await usageMeteringService.reserve({
      workspaceId: conversation.workspaceId,
      operationId: `flow:generate-image:${conversation.id}:${executionId}`,
      category: "image_generation",
      provider: platformModel ? "platform" : step.provider,
      model: modelId,
      metadata: { conversationId: conversation.id, stepId: step.id },
    })

    const { image } = await generateImage({
      model,
      prompt: step.prompt,
      size,
      aspectRatio,
      providerOptions,
      abortSignal: controller.signal,
    })

    await usageMeteringService.settleUnits(reservation, "image_generation", 1, {
      images: 1,
      quality: step.quality,
      size: step.size,
    })
    // Settled: a later storage failure must not release a charge that ran.
    reservation = undefined

    if (image.uint8Array && image.uint8Array.byteLength > 0) {
      buffer = Buffer.from(image.uint8Array)
    } else if (image.base64) {
      buffer = Buffer.from(image.base64, IMAGE_BASE64_ENCODING)
    }

    const contentType = image.mediaType || IMAGE_DEFAULT_MIME_TYPE

    if (!buffer || buffer.length === 0) {
      throw new Error("[ai-generate-image] Empty image payload from provider")
    }

    if (buffer.length > env.HEAVY_MAX_IMAGE_BYTES) {
      throw new ExpectedHeavyStepError(
        `[ai-generate-image] Image too large: ${buffer.length} bytes`,
      )
    }

    const rawExt = contentType.split("/")[1]?.split(";")[0]?.trim() ?? ""
    const extension = ALLOWED_EXTENSIONS.has(rawExt)
      ? rawExt
      : IMAGE_DEFAULT_EXTENSION

    const fileName = `${executionId}.${extension}`
    const storagePath = getAIGeneratedImagePath({
      storagePrefix: ctx.storagePrefix,
      fileName,
      conversationId: conversation.id,
    })

    await ctx.uploader.putObject(storagePath, buffer, {
      ContentType: contentType,
    })

    const { storageUrl } = await resolveTenantSettings({
      workspaceId: conversation.workspaceId,
    })

    return getPublicFileUrl(storagePath, storageUrl)
  } catch (err) {
    if (reservation) {
      await usageMeteringService.release(reservation, err)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
