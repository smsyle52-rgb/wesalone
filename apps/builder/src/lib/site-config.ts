/**
 * Single source of truth for external URLs. Override at build time with
 * NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_GITHUB_URL when the real domain and
 * repo are wired up.
 */
export const siteConfig = {
  name: "وصال ون",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://wesal.one").replace(
    /\/$/,
    "",
  ),
  tagline: "منصة موحّدة لمحادثات عملائك",
  description:
    "وصال ون منصة أعمال متصلة توحّد محادثات عملائك من واتساب وإنستغرام وماسنجر وتيليجرام في صندوق وارد واحد، مع وكلاء ذكاء اصطناعي يردّون على الاستفسارات ويتابعون الطلبات.",
} as const
