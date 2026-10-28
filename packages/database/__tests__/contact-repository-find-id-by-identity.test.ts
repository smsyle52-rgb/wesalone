import { PgDialect } from "drizzle-orm/pg-core"
import { describe, expect, test, vi } from "vitest"
import { contactRepository } from "../src/repositories/contact/repository"

const render = (statement: unknown) => {
  const rendered = new PgDialect().sqlToQuery(statement as never)
  return {
    sql: rendered.sql.replace(/\s+/g, " ").trim(),
    params: rendered.params,
  }
}

const makeTx = (input: {
  findFirst: Array<{ id: string } | undefined>
  waIdRows?: Array<{ id: string }>
}) => {
  const findFirst = vi.fn()
  for (const result of input.findFirst) {
    findFirst.mockResolvedValueOnce(result)
  }
  const where = vi.fn().mockReturnThis()
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where,
    limit: vi.fn().mockResolvedValue(input.waIdRows ?? []),
  }
  const select = vi.fn().mockReturnValue(chain)
  return {
    tx: { query: { contactModel: { findFirst } }, select } as never,
    findFirst,
    select,
    where,
  }
}

describe("contactRepository.findIdByIdentityWhere", () => {
  test("returns the exact phoneNumber match without any fallback", async () => {
    const { tx, findFirst, select } = makeTx({
      findFirst: [{ id: "contact-1" }],
    })

    const result = await contactRepository.findIdByIdentityWhere(
      { workspaceId: "ws-1", phoneNumber: "+967782141619" },
      tx,
    )

    expect(result).toEqual({ id: "contact-1" })
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(select).not.toHaveBeenCalled()
  })

  test("falls back to the same digits stored without a plus sign", async () => {
    const { tx, findFirst, select } = makeTx({
      findFirst: [undefined, { id: "contact-2" }],
    })

    const result = await contactRepository.findIdByIdentityWhere(
      { workspaceId: "ws-1", phoneNumber: "+967782141619" },
      tx,
    )

    expect(result).toEqual({ id: "contact-2" })
    expect(findFirst).toHaveBeenLastCalledWith({
      where: {
        workspaceId: "ws-1",
        phoneNumber: { in: ["967782141619", "+967782141619"] },
      },
      columns: { id: true },
    })
    expect(select).not.toHaveBeenCalled()
  })

  // The stored phone can be empty or a mis-parsed number the customer typed;
  // the WhatsApp wa_id is still the customer's real number.
  test("falls back to the workspace's WhatsApp contact whose wa_id is the number", async () => {
    const { tx, where } = makeTx({
      findFirst: [undefined, undefined],
      waIdRows: [{ id: "contact-3" }],
    })

    const result = await contactRepository.findIdByIdentityWhere(
      { workspaceId: "ws-1", phoneNumber: "+967 782 141 619" },
      tx,
    )

    expect(result).toEqual({ id: "contact-3" })
    const { sql, params } = render(where.mock.calls[0]?.[0])
    expect(sql).toContain('"Inbox"."workspaceId" = $1')
    expect(sql).toContain('"Inbox"."channel" = $2')
    expect(sql).toContain('"ContactInbox"."sourceId" = $3')
    expect(params).toEqual(["ws-1", "whatsapp", "967782141619"])
  })

  test("returns null when no variant matches", async () => {
    const { tx } = makeTx({ findFirst: [undefined, undefined] })

    const result = await contactRepository.findIdByIdentityWhere(
      { workspaceId: "ws-1", phoneNumber: "+967782141619" },
      tx,
    )

    expect(result).toBeNull()
  })

  test("does not fall back for id or email identifiers, or too few digits", async () => {
    const byEmail = makeTx({ findFirst: [undefined] })
    expect(
      await contactRepository.findIdByIdentityWhere(
        { workspaceId: "ws-1", email: "ada@example.com" },
        byEmail.tx,
      ),
    ).toBeNull()
    expect(byEmail.findFirst).toHaveBeenCalledTimes(1)

    const shortPhone = makeTx({ findFirst: [undefined] })
    expect(
      await contactRepository.findIdByIdentityWhere(
        { workspaceId: "ws-1", phoneNumber: "+12345" },
        shortPhone.tx,
      ),
    ).toBeNull()
    expect(shortPhone.findFirst).toHaveBeenCalledTimes(1)
    expect(shortPhone.select).not.toHaveBeenCalled()
  })
})
