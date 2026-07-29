import { getTranslations } from "next-intl/server"
import { PublicShell } from "./public-shell"

export type PublicPageKind =
  | "features"
  | "channels"
  | "about"
  | "contact"
  | "privacy"
  | "terms"
  | "dataDeletion"

type PublicPage = {
  eyebrow: string
  title: string
  intro: string
  updated?: string
  sections: Array<{ title: string; body: string[]; bullets?: string[] }>
}

export async function PublicContentPage({ kind }: { kind: PublicPageKind }) {
  const t = await getTranslations("publicPages")
  const page = t.raw(kind) as PublicPage

  return (
    <PublicShell>
      <section className="relative overflow-hidden bg-[#05142b] px-5 py-20 lg:px-8">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_65%_80%_at_50%_0%,rgba(8,190,221,.28),transparent_70%)]" />
        <div className="relative mx-auto max-w-5xl text-center">
          <p className="font-bold text-cyan-200 text-sm">{page.eyebrow}</p>
          <h1 className="mt-4 text-balance font-black text-4xl leading-tight sm:text-6xl">{page.title}</h1>
          <p className="mx-auto mt-6 max-w-3xl text-base text-slate-300 leading-8">{page.intro}</p>
          {page.updated && <p className="mt-3 text-slate-400 text-sm">{page.updated}</p>}
        </div>
      </section>
      <section className="bg-slate-50 px-5 py-16 text-slate-950 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-2">
          {page.sections.map((section) => (
            <article
              className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm"
              key={section.title}
            >
              <h2 className="font-bold text-xl">{section.title}</h2>
              <div className="mt-4 space-y-3 text-slate-600 text-sm leading-7">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              {section.bullets && (
                <ul className="mt-4 list-inside list-disc space-y-2 text-slate-600 text-sm leading-7">
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>
    </PublicShell>
  )
}
