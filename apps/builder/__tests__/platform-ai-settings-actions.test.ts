import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

const FEATURE_DIR = join(import.meta.dirname, "../src/features/platform-ai")
const SUPER_ADMIN_CLIENT_PATTERN = /superAdminActionClient/
const PLATFORM_ADMIN_CLIENT_PATTERN = /platformAdminActionClient/
const WORKSPACE_CLIENT_PATTERN = /workspaceActionClient/
const PROJECT_ID_FIELD_PATTERN = /projectId:/
const PROJECT_ID_ENV_PATTERN = /VERTEX_AI_PROJECT_ID:/
const DEFAULT_MODEL_CONSTANT_PATTERN = /DEFAULT_PLATFORM_AI_CHAT_MODEL/

function readSource(file: string): { source: string; code: string } {
  const source = readFileSync(join(FEATURE_DIR, file), "utf8")
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  return { source, code }
}

describe("platform-ai actions — trust boundary (only the real platform admin can change the model)", () => {
  test("update action is super-admin-only, never workspace-scoped or the reseller platformAdminActionClient", () => {
    const { code } = readSource("update-platform-ai-settings.action.ts")
    expect(code).toMatch(SUPER_ADMIN_CLIENT_PATTERN)
    expect(code).not.toMatch(WORKSPACE_CLIENT_PATTERN)
    expect(code).not.toMatch(PLATFORM_ADMIN_CLIENT_PATTERN)
  })

  test("validate action is also super-admin-only", () => {
    const { code } = readSource("validate-platform-ai-settings.action.ts")
    expect(code).toMatch(SUPER_ADMIN_CLIENT_PATTERN)
    expect(code).not.toMatch(WORKSPACE_CLIENT_PATTERN)
  })

  test("validate action never returns the project id or any credential — only presence booleans and already-public model ids", () => {
    const { code } = readSource("validate-platform-ai-settings.action.ts")
    expect(code).not.toMatch(PROJECT_ID_FIELD_PATTERN)
    expect(code).not.toMatch(PROJECT_ID_ENV_PATTERN)
    expect(code.toLowerCase()).not.toContain("credential")
    expect(code.toLowerCase()).not.toContain("secret")
  })

  test("neither action imports Meta/channel/OAuth code — this feature never touches those surfaces", () => {
    for (const file of [
      "update-platform-ai-settings.action.ts",
      "validate-platform-ai-settings.action.ts",
    ]) {
      const { code } = readSource(file)
      for (const term of [
        "whatsapp",
        "messenger",
        "instagram",
        "telegram",
        "google-auth",
        "oauth",
      ]) {
        expect(code.toLowerCase()).not.toContain(term)
      }
    }
  })
})

describe("platform-ai update schema — the client can only ever submit a model choice + on/off, never a provider", () => {
  test("has no `provider` field at all — Vertex is fixed, not client-selectable", async () => {
    const { updatePlatformAiSettingsSchema } = await import(
      "../src/features/platform-ai/schema"
    )
    expect(updatePlatformAiSettingsSchema.shape).not.toHaveProperty("provider")
    expect(updatePlatformAiSettingsSchema.shape).not.toHaveProperty("projectId")
    expect(updatePlatformAiSettingsSchema.shape).not.toHaveProperty("location")
    expect(updatePlatformAiSettingsSchema.shape).not.toHaveProperty(
      "embeddingModel",
    )
  })

  test("rejects a chatModel that is not in the Vertex allowlist", async () => {
    const { updatePlatformAiSettingsSchema } = await import(
      "../src/features/platform-ai/schema"
    )
    const result = updatePlatformAiSettingsSchema.safeParse({
      chatModel: "gpt-5.4-mini",
      fallbackModel: "",
      enabled: true,
    })
    expect(result.success).toBe(false)
  })

  test("accepts the default model gemini-3.1-flash-lite and an empty/omitted fallback", async () => {
    const { updatePlatformAiSettingsSchema } = await import(
      "../src/features/platform-ai/schema"
    )
    const result = updatePlatformAiSettingsSchema.safeParse({
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: "",
      enabled: false,
    })
    expect(result.success).toBe(true)
  })

  test("rejects a fallbackModel that is not in the Vertex allowlist", async () => {
    const { updatePlatformAiSettingsSchema } = await import(
      "../src/features/platform-ai/schema"
    )
    const result = updatePlatformAiSettingsSchema.safeParse({
      chatModel: "gemini-3.1-flash-lite",
      fallbackModel: "not-a-real-model",
      enabled: true,
    })
    expect(result.success).toBe(false)
  })
})

describe("default platform AI model", () => {
  test("the page resolves its safe fallback from DEFAULT_PLATFORM_AI_CHAT_MODEL, and gemini-3.1-flash-lite is a valid Vertex model", async () => {
    const { vertexModels } = await import("@chatbotx.io/ai/models")
    expect(vertexModels.safeParse("gemini-3.1-flash-lite").success).toBe(true)

    const pageSource = readFileSync(
      join(import.meta.dirname, "../src/app/admin/ai-settings/page.tsx"),
      "utf8",
    )
    expect(pageSource).toMatch(DEFAULT_MODEL_CONSTANT_PATTERN)
  })
})
