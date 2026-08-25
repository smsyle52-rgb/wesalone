import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

/**
 * Guards for Wesal One's deliberate divergences from upstream ChatbotX.
 *
 * Every case below was fixed once, silently reverted by a later merge, and
 * fixed again — each costing hours to rediagnose because the symptom looks
 * like a fresh production bug rather than a lost patch. The upstream-sync
 * workflow cannot catch these: it aborts on unknown conflicts, so it is the
 * *manual* merges that reintroduce them, and a human comparing 117 overlapping
 * files will not notice one restored line.
 *
 * A failure here means a merge undid a decision, not that the decision was
 * wrong. Re-apply the fix; do not relax the assertion.
 */

const repoRoot = join(__dirname, "..", "..", "..")
const read = (relative: string) =>
  readFileSync(join(repoRoot, relative), "utf8")

describe("Google sign-in is not gated on the community edition", () => {
  /**
   * Wesal One runs with NEXT_PUBLIC_EDITION=community — switching to
   * cloud/enterprise makes both apps refuse to start without a LICENSE_KEY —
   * while holding a real platform Google credential. Upstream's
   * `if (isCommunity()) return …` in `resolveCredentialForTenant` discards
   * that credential, which takes Google sign-in off the login page entirely.
   *
   * Reverted by a manual upstream merge on 24 Aug 2026, hours after the fix.
   */
  const source = read("apps/builder/src/lib/auth/auth-instances.ts")

  test("resolveCredentialForTenant does not short-circuit on isCommunity()", () => {
    expect(source).not.toMatch(/if\s*\(\s*isCommunity\(\)\s*\)/)
  })

  test("the credential lookup still runs for the root tenant", () => {
    expect(source).toContain("findDecryptedPlatform")
  })
})

describe("Messenger OAuth requests only App-Review-approved scopes", () => {
  /**
   * `email` and `page_events` are not approved for this Meta app. Requesting
   * either makes Meta reject the whole authorization with "Invalid Scopes",
   * so every Messenger and Instagram connect attempt fails at the dialog.
   *
   * Removed on 24 Jul 2026, reintroduced by the 14 Aug manual merge, removed
   * again on 24 Aug.
   */
  const source = read("integrations/messenger/src/apis/auth.ts")
  const scopeBlock = source.slice(
    source.indexOf("export const MESSENGER_SCOPES"),
    source.indexOf("]", source.indexOf("export const MESSENGER_SCOPES")),
  )

  test("does not request the email scope", () => {
    expect(scopeBlock).not.toContain('"email"')
  })

  test("does not request the page_events scope", () => {
    expect(scopeBlock).not.toContain('"page_events"')
  })

  test("still requests the scopes Messenger actually needs", () => {
    for (const scope of ["pages_messaging", "pages_show_list"]) {
      expect(scopeBlock).toContain(scope)
    }
  })
})

describe("Instagram OAuth requests only App-Review-approved scopes", () => {
  /**
   * Same failure shape as the Messenger scopes above, found the same way and
   * two days apart: Meta rejects the whole authorization dialog when any one
   * requested scope is unapproved, so `instagram_manage_events` — wanted only
   * by the Conversions API, which this platform does not use — made every
   * Instagram connection dead-end on "Invalid Scopes". Confirmed live on
   * 25 Aug 2026 by removing that scope alone and watching the same URL go
   * from an error page to the consent screen.
   *
   * The constant and `hasInstagramManageEventsScope` must survive: both CAPI
   * consumers branch on the granted scopes, which is what lets the feature
   * degrade instead of break.
   */
  const source = read("integrations/instagram-facebook/src/apis/auth.ts")
  const scopeBlock = source.slice(
    source.indexOf("const INSTAGRAM_SCOPES"),
    source.indexOf("]", source.indexOf("const INSTAGRAM_SCOPES")),
  )
  // The block carries a long comment naming the scope repeatedly, so assert
  // on the requested strings only — a bare substring check passes even when
  // the scope has been restored to the array.
  const requested = scopeBlock
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")

  test("does not request the unapproved instagram_manage_events scope", () => {
    expect(requested).not.toContain("instagram_manage_events")
  })

  test("still requests the scopes Instagram messaging actually needs", () => {
    for (const scope of [
      "instagram_basic",
      "instagram_manage_messages",
      "pages_show_list",
      "pages_messaging",
    ]) {
      expect(requested).toContain(scope)
    }
  })

  test("the granted-scope check survives so CAPI degrades instead of breaking", () => {
    expect(source).toContain("hasInstagramManageEventsScope")
    expect(source).toContain("INSTAGRAM_MANAGE_EVENTS_SCOPE")
  })
})

describe("Meta's policy pages are reachable without a session", () => {
  /**
   * The Meta app registers https://www.wesal.one/privacy and /terms as its
   * policy URLs and requires both to load for anyone. Behind the session gate
   * they answer 307 to the sign-in page, which is grounds for rejecting the
   * app on review — and every merchant's WhatsApp connection depends on that
   * app staying approved. /contact matters for a plainer reason: the people
   * who need it do not have an account yet.
   */
  const source = read("apps/builder/src/proxy.ts")

  test.each(["/privacy", "/terms", "/contact"])(
    "%s is listed in publicRoutes",
    (route) => {
      expect(source).toContain(`"${route}"`)
    },
  )
})

