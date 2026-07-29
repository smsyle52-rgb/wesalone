"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"
import {
  ARABIC_TRANSLATIONS,
  normalizeVeloraText,
} from "./velora-translations"

const arabic = new Map(
  ARABIC_TRANSLATIONS.map(([english, translation]) => [
    normalizeVeloraText(english),
    translation,
  ]),
)

function translateTextNode(node: Text): void {
  const value = node.nodeValue
  if (!value) return
  const normalized = normalizeVeloraText(value)
  const translation = arabic.get(normalized)
  if (!translation) return
  const leading = value.match(/^\s*/)?.[0] ?? ""
  const trailing = value.match(/\s*$/)?.[0] ?? ""
  node.nodeValue = `${leading}${translation}${trailing}`
}

function translateTree(root: HTMLElement): void {
  for (const element of [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>("*")),
  ]) {
    for (const attribute of ["aria-label", "placeholder", "title"]) {
      const value = element.getAttribute(attribute)
      if (!value) continue
      const translation = arabic.get(normalizeVeloraText(value))
      if (translation) element.setAttribute(attribute, translation)
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    translateTextNode(node as Text)
    node = walker.nextNode()
  }
}

export function VeloraLocaleClient({
  children,
  className,
  locale,
}: {
  children: ReactNode
  className: string
  locale: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || locale !== "ar") return
    translateTree(root)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          translateTextNode(mutation.target as Text)
          continue
        }
        for (const addedNode of Array.from(mutation.addedNodes)) {
          if (addedNode.nodeType === Node.TEXT_NODE) {
            translateTextNode(addedNode as Text)
          } else if (addedNode instanceof HTMLElement) {
            translateTree(addedNode)
          }
        }
      }
    })
    observer.observe(root, {
      characterData: true,
      childList: true,
      subtree: true,
    })
    return () => observer.disconnect()
  }, [locale])

  return (
    <div
      className={className}
      data-velora-locale={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      ref={rootRef}
    >
      {children}
    </div>
  )
}
