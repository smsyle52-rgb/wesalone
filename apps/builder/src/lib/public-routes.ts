/**
 * Paths the proxy middleware lets through without a session.
 *
 * Kept in its own module so the list can be tested without importing the
 * middleware's server-only auth dependencies.
 */
export const PUBLIC_ROUTES = [
  // Wesal One marketing pages. `/channels` is the marketing page, which is why
  // `/channels/create` needs the PROTECTED_ROUTES override below.
  "/about",
  "/channels",
  "/features",
  "/data-deletion",
  // Meta's app review requires /privacy and /terms without a login — behind the
  // session gate they answer 307 to sign-in, which is grounds for rejection.
  "/privacy",
  "/terms",
  "/contact",
  "/pricing",
  // Plain redirects to /auth/* that reached customers; they must not bounce
  // through the auth gate themselves.
  "/login",
  "/signup",
  "/integrations",
  "/r",
  "/l",
  "/dynamic-images",
  "/minigames",
  "/auth",
  "/api",
  // Like "/api": the RPC handler runs the full router, where every procedure
  // carries its own auth middleware and answers an unauthenticated call with
  // a 401. Redirecting here instead would hand the typed client the sign-in
  // page's HTML, which it cannot tell from a failed call.
  "/rpc",
  "/ws",
  "/storage",
  "/checkout",
  "/unsubscribe",
  "/email-topic",
  "/extensions",
  "/booking",
  "/portal/redeem",
  "/webchat",
  "/t/",
]

/**
 * Authenticated pages that sit underneath a public segment, checked BEFORE
 * PUBLIC_ROUTES. `/channels` is public marketing, but `/channels/create` is the
 * channel-connect flow: a merchant arriving there without a session must be
 * sent to sign-in, not shown the page's `notFound()` mid-onboarding.
 */
export const PROTECTED_ROUTES = ["/channels/create"]

/**
 * Whether the middleware lets a request through without a session.
 *
 * Matching is by path SEGMENT, never by bare `startsWith`: a plain prefix test
 * opens far more than the entry names — "/t" would also match "/templates",
 * and "/rpc" would match a future "/rpcadmin". A trailing slash on an entry is
 * therefore cosmetic here, and an entry still opens everything nested under it,
 * so the list is pinned by a test.
 */
export function isPublicRoute(pathname: string) {
  if (pathname === "/") {
    return true
  }
  for (const route of PROTECTED_ROUTES) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return false
    }
  }
  for (const route of PUBLIC_ROUTES) {
    const base = route.endsWith("/") ? route.slice(0, -1) : route
    if (pathname === base || pathname.startsWith(`${base}/`)) {
      return true
    }
  }
  return false
}
