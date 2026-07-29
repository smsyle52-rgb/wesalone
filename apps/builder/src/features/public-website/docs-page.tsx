import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { getLocale, getTranslations } from "next-intl/server"
import { notFound } from "next/navigation"
import { SiteShell } from "./site-shell"

type DocArticle = {
  slug: string
  title: string
  summary: string
  sections: Array<{ title: string; body: string; bullets?: string[] }>
}
type DocGroup = {
  id: string
  title: string
  description: string
  articles: DocArticle[]
}

async function getDocs() {
  const t = await getTranslations("productDocs")
  return { t, groups: t.raw("groups") as DocGroup[] }
}

export async function DocsIndexPage() {
  const { t, groups } = await getDocs()
  const locale = await getLocale()
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight
  return (
    <SiteShell>
      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="max-w-4xl">
          <p className="font-bold text-cyan-300 text-sm">{t("eyebrow")}</p>
          <h1 className="mt-4 font-black text-4xl sm:text-6xl">{t("title")}</h1>
          <p className="mt-6 max-w-3xl text-slate-300 leading-8">
            {t("intro")}
          </p>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          {groups.map((group) => (
            <section
              className="rounded-3xl border border-white/10 bg-white/[.035] p-6"
              key={group.id}
            >
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-cyan-300/10 p-3">
                  <BookOpen className="h-6 w-6 text-cyan-300" />
                </div>
                <div>
                  <h2 className="font-black text-2xl">{group.title}</h2>
                  <p className="mt-2 text-slate-400 text-sm leading-7">
                    {group.description}
                  </p>
                </div>
              </div>
              <div className="mt-6 grid gap-2">
                {group.articles.map((article) => (
                  <Link
                    className="group flex items-center justify-between rounded-xl border border-white/5 bg-black/10 px-4 py-3 text-sm transition hover:border-cyan-300/30 hover:bg-cyan-300/5"
                    href={`/docs/${article.slug}`}
                    key={article.slug}
                  >
                    <span>{article.title}</span>
                    <Arrow className="h-4 w-4 text-slate-500 transition group-hover:text-cyan-300" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </SiteShell>
  )
}

export async function DocArticlePage({ slug }: { slug: string }) {
  const { t, groups } = await getDocs()
  const locale = await getLocale()
  const articles = groups.flatMap((group) =>
    group.articles.map((article) => ({ ...article, group })),
  )
  const index = articles.findIndex((article) => article.slug === slug)
  if (index === -1) notFound()
  const article = articles[index]
  const previous = articles[index - 1]
  const next = articles[index + 1]
  const PreviousIcon = locale === "ar" ? ChevronRight : ChevronLeft
  const NextIcon = locale === "ar" ? ChevronLeft : ChevronRight

  return (
    <SiteShell>
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-8">
        <aside className="lg:sticky lg:top-28 lg:h-fit">
          <Link className="text-cyan-300 text-sm" href="/docs">
            {t("allDocs")}
          </Link>
          <nav className="mt-5 space-y-6">
            {groups.map((group) => (
              <div key={group.id}>
                <p className="font-bold text-slate-300 text-xs">
                  {group.title}
                </p>
                <div className="mt-2 space-y-1">
                  {group.articles.map((item) => (
                    <Link
                      className={
                        item.slug === slug
                          ? "block rounded-lg bg-cyan-300/10 px-3 py-2 text-cyan-200 text-xs"
                          : "block rounded-lg px-3 py-2 text-slate-500 text-xs hover:text-white"
                      }
                      href={`/docs/${item.slug}`}
                      key={item.slug}
                    >
                      {item.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>
        <article className="min-w-0">
          <p className="font-bold text-cyan-300 text-sm">
            {article.group.title}
          </p>
          <h1 className="mt-3 text-balance font-black text-4xl leading-tight sm:text-5xl">
            {article.title}
          </h1>
          <p className="mt-5 border-white/10 border-b pb-8 text-slate-300 leading-8">
            {article.summary}
          </p>
          <div className="mt-9 space-y-10">
            {article.sections.map((section) => (
              <section key={section.title}>
                <h2 className="font-black text-2xl">{section.title}</h2>
                <p className="mt-4 text-slate-400 leading-8">{section.body}</p>
                {section.bullets && (
                  <ul className="mt-5 list-inside list-disc space-y-3 text-slate-300 leading-7">
                    {section.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
          <div className="mt-14 grid gap-3 border-white/10 border-t pt-7 sm:grid-cols-2">
            {previous ? (
              <Link
                className="rounded-2xl border border-white/10 p-4 hover:bg-white/5"
                href={`/docs/${previous.slug}`}
              >
                <span className="flex items-center gap-1 text-slate-500 text-xs">
                  <PreviousIcon className="h-4 w-4" />
                  {t("previous")}
                </span>
                <strong className="mt-2 block text-sm">{previous.title}</strong>
              </Link>
            ) : (
              <div />
            )}
            {next && (
              <Link
                className="rounded-2xl border border-white/10 p-4 text-end hover:bg-white/5"
                href={`/docs/${next.slug}`}
              >
                <span className="flex items-center justify-end gap-1 text-slate-500 text-xs">
                  {t("next")}
                  <NextIcon className="h-4 w-4" />
                </span>
                <strong className="mt-2 block text-sm">{next.title}</strong>
              </Link>
            )}
          </div>
        </article>
      </div>
    </SiteShell>
  )
}
