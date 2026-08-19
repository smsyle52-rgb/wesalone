import { createHash } from "node:crypto"
import { aiTimeouts, type systemFunctionNames } from "@chatbotx.io/ai"
import type {
  ImageReaderInput,
  SystemToolExecutors,
} from "@chatbotx.io/ai/server"
import { usageMeteringService } from "@chatbotx.io/business"
import type { AttachmentModel } from "@chatbotx.io/database/types"
import { uploader } from "@chatbotx.io/filesystem"
import { generateText, type LanguageModel } from "ai"
import { normalizeError } from "universal-error-normalizer"
import { logger } from "../../../../lib/logger"
import { resolveImageAttachment } from "./context-sources/image-source"

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_READER_MAX_OUTPUT_TOKENS = 800

function isArabicLanguage(language?: string): boolean {
  return language?.toLowerCase().startsWith("ar") ?? false
}

function getImageReaderCopy(language?: string) {
  if (isArabicLanguage(language)) {
    return {
      defaultQuery: "صف هذه الصورة.",
      promptIntro: "حلّل الصورة المرفقة في سياق محادثة دعم عملاء.",
      visibleOnly:
        "أجب اعتمادًا على المحتوى الظاهر في الصورة فقط. إذا لم تكن التفاصيل المطلوبة ظاهرة، فاذكر أنها غير ظاهرة.",
      format: "أجب بلغة طبيعية موجزة. لا تُرجع JSON أو جداول Markdown.",
      language: "أجب بالعربية فقط ما لم يطلب المستخدم صراحةً لغة أخرى.",
      userQuestion: "سؤال المستخدم",
      selectionContext: "سياق اختيار الصورة",
      imageTitle: "عنوان الصورة",
      fileOnlyInstruction:
        "إذا لم يطرح المستخدم سؤالًا محددًا، فقدم ملخصًا قصيرًا واقترح التفاصيل التي يمكنه السؤال عنها لاحقًا.",
      outputImage: "الصورة",
      outputAnalysis: "التحليل",
      outputFollowUp:
        "متابعة: اسأل المستخدم عن التفصيل المحدد في الصورة الذي يريد معرفة المزيد عنه.",
      missingContext: "يمكنني قراءة الصور فقط عند توفر سياق المحادثة.",
      unsupportedImage: "لم أجد صورة مدعومة في هذه المحادثة بعد.",
      emptyAnalysis:
        "وجدت الصورة، لكنني لم أتمكن من استخراج تحليل مرئي مفيد منها.",
      failedAnalysis:
        "وجدت صورتك، لكنني لم أتمكن من تحليلها بالكامل. يرجى طلب تفصيل أكثر تحديدًا أو تجربة صورة أخرى.",
    }
  }

  return {
    defaultQuery: "Describe this image.",
    promptIntro:
      "Analyze the uploaded image for a customer support conversation.",
    visibleOnly:
      "Answer only from visible image content. If a requested detail is not visible, say that it is not visible.",
    format:
      "Return concise natural language. Do not return JSON or markdown tables.",
    language: "Reply in the user's requested language when one is explicit.",
    userQuestion: "User question",
    selectionContext: "Image selection context",
    imageTitle: "Image title",
    fileOnlyInstruction:
      "If the user did not ask a specific question, provide a short summary and suggest what detail they can ask about next.",
    outputImage: "Image",
    outputAnalysis: "Analysis",
    outputFollowUp:
      "Follow-up: Ask the user what specific detail in the image they want to know more about.",
    missingContext:
      "I can only read images when conversation context is available.",
    unsupportedImage:
      "I couldn't find a supported image in this conversation yet.",
    emptyAnalysis:
      "I found the image, but I couldn't extract a useful visual answer from it.",
    failedAnalysis:
      "I found your image, but I couldn't analyze it completely. Please ask a more specific question or try another image.",
  }
}

function getReadableImageTitle(
  attachment: AttachmentModel,
  language?: string,
): string {
  return (
    attachment.name?.trim() ||
    (isArabicLanguage(language)
      ? "صورة مرفقة من المستخدم"
      : "User uploaded image")
  )
}

