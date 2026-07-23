import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

const root = join(import.meta.dirname, "..")

function source(path: string) {
  return readFileSync(join(root, path), "utf8")
}

describe("platform AI guardrails", () => {
  test("customer agent forms do not expose provider/model selectors", () => {
    const createAgent = source("src/features/ai-agents/create-ai-agent.tsx")
    const updateAgent = source("src/features/ai-agents/update-ai-agent.tsx")

    for (const file of [createAgent, updateAgent]) {
      expect(file).toContain("platformAiSettings.agentModelManaged")
      expect(file).not.toMatch(/models\.\$\{index\}\.model/)
      expect(file).not.toContain("openaiCompatiblePresetConfigs")
      expect(file).not.toContain("getOpenaiCompatibleIntegrationLabel")
      expect(file).not.toContain("shouldUseCustomOpenaiCompatibleModelInput")
    }
  })

  test("platform AI settings stay super-admin scoped", () => {
    const updateAction = source(
      "src/features/platform-ai/update-platform-ai-settings.action.ts",
    )
    const validateAction = source(
      "src/features/platform-ai/validate-platform-ai-settings.action.ts",
    )

    expect(updateAction).toContain("superAdminActionClient")
    expect(validateAction).toContain("superAdminActionClient")
    expect(updateAction).not.toContain("workspaceActionClient")
    expect(validateAction).not.toContain("workspaceActionClient")
  })
})
