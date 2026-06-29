export const LAST_INTERNAL_ROUTE_KEY = "wesal.lastInternalRoute";

const PUBLIC_ROUTE_PREFIXES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/about",
  "/privacy",
  "/data-deletion",
  "/terms",
  "/contact",
  "/products",
  "/app",
  "/__ui-lab",
];

const MARKETING_ROUTE_PREFIXES = [
  "/",
  "/about",
  "/privacy",
  "/data-deletion",
  "/terms",
  "/contact",
  "/products",
];

function pathnameOf(route: string) {
  return route.split(/[?#]/, 1)[0] || "/";
}

function matchesRoute(pathname: string, route: string) {
  return pathname === route || (route !== "/" && pathname.startsWith(`${route}/`));
}

export function isRunningAsInstalledApp() {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

export function isMarketingRoute(route: string) {
  const pathname = pathnameOf(route);
  return MARKETING_ROUTE_PREFIXES.some((prefix) => matchesRoute(pathname, prefix));
}

export function isSafeInternalRoute(route: string) {
  if (!route.startsWith("/") || route.startsWith("//")) return false;
  const pathname = pathnameOf(route);
  return !PUBLIC_ROUTE_PREFIXES.some((prefix) => matchesRoute(pathname, prefix));
}

export function readLastInternalRoute() {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(LAST_INTERNAL_ROUTE_KEY);
  return value && isSafeInternalRoute(value) ? value : null;
}

export function writeLastInternalRoute(route: string) {
  if (typeof window === "undefined" || !isSafeInternalRoute(route)) return;
  window.localStorage.setItem(LAST_INTERNAL_ROUTE_KEY, route);
}
