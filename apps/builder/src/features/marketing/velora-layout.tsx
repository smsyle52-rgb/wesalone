import { Geist, Geist_Mono } from "next/font/google"
import type { ReactNode } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import "./velora-template.css"

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export function VeloraLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      disableTransitionOnChange
    >
      <div
        className={`velora-template ${geistSans.variable} ${geistMono.variable} min-h-full flex flex-col antialiased`}
        dir="ltr"
      >
        {children}
      </div>
    </ThemeProvider>
  )
}
