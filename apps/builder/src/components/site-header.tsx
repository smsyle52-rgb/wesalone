import Link from "next/link";
import { SparklesIcon, StarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { VeloraLanguageToggle } from "@/components/velora-language-toggle";
import { siteConfig } from "@/lib/site-config";

export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <SparklesIcon className="size-5 text-primary" />
          Velora UI
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <Link href="/components" className="transition-colors hover:text-foreground">
            Components
          </Link>
          <Link href="/themes" className="transition-colors hover:text-foreground">
            Themes
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-foreground">
            Pricing
          </Link>
          <Link href="/blog" className="transition-colors hover:text-foreground">
            Blog
          </Link>
          <Link href="/changelog" className="transition-colors hover:text-foreground">
            Changelog
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <VeloraLanguageToggle />
          <ThemeToggle />
          <Button variant="outline" size="sm" asChild>
            <a href={siteConfig.github} rel="noopener" target="_blank">
              <StarIcon />
              Star on GitHub
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}

