// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  findByIdForWorkspace,
  buildContext,
  runAction,
  syncFromMeta,
  loggerWarn,
} = vi.hoisted(() => ({
  findByIdForWorkspace: vi.fn(),
  buildContext: vi.fn(),
  runAction: vi.fn(),
  syncFromMeta: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock("@/lib/safe-action", () => {
  const chain: Record<string, unknown> = {}
  chain.bindArgsSchemas = () => chain
  chain.inputSchema = () => chain
  chain.action = (fn: unknown) => fn
  return { workspaceActionClient: chain }
})
vi.mock("@chatbotx.io/business", () => ({
  buildContext,
  integrationWhatsappService: { findByIdForWorkspace },
  whatsappMessageTemplateService: { syncFromMeta },
}))
vi.mock("@/integration", () => ({
  integrations: { whatsapp: { runAction } },
}))
vi.mock("@/lib/log", () => ({ logger: { warn: loggerWarn } }))

const { createWhatsappMessageTemplateAction } = await import(
  "@/features/integration-whatsapp/message-templates/actions/create-message-template"
)
const action = createWhatsappMessageTemplateAction as unknown as (props: {
  bindArgsParsedInputs: [string, string]
  parsedInput: Record<string, unknown>
}) => Promise<{ id: string; status: string }>

const integration = {
  id: "int-2",
  workspaceId: "ws-1",
  auth: { tokens: { accessToken: "secret" } },
}

const parsedInput = {
  name: "offer_sep",
  language: "ar",
  category: "MARKETING",
  headerType: "none",
  headerText: "",
  headerVariables: [],
  body: "السلام عليكم يا {{1}}، وصلت عروض",
  bodyVariables: [{ key: "{{1}}", example: "أحمد" }],
  footer: "",
  buttons: [{ type: "QUICK_REPLY", title: "مهتم" }],
}

const metaTemplates = [{ id: "tpl-1", name: "offer_sep" }]

const mockMeta = ({
  created = { id: "tpl-1", status: "PENDING", category: "MARKETING" },
  createError,
  listError,
}: {
  created?: Record<string, unknown>
  createError?: Error
  listError?: Error
} = {}) => {
  runAction.mockImplementation((name: string) => {
    if (name === "createMessageTemplate") {
      return createError ? Promise.reject(createError) : Promise.resolve(created)
    }
    return listError
      ? Promise.reject(listError)
      : Promise.resolve({ data: metaTemplates })
  })
}

beforeEach(() => {
  findByIdForWorkspace.mockResolvedValue(integration)
  buildContext.mockResolvedValue({ auth: integration.auth })
  syncFromMeta.mockResolvedValue(undefined)
  mockMeta()
})

describe("createWhatsappMessageTemplateAction", () => {
  test("scopes the integration by workspace and id, sends Meta's payload, then mirrors", async () => {
    const result = await action({
      bindArgsParsedInputs: ["ws-1", "int-2"],
      parsedInput,
    })

    expect(findByIdForWorkspace).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      id: "int-2",
    })
    expect(runAction).toHaveBeenCalledWith("createMessageTemplate", {
      ctx: { auth: integration.auth },
      data: {
        name: "offer_sep",
        language: "ar",
        category: "MARKETING",
        components: [
          {
            type: "BODY",
            text: parsedInput.body,
            example: { body_text: [["أحمد"]] },
          },
          { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "مهتم" }] },
        ],
      },
    })
    expect(syncFromMeta).toHaveBeenCalledWith({
      integrationWhatsappId: "int-2",
      templates: metaTemplates,
    })
    expect(result).toEqual({ id: "tpl-1", status: "PENDING" })
  })

  test("never calls Meta when the integration is not in this workspace", async () => {
    findByIdForWorkspace.mockResolvedValue(null)

    await expect(
      action({ bindArgsParsedInputs: ["ws-1", "int-foreign"], parsedInput }),
    ).rejects.toThrow("Whatsapp integration not found")
    expect(runAction).not.toHaveBeenCalled()
    expect(syncFromMeta).not.toHaveBeenCalled()
  })

  test("surfaces Meta's refusal and does not mirror", async () => {
    mockMeta({ createError: new Error("Template name already exists") })

    await expect(
      action({ bindArgsParsedInputs: ["ws-1", "int-2"], parsedInput }),
    ).rejects.toThrow("Template name already exists")
    expect(syncFromMeta).not.toHaveBeenCalled()
  })

  test("a failed mirror still reports the created template", async () => {
    mockMeta({ listError: new Error("list failed") })

    await expect(
      action({ bindArgsParsedInputs: ["ws-1", "int-2"], parsedInput }),
    ).resolves.toEqual({ id: "tpl-1", status: "PENDING" })
    expect(loggerWarn).toHaveBeenCalled()
  })

  test("returns Meta's REJECTED status so the dialog can say so", async () => {
    mockMeta({
      created: { id: "tpl-2", status: "REJECTED", category: "MARKETING" },
    })

    await expect(
      action({ bindArgsParsedInputs: ["ws-1", "int-2"], parsedInput }),
    ).resolves.toEqual({ id: "tpl-2", status: "REJECTED" })
  })
})
