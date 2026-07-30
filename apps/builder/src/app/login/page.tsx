import { redirect } from "next/navigation"

/**
 * `/login` is not the canonical sign-in route — `/auth/sign-in` is. Kept as a
 * redirect for the same reason as `/signup`: the link was publicly live and a
 * dead sign-in link is worse than a duplicate URL. Delete once nothing points
 * here.
 */
export default function LoginPage() {
  redirect("/auth/sign-in")
}
