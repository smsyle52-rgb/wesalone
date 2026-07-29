import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function PostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative">
      <SiteHeader />
      <article className="mx-auto max-w-3xl px-4 pt-36 pb-24 lg:px-8 lg:pt-44">
        <Link
          href="/blog"
          className="mb-8 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
          All posts
        </Link>
        {children}
      </article>
      <SiteFooter />
    </main>
  );
}