export function buildVisionPrompt(props: {
  attachment: AttachmentModel
  fileOnlyTrigger: boolean
  input: ImageReaderInput
  language?: string
}): string {
  const copy = getImageReaderCopy(props.language)
  const query = props.input.query.trim() || copy.defaultQuery
  const lines = [
    copy.promptIntro,
    copy.visibleOnly,
    copy.format,
    copy.language,
    `${copy.userQuestion}: ${query}`,
  ]

  if (props.input.imageContext?.trim()) {
    lines.push(`${copy.selectionContext}: ${props.input.imageContext.trim()}`)
  }

  lines.push(
    `${copy.imageTitle}: ${getReadableImageTitle(props.attachment, props.language)}`,
  )

  if (props.fileOnlyTrigger) {
    lines.push(copy.fileOnlyInstruction)
  }

  return lines.join("\n")
}

export function formatToolOutput(props: {
  analysis: string
  attachment: AttachmentModel
  fileOnlyTrigger: boolean
  language?: string
}) {
  const copy = getImageReaderCopy(props.language)
  const output: string[] = []
  output.push(
    `${copy.outputImage}: ${getReadableImageTitle(props.attachment, props.language)}`,
  )
  output.push(`${copy.outputAnalysis}: ${props.analysis}`)

  if (props.fileOnlyTrigger) {
    output.push(copy.outputFollowUp)
  }

  return output.join("\n")
}

async function loadImageBuffer(attachment: AttachmentModel): Promise<Buffer> {
  if (attachment.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large for image reader")
  }

  const buffer = await uploader.getObject(attachment.originPath)

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large for image reader")
  }

  return buffer
}

export function createImageReaderExecutor(options: {
  abortSignal?: AbortSignal
  fileOnlyTrigger: boolean
  language?: string
  model: LanguageModel
  modelId: string
  provider: string
  triggerMessageId?: string
}): NonNullable<SystemToolExecutors[typeof systemFunctionNames.imageReader]> {
  return async (args, context) => {
    const copy = getImageReaderCopy(options.language)
    if (!context) {
      return copy.missingContext
    }

    let reservation:
      | Awaited<ReturnType<typeof usageMeteringService.reserve>>
      | undefined
    try {
      const attachment = await resolveImageAttachment({
        workspaceId: context.workspaceId,
        conversationId: context.conversationId,
        messageId: options.triggerMessageId,
        query: args.query,
        sourceHint: args.imageContext,
      })

      if (!attachment) {
        return copy.unsupportedImage
      }

      const image = await loadImageBuffer(attachment)
      const prompt = buildVisionPrompt({
        attachment,
        fileOnlyTrigger: options.fileOnlyTrigger,
        input: args,
        language: options.language,
      })

      const queryHash = createHash("sha256")
        .update(`${args.query}:${args.imageContext ?? ""}`)
        .digest("hex")
        .slice(0, 16)
      reservation = await usageMeteringService.reserve({
        workspaceId: context.workspaceId,
        operationId: `image-reader:${context.conversationId}:${options.triggerMessageId ?? attachment.id}:${attachment.id}:${queryHash}`,
        category: "image_analysis",
        provider: options.provider,
        model: options.modelId,
        metadata: {
          conversationId: context.conversationId,
          attachmentId: attachment.id,
        },
      })

      const result = await generateText({
        model: options.model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              {
                type: "image",
                image,
                mediaType: attachment.mimeType,
              },
            ],
          },
        ],
        maxOutputTokens: IMAGE_READER_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        timeout: {
          totalMs: aiTimeouts.aiStep,
          stepMs: aiTimeouts.aiStep,
        },
        abortSignal: options.abortSignal,
      })

      const analysis = result.text.trim()
      await usageMeteringService.settleLanguage(reservation, {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens,
        reasoningTokens: result.usage.outputTokenDetails.reasoningTokens,
      })
      if (!analysis) {
        return copy.emptyAnalysis
      }

      return formatToolOutput({
        attachment,
        analysis,
        fileOnlyTrigger: options.fileOnlyTrigger,
        language: options.language,
      })
    } catch (error) {
      if (reservation) {
        await usageMeteringService.release(reservation, error)
      }
      const normalizedError = normalizeError(error)
      logger.error(
        {
          error: normalizedError,
          conversationId: context.conversationId,
          workspaceId: context.workspaceId,
          provider: options.provider,
          modelId: options.modelId,
        },
        "[image-reader] image tool execution failed",
      )

      return copy.failedAnalysis
    }
  }
}
