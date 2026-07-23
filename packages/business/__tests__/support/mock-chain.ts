import { vi } from "vitest"

/**
 * Minimal stand-ins for drizzle's fluent query builder chains
 * (`.insert(t).values(v).returning()`, `.update(t).set(v).where(w).returning()`,
 * `.delete(t).where(w)`, `.select().from(t).where(w)`). `.values/.set/.where/.from`
 * are no-op passthroughs that just return the same chain; `.returning()` and
 * a thenable on the chain itself both resolve to the configured rows, so the
 * same chain works whether or not the caller appends `.returning()`.
 */
export const makeChain = (rows: unknown[]) => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.values = vi.fn(self)
  chain.set = vi.fn(self)
  chain.where = vi.fn(self)
  chain.from = vi.fn(self)
  chain.limit = vi.fn(self)
  chain.returning = vi.fn().mockResolvedValue(rows)
  // biome-ignore lint/suspicious/noThenProperty: deliberately thenable, so a chain works whether or not the caller appends .returning() — mirrors real drizzle query builders
  chain.then = (
    resolve: (v: unknown[]) => void,
    reject?: (e: unknown) => void,
  ) => Promise.resolve(rows).then(resolve, reject)
  return chain
}

/** Same shape as makeChain, but rejects — for unique-violation-style races. */
export const makeErrorChain = (error: unknown) => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.values = vi.fn(self)
  chain.set = vi.fn(self)
  chain.where = vi.fn(self)
  chain.from = vi.fn(self)
  chain.limit = vi.fn(self)
  chain.returning = vi.fn().mockRejectedValue(error)
  // biome-ignore lint/suspicious/noThenProperty: deliberately thenable, matching makeChain above
  chain.then = (
    _resolve: (v: unknown[]) => void,
    reject?: (e: unknown) => void,
  ) => Promise.reject(error).catch(reject)
  return chain
}

export class FakeUniqueViolationError extends Error {
  constructor(message = "duplicate key value violates unique constraint") {
    super(message)
    this.name = "FakeUniqueViolationError"
  }
}

/** Fake `sql` tagged template — real drizzle-orm `sql` is unused by callers
 * once the db client is mocked; callers only need it to be callable. */
export const fakeSql = Object.assign(
  vi.fn(() => ({})),
  {
    raw: vi.fn((value: string) => value),
  },
)
