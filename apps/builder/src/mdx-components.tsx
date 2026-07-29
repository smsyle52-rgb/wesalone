import type { MDXComponents } from "mdx/types";
import Link from "next/link";

/**
 * Global MDX element styling for blog posts. Kept dependency-free —
 * no typography plugin, just Tailwind utilities per tag.
 */
const components: MDXComponents = {
  h1: (props) => (
    <h1
      className="text-3xl font-semibold tracking-tight text-balance lg:text-4xl"
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="mt-12 scroll-mt-24 text-2xl font-semibold tracking-tight"
      {...props}
    />
  ),
  h3: (props) => (
    <h3
      className="mt-8 scroll-mt-24 text-xl font-semibold tracking-tight"
      {...props}
    />
  ),
  p: (props) => (
    <p className="mt-5 leading-7 text-muted-foreground" {...props} />
  ),
  ul: (props) => (
    <ul
      className="mt-5 list-disc space-y-2 pl-6 text-muted-foreground"
      {...props}
    />
  ),
  ol: (props) => (
    <ol
      className="mt-5 list-decimal space-y-2 pl-6 text-muted-foreground"
      {...props}
    />
  ),
  li: (props) => <li className="leading-7" {...props} />,
  a: ({ href = "", ...props }) =>
    href.startsWith("/") ? (
      <Link
        href={href}
        className="font-medium text-primary underline underline-offset-4"
        {...props}
      />
    ) : (
      <a
        href={href}
        rel="noopener"
        className="font-medium text-primary underline underline-offset-4"
        {...props}
      />
    ),
  strong: (props) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
  code: (props) => (
    <code
      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="mt-5 overflow-x-auto rounded-xl border bg-neutral-950 p-5 font-mono text-sm text-neutral-200 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit"
      {...props}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="mt-5 border-l-2 border-primary/40 pl-4 italic text-muted-foreground"
      {...props}
    />
  ),
  hr: (props) => <hr className="my-10 border-border/60" {...props} />,
};

export function useMDXComponents(): MDXComponents {
  return components;
}

