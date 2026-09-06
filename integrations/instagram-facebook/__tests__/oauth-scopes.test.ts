import { describe, expect, it } from "vitest"
import { generateAuthUrl } from "../src/apis/auth"

/**
 * Meta answers the OAuth dialog with "Invalid Scopes" and a dead end when the
 * app asks for a permission it has not been approved for. It has happened
 * three times now — instagram_manage_comments, instagram_manage_engagement,
 * and instagram_manage_events — and it is invisible in testing because Meta
 * only shows that screen to people who are admins, developers or testers on
 * the app. Everyone else gets the unknown scope dropped silently.
 *
 * So this pins the list. Adding a scope here means the app has Advanced Access
 * for it; if it does not, connecting Instagram breaks for the owner and for
 * anyone testing the app, and nothing in a build or a typecheck will say so.
 */
const DIALOG_PATH = /\/dialog\/oauth$/

const APPROVED_SCOPES = [
  "instagram_basic",
  "instagram_manage_messages",
  "pages_manage_metadata",
  "pages_show_list",
  "pages_messaging",
  "pages_read_engagement",
  "business_management",
]

function requestedScopes() {
  const url = new URL(
    generateAuthUrl({
      clientId: "1437258534807702",
      redirectUrl: "https://wesal.one/integrations/instagram-facebook/callback",
    })
  )
  return (url.searchParams.get("scope") ?? "").split(",").filter(Boolean)
}

describe("instagram-facebook OAuth", () => {
  it("asks only for permissions the app is approved for", () => {
    expect(requestedScopes()).toEqual(APPROVED_SCOPES)
  })

  it("does not ask for the Conversions API permission", () => {
    // Requesting it is what broke the dialog; the ads tab reads the granted
    // scopes from the token instead and offers a manual CAPI token.
    expect(requestedScopes()).not.toContain("instagram_manage_events")
  })

  it("sends the merchant to Facebook, not to instagram.com", () => {
    // The other Instagram card sends this Facebook app id to
    // instagram.com/oauth/authorize, which answers "Invalid platform app".
    const url = new URL(
      generateAuthUrl({
        clientId: "1437258534807702",
        redirectUrl:
          "https://wesal.one/integrations/instagram-facebook/callback",
      })
    )
    expect(url.origin).toBe("https://www.facebook.com")
    expect(url.pathname).toMatch(DIALOG_PATH)
  })
})
