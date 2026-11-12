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
  // The stored phone can belong to someone else (a number another customer
  // typed); the WhatsApp wa_id is always the customer's own number.
  test("resolves a phone to the WhatsApp contact whose wa_id is that number first", async () => {
    const { tx, where, findFirst } = makeTx({
      findFirst: [],
      waIdRows: [{ id: "contact-wa" }],
    })

    const result = await contactRepository.findIdByIdentityWhere(
      { workspaceId: "ws-1", phoneNumber: "+967 777 714 479" },
      tx,
    )

    expect(result).toEqual({ id: "contact-wa" })
    expect(findFirst).not.toHaveBeenCalled()
    const { sql, params } = render(where.mock.calls[0]?.[0])
    expect(sql).toContain('"Inbox"."workspaceId" = $1')
    expect(sql).toContain('"Inbox"."channel" = $2')
    expect(sql).toContain('"ContactInbox"."sourceId" = $3')
    expect(params).toEqual(["ws-1", "whatsapp", "967777714479"])
  })

  test("falls back to the exact stored phone when no WhatsApp contact has it", async () => {
    const { tx, findFirst } = makeTx({ findFirst: [{ id: "contact-1" }] })

    const result = await contactRepository.findIdByIdentityWhere(
      { workspaceId: "ws-1", phoneNumber: "+967782141619" },
      tx,
    )

    expect(result).toEqual({ id: "contact-1" })
    expect(findFirst).toHaveBeenCalledOnce()
    expect(findFirst).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", phoneNumber: "+967782141619" },
      columns: { id: true },
    })
  })

  test("then to the same digits stored without a plus sign", async () => {
    const { tx, findFirst } = makeTx({
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
  })

  test("returns null when nothing matches", async () => {
    const { tx } = makeTx({ findFirst: [undefined, undefined] })

    const result = await contactRepository.findIdByIdentityWhere(
      { workspaceId: "ws-1", phoneNumber: "+967782141619" },
      tx,
    )

    expect(result).toBeNull()
  })

  test("uses an exact match only for id, email, or a phone with too few digits", async () => {
    const byEmail = makeTx({ findFirst: [undefined] })
    expect(
      await contactRepository.findIdByIdentityWhere(
        { workspaceId: "ws-1", email: "ada@example.com" },
        byEmail.tx,
      ),
    ).toBeNull()
    expect(byEmail.findFirst).toHaveBeenCalledOnce()
    expect(byEmail.select).not.toHaveBeenCalled()

    const shortPhone = makeTx({ findFirst: [undefined] })
    expect(
      await contactRepository.findIdByIdentityWhere(
        { workspaceId: "ws-1", phoneNumber: "+12345" },
        shortPhone.tx,
      ),
    ).toBeNull()
    expect(shortPhone.findFirst).toHaveBeenCalledOnce()
    expect(shortPhone.select).not.toHaveBeenCalled()
  })
})
