export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  dateISO: string;
  category: string;
  readingTime: string;
}

/** Listing metadata for /blog — the content lives in src/app/blog/(posts)/<slug>/page.mdx */
export const blogPosts: BlogPost[] = [
  {
    slug: "introducing-velora-ui",
    title: "Introducing Velora UI: the free tier is the whole product",
    excerpt:
      "32+ animated shadcn components and a complete multi-page landing template — blog, pricing, auth, changelog — free under MIT. Here's why we're giving away the thing everyone else sells.",
    date: "July 16, 2026",
    dateISO: "2026-07-16",
    category: "Announcements",
    readingTime: "4 min read",
  },
  {
    slug: "animations-with-receipts",
    title: "Animations with receipts: publishing the cost of every component",
    excerpt:
      "Animated component libraries love a pretty demo and hate a bundle-size column. Every Velora docs page now shows gzipped size, dependency count and reduced-motion behavior.",
    date: "July 16, 2026",
    dateISO: "2026-07-16",
    category: "Engineering",
    readingTime: "3 min read",
  },
  {
    slug: "retheme-in-one-token-block",
    title: "Rebrand your landing page in one token block",
    excerpt:
      "We moved Velora's entire visual identity from violet to blue by editing seven CSS variables. That's the point: animated components should read your design tokens, not fight them.",
    date: "July 16, 2026",
    dateISO: "2026-07-16",
    category: "Design",
    readingTime: "3 min read",
  },
];

