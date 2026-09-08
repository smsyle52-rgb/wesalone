import { systemFieldTypes } from "@chatbotx.io/database/partials"
import type {
  ContactInboxModel,
  ContactModel,
  WorkspaceModel,
} from "@chatbotx.io/database/types"
import { formatBotFieldReference } from "@chatbotx.io/flow-config"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { BotFieldValue, ContactCustomFieldValue } from "../src/schema"
import { extractVariables } from "../src/utils"

const {
  mockBotFieldFindMany,
  mockContactCustomFieldFindMany,
  mockContactFindFirst,
  mockCustomFieldFindMany,
  mockContactInboxFindFirst,
  mockFindLatestLastIncomingMessageAt,
  mockListIncomingTextsByContactInbox,
  mockResolveCouponVariable,
  mockWorkspaceFind,
} = vi.hoisted(() => ({
  mockBotFieldFindMany: vi.fn().mockResolvedValue([]),
  mockContactCustomFieldFindMany: vi.fn(),
  mockContactFindFirst: vi.fn(),
  mockCustomFieldFindMany: vi.fn().mockResolvedValue([]),
  mockContactInboxFindFirst: vi.fn(),
  mockWorkspaceFind: vi.fn(),
  mockFindLatestLastIncomingMessageAt: vi.fn(),
  mockListIncomingTextsByContactInbox: vi.fn().mockResolvedValue([]),
  mockResolveCouponVariable: vi.fn(),
}))

vi.mock("@chatbotx.io/business", () => ({
  botFieldWorkspaceCacheTags: (workspaceId: string) => [
    "bot-fields",
    `bot-fields:${workspaceId}`,
  ],
  appointmentService: { findBy: vi.fn() },
  contactInboxService: {
    findLatestLastIncomingMessageAtByContactId:
      mockFindLatestLastIncomingMessageAt,
  },
  messageService: {
    listIncomingTextsByContactInbox: mockListIncomingTextsByContactInbox,
  },
  resolveTenantSettings: vi.fn(),
  workspaceService: {
    find: mockWorkspaceFind,
  },
}))

vi.mock("@chatbotx.io/business/utils", () => ({
  getPublicFileUrl: (path: string, baseUrl: string) =>
    new URL(path, baseUrl).toString(),
}))

vi.mock("@chatbotx.io/business/coupon", () => ({
  couponService: {
    resolveCouponVariable: mockResolveCouponVariable,
  },
}))

// Pass-through cache (partial mock: the business import chain also pulls
// other redis exports, e.g. bloomFilter): each test's mocked bot-field rows
// must flow fresh through withCache.
vi.mock("@chatbotx.io/redis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@chatbotx.io/redis")>()),
  withCache: async (_key: string, fn: () => Promise<unknown>) => fn(),
}))

vi.mock("@chatbotx.io/database/client", () => ({
  db: {
    query: {
      contactModel: {
        findFirst: mockContactFindFirst,
      },
      contactInboxModel: {
        findFirst: mockContactInboxFindFirst,
      },
      contactCustomFieldModel: {
        findMany: mockContactCustomFieldFindMany,
      },
      customFieldModel: {
        findMany: mockCustomFieldFindMany,
      },
      botFieldModel: {
        findMany: mockBotFieldFindMany,
      },
    },
  },
}))

const { contactVariableService } = await import("../src/contact-variable")

beforeEach(() => {
  vi.clearAllMocks()
})

const contact = {
  id: "contact-1",
  workspaceId: "workspace-1",
  firstName: "Ada",
  locale: null,
  timezone: "UTC",
} as ContactModel

const contactInbox = {
  id: "contact-inbox-1",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
} as ContactInboxModel

const workspace = {
  id: "workspace-1",
  timezone: "UTC",
} as WorkspaceModel