describe("A blocked popup falls back to same-tab navigation", () => {
  /**
   * `window.open` is swallowed silently by ad blockers, privacy extensions,
   * per-site popup blocks and in-app browsers alike. None of them reach the
   * server, so a merchant reporting "the button does nothing" leaves no trace
   * to diagnose — seven did, while the same click worked in an unextended
   * Chrome. Showing a toast asking them to allow popups strands anyone whose
   * blocker they do not control or cannot find.
   *
   * Navigating in place clears the whole class. This is not a new flow: the
   * callback route already redirects back to the referer with
   * WA_OAUTH_CODE_PARAM whenever `window.opener` is missing, and the create
   * card reads that param on mount. Both halves must survive together — a
   * merge that keeps one and drops the other sends merchants to Meta and
   * loses them on the way back, which is worse than the toast.
   *
   * The reconnect button deliberately does NOT get this: it has no same-tab
   * return path, so navigating away there would strand the code.
   */
  const card = read(
    "apps/builder/src/features/integration-whatsapp/components/whatsapp-create.tsx",
  )
  const callback = read(
    "apps/builder/src/app/integrations/whatsapp/callback/route.ts",
  )

  test("a failed window.open navigates in place instead of only warning", () => {
    const branch = card.slice(card.indexOf("const authTab = window.open"))
    const body = branch.slice(0, branch.indexOf("}, ["))
    expect(body).toContain("window.location.href = url")
  })

  test("the create card still reads the code back off the URL", () => {
    expect(card).toContain("WA_OAUTH_CODE_PARAM")
  })

  test("the callback still hands the code back for a same-tab return", () => {
    expect(callback).toContain("WA_OAUTH_CODE_PARAM")
    expect(callback).toContain("fallbackUrl")
  })
})

describe("Knowledge-base retrieval uses a threshold the models can reach", () => {
  /**
   * 0.7 belongs to text-embedding-ada-002, whose cosine scores sit high and
   * bunched. Measured against the platform's current model
   * (text-embedding-3-small), an Arabic question scores 0.673 against a chunk
   * that answers it verbatim — so 0.7 discards every document ever indexed and
   * no knowledge base returns a single result.
   */
  const source = read("packages/ai/src/server/tools/files.ts")

  test("the default similarity threshold stays below the measured ceiling", () => {
    const match = source.match(/similarityThreshold\s*=\s*([\d.]+)/)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeLessThan(0.673)
  })
})

describe("A quota row created by usage sync does not silence the agent", () => {
  /**
   * `ensureBootstrapPlan` returns early unless `isCloud()`, and Wesal One runs
   * on the community edition — so the row is actually created by the usage-count
   * sync, which used to insert only `*Used` columns. `autoReplyEnabled` then took
   * its column default of false, and `isAutoReplyEnabledForWorkspace` reads that
   * field directly, so a merchant's agent was silent from signup.
   *
   * Found four times across three days, each discovered only because a human
   * noticed the agent never answered — the code path logs at info level and
   * raises nothing.
   */
  const source = read("packages/business/src/user-quota/service.ts")

  test("the usage-sync insert stamps autoReplyEnabled", () => {
    // Anchor on `userId: ownerId` — the usage-sync insert is the only one
    // keyed that way — and stop at its closing `})`, so the assertion cannot
    // be satisfied by the `onConflictDoUpdate` block that follows it.
    const start = source.indexOf("userId: ownerId,")
    expect(start).toBeGreaterThan(-1)
    const values = source
      .slice(start, source.indexOf("})", start))
      // Strip comments first. The block carries a long explanatory comment that
      // names the field repeatedly, so a plain substring check passes even when
      // the assignment itself has been deleted — verified by removing the line
      // and watching this test still go green.
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
    expect(values).toMatch(/autoReplyEnabled\s*:/)
  })

  test("every plan in the catalogue leaves auto-reply on", () => {
    const plans = read("packages/business/src/platform/wesal-one-plans.ts")
    expect(plans).not.toMatch(/autoReply:\s*false/)
  })
})

describe("Browser uploads carry the header Azure Blob requires", () => {
  /**
   * Azure Blob answers 400 MissingRequiredHeader to any upload without
   * `x-ms-blob-type`. The browser PUTs straight to storage, so a missing
   * header produces a client-side failure with no server-side log at all —
   * which is why this took hours to find the first time. It broke knowledge
   * documents, contact CSV imports and payment receipts simultaneously.
   */
  const source = read("packages/ui/src/lib/upload-headers.ts")

  test("the Azure branch sets x-ms-blob-type", () => {
    expect(source).toContain("x-ms-blob-type")
    expect(source).toContain("BlockBlob")
  })
})
