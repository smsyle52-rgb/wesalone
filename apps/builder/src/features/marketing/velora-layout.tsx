import { Geist, Geist_Mono } from "next/font/google"
import { getLocale } from "next-intl/server"
import type { ReactNode } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { VeloraLocaleClient } from "./velora-locale-client"
import "./velora-template.css"

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export async function VeloraLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
    >
      <VeloraLocaleClient
        className={`velora-template ${geistSans.variable} ${geistMono.variable} min-h-full flex flex-col antialiased`}
        locale={locale}
      >
        {children}
      </VeloraLocaleClient>
    </ThemeProvider>
  )
}
