import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "وصال ون | Wesal One",
  description: "منصة موحدة لإدارة محادثات العملاء عبر واتساب، إنستغرام، ماسنجر، تيليجرام والمكالمات.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
