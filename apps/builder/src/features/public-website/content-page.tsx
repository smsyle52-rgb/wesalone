import { CheckCircle2 } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { SiteShell } from "./site-shell"

export type ContentPageKind =
  | "features"
  | "channels"
  | "about"
  | "contact"
  | "privacy"
  | "terms"
  | "dataDeletion"

type PageContent = {
  eyebrow: string
  title: string
  intro: string
  updated?: string
  sections: Array<{ title: string; body: string[]; bullets?: string[] }>
}

export async function ContentPage({ kind }: { kind: ContentPageKind }) {
  const t = await getTranslations("publicPages")
  const page = t.raw(kind) as PageContent
  const isLegal =
    kind === "privacy" || kind === "terms" || kind === "dataDeletion"

  return (
    <SiteShell>
      <section className="mx-auto max-w-6xl px-5 py-20 lg:px-8">
        <div className="max-w-4xl">
          <p className="font-bold text-cyan-300 text-sm">{page.eyebrow}</p>
          <h1 className="mt-4 text-balance font-black text-4xl leading-tight sm:text-6xl">
            {page.title}
          </h1>
          <p className="mt-6 max-w-3xl text-slate-300 leading-8">
            {page.intro}
          </p>
          {page.updated && (
            <p className="mt-3 text-slate-500 text-sm">{page.updated}</p>
          )}
        </div>
        <div
          className={
            isLegal
              ? "mt-12 space-y-5"
              : "mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3"
          }
        >
          {page.sections.map((section) => (
            <article
              className="rounded-3xl border border-white/10 bg-white/[.035] p-6"
              key={section.title}
            >
              <h2 className="font-bold text-xl">{section.title}</h2>
              <div className="mt-4 space-y-3 text-slate-400 text-sm leading-7">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              {section.bullets && (
                <ul className="mt-5 space-y-3 text-slate-300 text-sm">
                  {section.bullets.map((item) => (
                    <li className="flex gap-2" key={item}>
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>
    </SiteShell>
  )
}