const createCustomFieldsMap = (
  fields: Array<Partial<ContactCustomFieldValue> & { key: string }>,
) =>
  new Map(
    fields.map((field) => [
      field.key,
      {
        description: "",
        type: "text",
        value: "",
        ...field,
      } as ContactCustomFieldValue,
    ]),
  )

const createBotFieldsMap = (
  fields: Array<{ id: string; type?: string; value: string | null }>,
) =>
  new Map(
    fields.map((field) => [
      field.id,
      {
        type: field.type ?? "text",
        value: field.value,
      } as unknown as BotFieldValue,
    ]),
  )

const createVariables = (
  fields: Array<Partial<ContactCustomFieldValue> & { key: string }> = [],
  botFields: Array<{ id: string; type?: string; value: string | null }> = [],
  // Names the workspace defines. Defaults to exactly the fields this contact
  // filled, so a name absent from both stays an unknown token as before.
  definedFieldNames: string[] = fields.map((field) => field.key),
) => ({
  contact,
  contactInbox,
  customFieldsMap: createCustomFieldsMap(fields),
  botFieldsMap: createBotFieldsMap(botFields),
  workspaceCustomFieldNames: new Set(definedFieldNames),
  workspace,
})

describe("contactVariableService.replaceAll", () => {
  test("renders null system fields as empty strings", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "Locale: {{locale}}.",
        variables: createVariables(),
      }),
    ).resolves.toBe("Locale: .")
  })

  test("substitutes system fields with values", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "First name: {{first_name}}.",
        variables: createVariables(),
      }),
    ).resolves.toBe("First name: Ada.")
  })

  test("renders missing custom field values as empty strings", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "Plan: {{plan}}.",
        variables: createVariables([
          {
            key: "plan",
            value: undefined as unknown as string,
          },
        ]),
      }),
    ).resolves.toBe("Plan: .")
  })

  test("keeps unknown placeholders literal", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "{{not_a_field}} {{locale2}} {{status}}",
        variables: createVariables([
          {
            key: "status",
            value: "active",
          },
        ]),
      }),
    ).resolves.toBe("{{not_a_field}}  active")
  })

  test("resolves a bare custom field name containing spaces and diacritics", async () => {
    // Regression: the bare-name branch of VARIABLE_PLACEHOLDER_REGEX was
    // `[\w.]+` (ASCII word chars only), so a field named with a space or a
    // diacritic never matched and shipped as a literal `{{...}}`.
    await expect(
      contactVariableService.replaceAll({
        text: "Xin chào {{fullname upper}}!",
        variables: createVariables([
          {
            key: "fullname upper",
            value: "MÁ CHÁN",
          },
        ]),
      }),
    ).resolves.toBe("Xin chào MÁ CHÁN!")
  })

  test("still routes coupon: and raw: prefixes correctly after widening the bare-name branch", async () => {
    mockResolveCouponVariable.mockResolvedValue("CODE1")

    await expect(
      contactVariableService.replaceAll({
        text: "{{coupon:topic-1}} {{raw:Full Name}}",
        variables: createVariables([
          { key: "Full Name", value: "Ada Lovelace" },
        ]),
      }),
    ).resolves.toBe("CODE1 Ada Lovelace")
  })

  test("still leaves an unknown bare key literal after widening the bare-name branch", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "{{totally unknown}}",
        variables: createVariables(),
      }),
    ).resolves.toBe("{{totally unknown}}")
  })

  test("supports dotted system variables and keeps unknown dotted placeholders literal", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "{{ai.queued.messages}} {{foo.bar}}",
        variables: createVariables(),
      }),
    ).resolves.toBe(" {{foo.bar}}")
  })

  test("substitutes coupon topic variables with issued coupon code", async () => {
    mockResolveCouponVariable.mockResolvedValue("HHFgpe")

    await expect(
      contactVariableService.replaceAll({
        text: "Mã giảm giá của bạn là {{coupon:11619011544072192}}",
        variables: createVariables(),
      }),
    ).resolves.toBe("Mã giảm giá của bạn là HHFgpe")

    expect(mockResolveCouponVariable).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      contactId: "contact-1",
      topicId: "11619011544072192",
    })
  })

  test("extracts and resolves raw custom field variables verbatim", async () => {
    expect(extractVariables("{{raw:Full Name}} {{raw:Ngày sinh}}")).toEqual([
      "raw:Full Name",
      "raw:Ngày sinh",
    ])

    await expect(
      contactVariableService.replaceAll({
        text: "{{raw:Full Name}} {{raw:Ngày sinh}}",
        variables: createVariables([
          {
            key: "Full Name",
            value: "Ada Lovelace",
          },
          {
            key: "Ngày sinh",
            type: "date",
            value: "2026-07-23T00:00:00.000Z",
          },
        ]),
      }),
    ).resolves.toBe("Ada Lovelace 2026-07-23T00:00:00.000Z")
  })

  test("keeps unknown raw variables literal and preserves a real raw-prefixed field name", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "{{raw:Missing}} {{raw:X}}",
        variables: createVariables([
          {
            key: "raw:X",
            value: "field named raw colon x",
          },
        ]),
      }),
    ).resolves.toBe("{{raw:Missing}} field named raw colon x")
  })

  test("does not render custom field null values as string null", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "Broken: {{broken}}.",
        variables: createVariables([
          {
            key: "broken",
            value: null as unknown as string,
          },
        ]),
      }),
    ).resolves.toBe("Broken: .")
  })

  test("sanity-checks referenced system field names", () => {
    expect(systemFieldTypes.options).toContain("locale")
    expect(systemFieldTypes.options).toContain("first_name")
  })
})

