import {
  getPublicHostFromRequest,
  getPublicOriginFromRequest,
  getPublicProtocolFromRequest,
} from "@chatbotx.io/utils"
import { getSessionCookie } from "better-auth/cookies"
import { headers } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"
import { LOCALE_COOKIE, LOCALE_QUERY_PARAM, parseLocale } from "@/i18n/config"
import { auth } from "@/lib/auth/auth"
import { httpLogger } from "./lib/log"

const publicRoutes = [
  "/integrations",
  "/r",
  "/l",
  "/auth",
  "/api",
  "/ws",
  "/storage",
  "/checkout",
  "/unsubscribe",
  "/email-topic",
  "/extensions",
  "/features",
  "/channels",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/data-deletion",
  "/pricing",
]
const signinPath = "/auth/sign-in"

async function _logRequest(request: NextRequest) {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: safe to use any
    const headers = Object.fromEntries(request.headers as any)
    const body = await request.clone().json()
    httpLogger.info(
      {
        headers,
        body,
      },
      `LOG ${request.method} ${request.url}`,
    )
  } catch {
    // Body might be empty or not JSON
    httpLogger.info(
      {
        headers,
      },
      `LOG ${request.method} ${request.url} (Empty or not JSON)`,
    )
  }
}

export async function proxy(request: NextRequest) {
  // await logRequest(request)

  const { pathname, search } = request.nextUrl
  if (isPublicRoute(pathname)) {
    return attachProxyUrl(request)
  }

  const cookies = getSessionCookie(request)
  if (!cookies) {
    return NextResponse.redirect(buildSigninUrl(request, pathname, search))
  }

  // Verify the session is valid
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  if (!session) {
    return NextResponse.redirect(buildSigninUrl(request, pathname, search))
  }

  return attachProxyUrl(request)
}

/**
 * `?lang=en` pins the UI language and remembers the choice.
 *
 * The locale otherwise lives only in the NEXT_LOCALE cookie, so a link cannot
 * carry it: every visitor lands on the Arabic default and has to find the
 * switcher. That leaves no URL you can hand to someone who does not read
 * Arabic — a reviewer, a partner — and have the page open in a language they
 * understand.
 *
 * Only an explicit `?lang` does anything here. Visitors who do not pass one,
 * and anyone who has already chosen a language, are unaffected — in
 * particular this does NOT sniff Accept-Language, which would have flipped
 * Arabic-speaking merchants on English-language browsers to English.
 */
function applyLocaleOverride(
  request: NextRequest,
  response: NextResponse,
): void {
  const requested = parseLocale(
    request.nextUrl.searchParams.get(LOCALE_QUERY_PARAM),
  )
  if (!requested || request.cookies.get(LOCALE_COOKIE)?.value === requested) {
    return
  }

  response.cookies.set(LOCALE_COOKIE, requested, {
    path: "/",
    sameSite: "lax",
  })
}

function attachProxyUrl(request: NextRequest): NextResponse {
  const originUrl = new URL(request.url)
  originUrl.host = getPublicHostFromRequest(request)
  originUrl.protocol = getPublicProtocolFromRequest(request)
  originUrl.port = ""

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-url", originUrl.toString())
  requestHeaders.set("x-domain", originUrl.hostname)

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
  applyLocaleOverride(request, response)

  return response
}

function buildSigninUrl(
  request: NextRequest,
  pathname: string,
  search: string,
): URL {
  const publicOrigin = getPublicOriginFromRequest(request)
  const signinUrl = new URL(signinPath, publicOrigin)
  signinUrl.searchParams.set(
    "callbackURL",
    `${publicOrigin}${pathname}${search}`,
  )
  return signinUrl
}

/** Exported for tests — the auth gate depends on this matching exactly. */
export function isPublicRoute(pathname: string) {
  if (pathname === "/") {
    return true
  }
  for (const route of publicRoutes) {
    // Match whole path segments only. A bare startsWith() let the short-link
    // prefixes "/r" and "/l" open up every path beginning with those letters —
    // "/register" and "/login" were already reaching the app unauthenticated
    // (they 404 today only because no such page exists). Any future /reports
    // or /leads page would have been served with no auth check at all.
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return true
    }
  }
  return false
}

export const config = {
  matcher: [
    "/((?!webchat|zalo_verifier|pricing|chat-widget|assets|ws|storage|_next/static|_next/image|favicon.ico|avatars|.*.svg|brand|openapi.json).*)",
    "/api/presigned-upload",
    "/api/whatsapp/:path*",
  ],
}
