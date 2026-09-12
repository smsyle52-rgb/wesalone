import { db, eq } from "@chatbotx.io/database/client"
import type { AIEmbeddingStatus } from "@chatbotx.io/database/partials"
import { aiFileModel } from "@chatbotx.io/database/schema"
import type { AIFileModel } from "@chatbotx.io/database/types"
import { uploader } from "@chatbotx.io/filesystem"
import { createId } from "@chatbotx.io/utils"
import {
  getHeavyJobOptions,
  HeavyJobAction,
  heavyQueue,
} from "@chatbotx.io/worker-config"
import { normalizeError } from "universal-error-normalizer"
import { BaseService } from "../base.service"
import { ChatbotXException } from "../errors"
import { logger } from "../logger"
import { platformAiSettingService } from "../platform-ai-setting/service"
import { userQuotaService } from "../user-quota"

export type AIFileWithEmbeddingStatus = AIFileModel & {
  url: string
  chunksCount: number
  processingStatus: AIEmbeddingStatus
}

class AiFileService extends BaseService {
  async hasEmbeddingProvider(workspaceId: string): Promise<boolean> {
    // Wesal One: the platform's Vertex provider embeds for every workspace, and
    // merchants have no key of their own — without this every knowledge upload
    // failed with "no embedding provider".
    const platformProvider = await platformAiSettingService.getActive()
    if (platformProvider?.embeddingModel) {
      return true
    }

    const hasOpenAI = await db.query.integrationOpenaiModel.findFirst({
      where: { workspaceId },
      columns: { id: true },
    })
    if (hasOpenAI) {
      return true
    }

    const hasGemini = await db.query.integrationGeminiModel.findFirst({
      where: { workspaceId },
      columns: { id: true },
    })
    return Boolean(hasGemini)
  }

  async create(props: {
    workspaceId: string
    path: string
    name: string
    mimeType: string
    size: number
  }): Promise<{ id: string }> {
    if (!(await this.hasEmbeddingProvider(props.workspaceId))) {
      throw new ChatbotXException(
        "AI file requires an embedding provider",
        "noEmbeddingProvider",
        400,
      )
    }

    // Wesal One: the plan caps knowledge documents.
    await userQuotaService.assertPlanResourceCapacity(
      props.workspaceId,
      "knowledgeDocuments",
    )

    const created = await db
      .insert(aiFileModel)
      .values({
        name: props.name,
        path: props.path,
        mimeType: props.mimeType,
        size: props.size,
        id: createId(),
        workspaceId: props.workspaceId,
      })
      .returning({ id: aiFileModel.id })

    const aiFileId = created[0].id

    // Enqueue embedding job right after creation
    await heavyQueue.add(
      HeavyJobAction.processAIFile,
      {
        type: HeavyJobAction.processAIFile,
        data: {
          aiFileId,
        },
      },
      {
        ...getHeavyJobOptions(HeavyJobAction.processAIFile),
        jobId: `heavy-ai-file-${aiFileId}`,
      },
    )

    await this.audit("create", `created a new Knowledge (#${aiFileId})`)

    return { id: aiFileId }
  }

  async delete(props: { workspaceId: string; id: string }): Promise<void> {
    const targetAIFile = await db.query.aiFileModel.findFirst({
      where: { id: props.id, workspaceId: props.workspaceId },
    })

    if (!targetAIFile) {
      throw new ChatbotXException(
        `AIFile with id ${props.id} not found`,
        "notFound",
        404,
      )
    }

    // Wesal One: the database is authoritative — its FK cascade removes the
    // embeddings. Deleting the storage object first (upstream) and swallowing
    // the error left a row that reappeared in the UI and could never be deleted
    // when storage was down: the "resurrection" bug fixed here in July. Storage
    // cleanup is best-effort AFTER the row is gone, and the audit entry is
    // recorded before it so a storage outage cannot skip it.
    await db.delete(aiFileModel).where(eq(aiFileModel.id, props.id))

    await this.audit("delete", `deleted a Knowledge (#${props.id})`)

    try {
      await uploader.deleteObject(targetAIFile.path)
    } catch (error) {
      logger.warn(
        { err: normalizeError(error) },
        `AI file storage cleanup failed for id: ${props.id}`,
      )
    }
  }

  async listWithEmbeddingStatus(props: {
    workspaceId: string
  }): Promise<AIFileWithEmbeddingStatus[]> {
    const data = await db.query.aiFileModel.findMany({
      where: {
        workspaceId: props.workspaceId,
      },
      with: {
        aiEmbeddings: {
          columns: {
            id: true,
            status: true,
          },
        },
      },
    })

    return await Promise.all(
      data.map(async (file) => {
        const hasEmbeddings = file.aiEmbeddings.length > 0
        let processingStatus: AIEmbeddingStatus = "pending"
        if (hasEmbeddings) {
          const statusSet = new Set(file.aiEmbeddings.map((e) => e.status))
          if (statusSet.has("error")) {
            processingStatus = "error"
          } else if (statusSet.has("pending")) {
            processingStatus = "processing"
          } else {
            processingStatus = "success"
          }
        }

        return {
          id: file.id,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          workspaceId: file.workspaceId,
          mimeType: file.mimeType,
          size: file.size,
          name: file.name,
          path: file.path,
          url: await uploader.getPresignedDownload(file.path),
          chunksCount: file.aiEmbeddings.length,
          processingStatus,
        }
      }),
    )
  }
}

export const aiFileService = new AiFileService()