describe("contactVariableService.replaceAll bot fields", () => {
  test("resolves a bot_field:<id> token to the workspace field's stored value", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: `Support hours: {{${formatBotFieldReference("1")}}}`,
        variables: createVariables([], [{ id: "1", value: "9am - 5pm" }]),
      }),
    ).resolves.toBe("Support hours: 9am - 5pm")
  })

  test("renders a bot field with no stored value as an empty string", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: `Hours: {{${formatBotFieldReference("1")}}}.`,
        variables: createVariables([], [{ id: "1", value: null }]),
      }),
    ).resolves.toBe("Hours: .")
  })

  test("keeps a bot_field token for a deleted/unknown id literal, matching unknown-variable behavior", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: `{{${formatBotFieldReference("999")}}}`,
        variables: createVariables([], [{ id: "1", value: "9am - 5pm" }]),
      }),
    ).resolves.toBe(`{{${formatBotFieldReference("999")}}}`)
  })

  test("never collides a bot_field token with a contact custom field of the same name", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: `{{${formatBotFieldReference("1")}}}`,
        variables: createVariables(
          [{ key: formatBotFieldReference("1"), value: "wrong value" }],
          [{ id: "1", value: "right value" }],
        ),
      }),
    ).resolves.toBe("right value")
  })
})

describe("contactVariableService.replaceAll gender casing", () => {
  const genderVariables = (gender: string | null, language: string) => ({
    ...createVariables(),
    contact: { ...contact, gender } as ContactModel,
    workspace: { ...workspace, language } as WorkspaceModel,
  })

  test("capitalises {{gender}} when it opens the text", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "{{gender}} vui lòng xác nhận đơn hàng.",
        variables: genderVariables("male", "vi"),
      }),
    ).resolves.toBe("Anh vui lòng xác nhận đơn hàng.")
  })

  test("lowercases {{gender}} inside a sentence", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "Xin chào {{gender}}, đơn hàng đã được giao.",
        variables: genderVariables("female", "vi"),
      }),
    ).resolves.toBe("Xin chào chị, đơn hàng đã được giao.")
  })

  test("capitalises {{gender}} after a sentence break and after a newline", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "Cảm ơn. {{gender}} nhé!\n{{gender}} cần hỗ trợ gì thêm không?",
        variables: genderVariables(null, "vi"),
      }),
    ).resolves.toBe("Cảm ơn. Anh/Chị nhé!\nAnh/Chị cần hỗ trợ gì thêm không?")
  })

  test("keeps the Vietnamese labels for a region-tagged workspace language", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "Kính gửi {{gender}}",
        variables: genderVariables("female", "vi-VN"),
      }),
    ).resolves.toBe("Kính gửi chị")
  })

  test("falls back to the English labels for other workspace languages", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "{{gender}} — hello {{gender}}",
        variables: genderVariables("male", "de"),
      }),
    ).resolves.toBe("Male — hello male")
  })

  test("leaves other variables untouched by the sentence casing", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "Hi {{first_name}}, {{gender}}!",
        variables: genderVariables("male", "vi"),
      }),
    ).resolves.toBe("Hi Ada, anh!")
  })
})

