// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  findIntegrationWhatsapp,
  buildContext,
  runAction,
  syncTemplates,
  loggerWarn,
} = vi.hoisted(() => ({
  findIntegrationWhatsapp: vi.fn(),
  buildContext: vi.fn(),
  runAction: vi.fn(),
  syncTemplates: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock("@/lib/safe-action", () => {
  const chain: Record<string, unknown> = {}
  chain.bindArgsSchemas = () => chain
  chain.inputSchema = () => chain
  chain.action = (fn: unknown) => fn
  return { workspaceActionClient: chain }
})
vi.mock("@/features/integration-whatsapp/queries", () => ({
  findIntegrationWhatsapp,
}))
vi.mock("@chatbotx.io/business", () => ({ buildContext }))
vi.mock("@/integration", () => ({
  integrations: { whatsapp: { runAction } },
}))
vi.mock(
  "@/features/integration-whatsapp/message-templates/lib/sync-message-templates",
  () => ({ syncWhatsappMessageTemplatesForIntegration: syncTemplates }),
)
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

beforeEach(() => {
  findIntegrationWhatsapp.mockResolvedValue(integration)
  buildContext.mockResolvedValue({ auth: integration.auth })
  runAction.mockResolvedValue({
    id: "tpl-1",
    status: "PENDING",
    category: "MARKETING",
  })
  syncTemplates.mockResolvedValue(undefined)
})

describe("createWhatsappMessageTemplateAction", () => {
  test("scopes the integration by workspace and id, sends Meta's payload, then mirrors", async () => {
    const result = await action({
      bindArgsParsedInputs: ["ws-1", "int-2"],
      parsedInput,
    })

    expect(findIntegrationWhatsapp).toHaveBeenCalledWith({
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
    expect(syncTemplates).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      integrationWhatsapp: integration,
    })
    expect(result).toEqual({ id: "tpl-1", status: "PENDING" })
  })

  test("never calls Meta when the integration is not in this workspace", async () => {
    findIntegrationWhatsapp.mockRejectedValue(
      new Error("Whatsapp integration not found"),
    )

    await expect(
      action({ bindArgsParsedInputs: ["ws-1", "int-foreign"], parsedInput }),
    ).rejects.toThrow("Whatsapp integration not found")
    expect(runAction).not.toHaveBeenCalled()
    expect(syncTemplates).not.toHaveBeenCalled()
  })

  test("surfaces Meta's refusal and does not mirror", async () => {
    runAction.mockRejectedValue(new Error("Template name already exists"))

    await expect(
      action({ bindArgsParsedInputs: ["ws-1", "int-2"], parsedInput }),
    ).rejects.toThrow("Template name already exists")
    expect(syncTemplates).not.toHaveBeenCalled()
  })

  test("a failed mirror still reports the created template", async () => {
    syncTemplates.mockRejectedValue(new Error("list failed"))

    await expect(
      action({ bindArgsParsedInputs: ["ws-1", "int-2"], parsedInput }),
    ).resolves.toEqual({ id: "tpl-1", status: "PENDING" })
    expect(loggerWarn).toHaveBeenCalled()
  })

  test("returns Meta's REJECTED status so the dialog can say so", async () => {
    runAction.mockResolvedValue({
      id: "tpl-2",
      status: "REJECTED",
      category: "MARKETING",
    })

    await expect(
      action({ bindArgsParsedInputs: ["ws-1", "int-2"], parsedInput }),
    ).resolves.toEqual({ id: "tpl-2", status: "REJECTED" })
  })
})
