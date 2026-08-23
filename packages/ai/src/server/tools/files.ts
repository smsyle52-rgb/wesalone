import { db } from "@chatbotx.io/database/client"
import { type ToolSet, tool } from "ai"
import { z } from "zod"
import { logger } from "../../logger"
import { type FileSearchConfig, performFileSearch } from "../knowledge-base"

export async function getAIFileTools(
  workspaceId: string,
  selectedFileIds: string[],
  options: {
    fileSearchDescription: string
    fileSearchQueryDescription: string
    fileSearchNoResult?: string
    fileSearchFoundPrefix?: (count: number) => string
    similarityThreshold?: number
    maxResults?: number
  },
): Promise<ToolSet> {
  const {
    fileSearchDescription,
    fileSearchQueryDescription,
    fileSearchNoResult = "No relevant information found.",
    fileSearchFoundPrefix = (count: number) =>
      `Found ${count} matching results:`,
    // 0.7 belongs to text-embedding-ada-002, whose cosine scores sit high and
    // bunched: unrelated text still scores around 0.75 there, so a high cut was
    // the only way to filter anything out. Measured against the platform's
    // current model (text-embedding-3-small), the same Arabic question scores
    // 0.673 against a chunk that answers it verbatim, 0.405 against a related
    // one and 0.072 against an unrelated one — so 0.7 discards every document
    // ever indexed, and no knowledge base can return a single result.
    similarityThreshold = 0.35,
    maxResults = 5,
  } = options
  try {
    const tools: ToolSet = {}

    if (selectedFileIds.length === 0) {
      return tools
    }

    const allFiles = await db.query.aiFileModel.findMany({
      where: {
        workspaceId,
        id: { in: selectedFileIds },
      },
    })

    if (allFiles.length > 0) {
      tools.search_knowledge_base = tool({
        description: fileSearchDescription,
        inputSchema: z.object({
          query: z.string().describe(fileSearchQueryDescription),
        }),
        execute: async ({ query }) => {
          const config: FileSearchConfig = {
            workspaceId,
            selectedFileIds,
            similarityThreshold,
            maxResults,
          }
          const results = await performFileSearch({ query }, config)

          if (results.length === 0) {
            logger.info(
              { workspaceId, query },
              "[knowledge-base] tool: no results found",
            )
            return fileSearchNoResult
          }

          const formattedResults = results
            .map((item, index) => `${index + 1}. ${item.content}`)
            .join("\n\n")

          const toolOutput = `${fileSearchFoundPrefix(results.length)}\n\n${formattedResults}`

          logger.info(
            {
              workspaceId,
              query,
              resultCount: results.length,
              outputLength: toolOutput.length,
              output: toolOutput,
            },
            "[knowledge-base] tool: formatted output sent to AI",
          )

          return toolOutput
        },
      })
    }

    return tools
  } catch (error) {
    logger.error(
      {
        error,
        workspaceId,
      },
      "[ai-package] getAIFileTools failed",
    )
    return {}
  }
}