describe("contactVariableService.replaceAll gender language", () => {
  const render = (input: {
    workspaceLanguage: string | null
    contactLocale?: string | null
    inboxLanguage?: string | null
  }) =>
    contactVariableService.replaceAll({
      text: "{{gender}}",
      variables: {
        ...createVariables(),
        contact: {
          ...contact,
          gender: "female",
          locale: input.contactLocale ?? null,
        } as ContactModel,
        contactInbox: {
          ...contactInbox,
          language: input.inboxLanguage ?? null,
        } as ContactInboxModel,
        workspace: {
          ...workspace,
          language: input.workspaceLanguage,
        } as WorkspaceModel,
      },
    })

  test("renders Vietnamese for a Vietnamese workspace", async () => {
    await expect(render({ workspaceLanguage: "vi" })).resolves.toBe("Chị")
  })

  test("renders English for any non-Vietnamese workspace", async () => {
    await expect(render({ workspaceLanguage: "en" })).resolves.toBe("Female")
    await expect(render({ workspaceLanguage: "de" })).resolves.toBe("Female")
  })

  test("ignores the contact channel language", async () => {
    await expect(
      render({ inboxLanguage: "vi", workspaceLanguage: "en" }),
    ).resolves.toBe("Female")
    await expect(
      render({ inboxLanguage: "en", workspaceLanguage: "vi" }),
    ).resolves.toBe("Chị")
  })

  test("ignores the contact locale", async () => {
    await expect(
      render({ contactLocale: "vi_VN", workspaceLanguage: "en" }),
    ).resolves.toBe("Female")
    await expect(
      render({ contactLocale: "en_US", workspaceLanguage: "vi" }),
    ).resolves.toBe("Chị")
  })

  test("falls back to English when the workspace has no language", async () => {
    await expect(
      render({ contactLocale: "vi_VN", workspaceLanguage: null }),
    ).resolves.toBe("Female")
  })
})

/**
 * A custom field the merchant defined but this contact never filled has no
 * `ContactCustomField` row, so it was absent from `customFieldsMap`, matched no
 * resolver, and `interpolate` returned the token unchanged. On 3 Sep 2026 that
 * sent 13 of one merchant's customers a message whose entire body was the
 * literal text `{{zain_auto_reply}}`.
 */
describe("custom fields defined but never filled", () => {
  test("renders an unanswered field as empty, not as its own token", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "{{zain_auto_reply}}",
        variables: createVariables([], [], ["zain_auto_reply"]),
      }),
    ).resolves.toBe("")
  })

  test("still leaves a name the workspace never defined alone", async () => {
    // The distinction is the whole fix: an undefined name is a typo worth
    // showing the merchant, an unanswered field is simply empty.
    await expect(
      contactVariableService.replaceAll({
        text: "{{zain_auto_replie}}",
        variables: createVariables([], [], ["zain_auto_reply"]),
      }),
    ).resolves.toBe("{{zain_auto_replie}}")
  })

  test("a filled field still wins over the empty fallback", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "Plan: {{plan}}.",
        variables: createVariables([{ key: "plan", value: "gold" }]),
      }),
    ).resolves.toBe("Plan: gold.")
  })

  test("a system field name defined as a custom field still resolves system-first", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "Hi {{first_name}}.",
        variables: createVariables([], [], ["first_name"]),
      }),
    ).resolves.toBe("Hi Ada.")
  })

  test("the raw: form of an unanswered field is empty too", async () => {
    await expect(
      contactVariableService.replaceAll({
        text: "[{{raw:zain_auto_reply}}]",
        variables: createVariables([], [], ["zain_auto_reply"]),
      }),
    ).resolves.toBe("[]")
  })
})

