// One-off: register the platform-wide WhatsApp Meta App credential using the
// REAL app's own encryption service (platformCredentialService.upsertPlatform),
// not a hand-rolled insert — so it decrypts correctly for real embedded-signup
// use. Run once, then delete. Values come from the OLD system's live Meta App
// config (same App ID: khadamatak-staging Cloud Run env) + the business/system
// user info confirmed directly by the owner in Meta Business Manager.
import { platformCredentialService } from "../../../business/src/platform-credential/service"

const required = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required`)
  return v
}

const main = async () => {
  await platformCredentialService.upsertPlatform({
    type: "whatsapp",
    // Runtime credential lookups use the service default (livemode=false).
    // Keep this aligned so webhook and embedded-signup flows can resolve it.
    livemode: false,
    config: {
      clientId: "1437258534807702",
      version: "v22.0",
      configId: "845347748296104",
      systemUserId: "61562920885769",
      businessId: "3574426986044217",
      businessName: "Wesal One",
      verifyToken: required("META_WEBHOOK_VERIFY_TOKEN"),
      clientSecret: required("META_APP_SECRET"),
      systemUserToken: required("META_SYSTEM_USER_TOKEN"),
    },
  })
  console.log("WhatsApp platform credential saved (encrypted).")
}

main().catch((err) => {
  console.error("Failed:", err)
  process.exitCode = 1
})
