/**
 * Paths the proxy middleware lets through without a session.
 *
 * Kept in its own module so the list can be tested without importing the
 * middleware's server-only auth dependencies.
 */

// Checked BEFORE PUBLIC_ROUTES, and the only way to keep an authenticated page
// underneath a public one. `/channels` is the marketing page and must stay
// reachable signed out, but segment matching then opens everything below it —
// including `/channels/create`, the channel-connect flow. That flow was listed
// as public on 14 Aug 2026 among a batch of marketing pages, so a merchant
// arriving without a valid session cookie (expired, or returning from Meta's
// window in a browser that dropped it) reached the page itself, which answers
// `notFound()` — a "page not found" screen in the middle of onboarding, where
// every other private page redirects to sign-in and comes back.
export const PROTECTED_ROUTES = ["/channels/create"]

export const PUBLIC_ROUTES = [
  // Wesal One marketing site.
  "/about",
  "/channels",
  "/features",
  "/data-deletion",
  // Meta's app settings point at /privacy and /terms, and it requires both to
  // be reachable without a login — behind the session gate they answer 307 to
  // the sign-in page, which is grounds for rejecting the app on review. /contact
  // belongs here for a plainer reason: the people who need it are the ones who
  // do not have an account yet.
  "/privacy",
  "/terms",
  "/contact",
  "/login",
  "/pricing",
  "/signup",
  "/integrations",
  "/r",
  "/l",
  "/dynamic-images",
  "/go",
  "/media/attachment",
  "/media/avatar",
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

const matchesRoute = (pathname: string, route: string) => {
  const base = route.endsWith("/") ? route.slice(0, -1) : route
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * Whether the middleware lets a request through without a session.
 *
 * Matching is by path SEGMENT, never by bare `startsWith`: a plain prefix test
 * opens far more than the entry names — "/t" would also match "/templates",
 * "/r" would open "/register" and "/reports", and "/rpc" would match a future
 * "/rpcadmin". A trailing slash on an entry is therefore cosmetic here, and an
 * entry still opens everything nested under it, so the list is pinned by a
 * test.
 */
export function isPublicRoute(pathname: string) {
  // The Wesal One landing page.
  if (pathname === "/") {
    return true
  }
  if (PROTECTED_ROUTES.some((route) => matchesRoute(pathname, route))) {
    return false
  }
  return PUBLIC_ROUTES.some((route) => matchesRoute(pathname, route))
}
