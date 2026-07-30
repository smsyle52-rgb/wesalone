import { redirect } from "next/navigation"

/**
 * `/signup` is not the canonical sign-up route — `/auth/sign-up` is. It is kept
 * as a redirect because the marketing template that introduced it was live long
 * enough for the link to reach customers, and a 404 on a sign-up link costs a
 * signup. Delete once nothing points here.
 */
export default function SignupPage() {
  redirect("/auth/sign-up")
}
