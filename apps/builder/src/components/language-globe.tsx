"use client"

import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { isLocale, localeMeta, selectableLocales } from "@/i18n/config"
import { setUserLocale } from "@/lib/locale"

const SHORT: Record<string, string> = { ar: "AR", en: "EN" }

/**
 * The language control for the dark, brand-facing surfaces: the landing page
 * and the auth shell.
 *
 * `LangSelector` is the product's own control — a 180px combobox with a search
 * field inside it. That is right inside a settings form and wrong in a
 * marketing header, where it renders as a wide white box on a dark background
 * and reads as an unfinished page. Every platform shows a globe here, so this
 * is a globe. Colours are written against a dark surface rather than the app's
 * theme tokens, because these surfaces stay dark whatever the app theme says.
 */
export function LanguageGlobe({ className = "" }: { className?: string }) {
  const t = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const choose = useCallback(
    (value: string) => {
      setOpen(false)
      if (!isLocale(value) || value === locale) {
        return
      }
      startTransition(async () => {
        await setUserLocale(value)
        router.refresh()
      })
    },
    [locale, router],
  )

  return (
    <div className={`relative ${className}`} ref={boxRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("fields.language.label")}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 font-bold text-[13px] text-slate-200 transition hover:border-cyan-300/50 hover:text-white disabled:cursor-progress disabled:opacity-60"
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="16"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
          viewBox="0 0 24 24"
          width="16"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
        </svg>
        <span className="tracking-wider">
          {SHORT[locale] ?? locale.toUpperCase()}
        </span>
      </button>

      {open && (
        <div
          className="absolute end-0 top-[calc(100%+8px)] z-60 min-w-42 rounded-2xl border border-white/15 bg-[#0b1530] p-1.5 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)]"
          role="menu"
        >
          {selectableLocales.map((value) => (
            <button
              aria-current={value === locale ? "true" : undefined}
              className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-start font-semibold text-[13.5px] transition hover:bg-white/8 ${
                value === locale ? "text-cyan-300" : "text-slate-200"
              }`}
              key={value}
              onClick={() => choose(value)}
              role="menuitem"
              type="button"
            >
              <span>{localeMeta[value].nativeLabel}</span>
              {value === locale && (
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.2"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
