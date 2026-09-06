import { renderToStaticMarkup } from "react-dom/server"
import { beforeAll, describe, expect, it, vi } from "vitest"

/**
 * The landing page is the one page a reviewer at Meta, Google or a startup
 * credit programme actually opens. Two things about it kept breaking silently:
 *
 *  1. English visitors used to be routed to a different component entirely, so
 *     the product a reviewer saw was not the product this page describes.
 *     Google rejected a credit application saying it could not identify the
 *     product. There is now one design and only the words change.
 *
 *  2. The page carries `@ts-nocheck` and `biome-ignore-all`, so neither the
 *     typechecker nor the linter will tell anyone when a section stops
 *     rendering or when a string stops being translated.
 *
 * These tests render the real page and read the output.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("@/lib/locale", () => ({
  setUserLocale: vi.fn(),
}))

let WesalSourceMarketingPage: typeof import("@/features/marketing/wesal-source-marketing-page").default
let MARKETING_EN: typeof import("@/features/marketing/marketing-copy-en").MARKETING_EN

beforeAll(async () => {
  WesalSourceMarketingPage = (
    await import("@/features/marketing/wesal-source-marketing-page")
  ).default
  MARKETING_EN = (await import("@/features/marketing/marketing-copy-en"))
    .MARKETING_EN
})

const ARABIC = /[؀-ۿ]/
const GAP = /\s{2,}/
const TAG = /<[^>]+>/g
const ENTITY = /&[a-z]+;/g

function render(lang: "ar" | "en") {
  return renderToStaticMarkup(<WesalSourceMarketingPage lang={lang} />)
}

describe("landing page", () => {
  it("renders the same sections in both languages", () => {
    const ar = render("ar")
    const en = render("en")

    for (const id of [
      "preview",
      "features",
      "stories",
      "pricing",
      "resources",
      "contact",
    ]) {
      expect(ar).toContain(`id="${id}"`)
      expect(en).toContain(`id="${id}"`)
    }
  })

  it("flips direction with the language", () => {
    expect(render("ar")).toContain('dir="rtl"')
    expect(render("en")).toContain('dir="ltr"')
  })

  it("leaves no Arabic in the English rendering", () => {
    const en = render("en")
      // Attribute values and the WhatsApp number carry their own dir markers;
      // strip the tags so only what a reader sees is checked.
      .replace(TAG, " ")
      .replace(ENTITY, " ")

    const leftovers = en
      .split(GAP)
      .map((chunk) => chunk.trim())
      .filter((chunk) => ARABIC.test(chunk))

    expect(leftovers).toEqual([])
  })

  it("keeps the Arabic rendering Arabic", () => {
    const ar = render("ar")
    expect(ar).toContain("وصال ون")
    expect(ar).toContain("صنعاء، اليمن")
  })

  it("shows the identity a reviewer looks for", () => {
    for (const lang of ["ar", "en"] as const) {
      const html = render(lang)
      expect(html).toContain('href="/privacy"')
      expect(html).toContain('href="/terms"')
      expect(html).toContain('href="/data-deletion"')
      expect(html).toContain('href="/about"')
      expect(html).toContain("https://www.facebook.com/WesalOneAI")
      expect(html).toContain('href="/auth/sign-in"')
      expect(html).toContain('href="/auth/sign-up"')
      expect(html).toContain("support@wesal.one")
    }
  })

  it("has an English translation for every string the page renders", () => {
    const source = readPageSource()
    const keys = new Set<string>()
    for (const match of source.matchAll(/tr\(\s*"([^"\n]+)"\s*,?\s*\)/g)) {
      keys.add(match[1] as string)
    }

    expect(keys.size).toBeGreaterThan(300)
    const missing = [...keys].filter((key) => !(key in MARKETING_EN))
    expect(missing).toEqual([])
  })
})

function readPageSource() {
  // Read the file rather than the module: the point is to catch a string that
  // was added to the markup and never translated.
  const { readFileSync } = require("node:fs") as typeof import("node:fs")
  const { join } = require("node:path") as typeof import("node:path")
  return readFileSync(
    join(
      process.cwd(),
      "src/features/marketing/wesal-source-marketing-page.tsx",
    ),
    "utf8",
  )
}
