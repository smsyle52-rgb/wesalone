import { WesalAuthShell } from "@/features/auth/components/wesal-auth-shell"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <WesalAuthShell>{children}</WesalAuthShell>
}