describe("contactVariableService.getAll", () => {
  test("uses a provided contact inbox object and skips the inbox query", async () => {
    mockContactFindFirst.mockResolvedValue(contact)
    mockWorkspaceFind.mockResolvedValue(workspace)
    mockContactCustomFieldFindMany.mockResolvedValue([
      {
        value: "gold",
        customField: {
          name: "plan",
          type: "text",
          description: "Plan",
        },
      },
    ])

    await expect(
      contactVariableService.getAll({
        contactId: "contact-1",
        contactInbox,
      }),
    ).resolves.toMatchObject({
      contact,
      contactInbox,
      workspace,
    })
    expect(mockContactInboxFindFirst).not.toHaveBeenCalled()
  })

  test("loads a contact inbox once when an id is provided", async () => {
    mockContactFindFirst.mockResolvedValue(contact)
    mockContactInboxFindFirst.mockResolvedValue(contactInbox)
    mockWorkspaceFind.mockResolvedValue(workspace)
    mockContactCustomFieldFindMany.mockResolvedValue([])

    await expect(
      contactVariableService.getAll({
        contactId: "contact-1",
        contactInbox: "contact-inbox-1",
      }),
    ).resolves.toMatchObject({
      contactInbox,
    })
    expect(mockContactInboxFindFirst).toHaveBeenCalledWith({
      where: { id: "contact-inbox-1" },
    })
  })

  test("uses the provided workspace and skips the workspace query", async () => {
    mockContactFindFirst.mockResolvedValue(contact)
    mockContactCustomFieldFindMany.mockResolvedValue([])

    await expect(
      contactVariableService.getAll({
        contactId: "contact-1",
        contactInbox,
        workspace,
      }),
    ).resolves.toMatchObject({
      workspace,
    })
    expect(mockWorkspaceFind).not.toHaveBeenCalled()
  })

  test("builds botFieldsMap from the contact's workspace, keyed by field id", async () => {
    mockContactFindFirst.mockResolvedValue(contact)
    mockContactCustomFieldFindMany.mockResolvedValue([])
    mockBotFieldFindMany.mockResolvedValue([
      { id: "1", type: "shortText", value: "9am - 5pm" },
    ])

    const result = await contactVariableService.getAll({
      contactId: "contact-1",
      contactInbox,
      workspace,
    })

    expect(mockBotFieldFindMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1" },
    })
    expect(result.botFieldsMap?.get("1")).toEqual({
      type: "shortText",
      value: "9am - 5pm",
    })
  })

  test("collects every custom-field name the workspace defines", async () => {
    mockContactFindFirst.mockResolvedValue(contact)
    mockContactCustomFieldFindMany.mockResolvedValue([])
    mockCustomFieldFindMany.mockResolvedValue([
      { name: "zain_auto_reply" },
      { name: "plan" },
    ])

    const result = await contactVariableService.getAll({
      contactId: "contact-1",
      contactInbox,
      workspace,
    })

    expect(mockCustomFieldFindMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1" },
      columns: { name: true },
    })
    expect(result.workspaceCustomFieldNames?.has("zain_auto_reply")).toBe(true)
    expect(result.workspaceCustomFieldNames?.has("plan")).toBe(true)
  })
})
