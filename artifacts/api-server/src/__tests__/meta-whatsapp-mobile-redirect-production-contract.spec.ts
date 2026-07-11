import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const routes = readFileSync(resolve(root, "artifacts/api-server/src/modules/integrations/integrations.routes.ts"), "utf8");
const app = readFileSync(resolve(root, "artifacts/api-server/src/app.ts"), "utf8");
const migration = readFileSync(resolve(root, "lib/db/drizzle/0039_meta_mobile_signup_attempts.sql"), "utf8");
const bundle = readFileSync(resolve(root, "scripts/migrate-phase345.sql"), "utf8");

describe("Meta mobile signup production completion contract", () => {
  it("ships the resumable attempt schema in both migration paths", () => {
    for (const sql of [migration, bundle]) {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS meta_mobile_signup_attempts");
      expect(sql).toContain("lease_expires_at");
      expect(sql).toContain("encrypted_token_ref");
      expect(sql).toContain("last_error_code");
      expect(sql).toContain("result_ready");
    }
  });

  it("finalizes channel, agent, flags, onboarding and attempt in one transaction", () => {
    const start = routes.indexOf("async function finalizeMobileWhatsAppConnection");
    const end = routes.indexOf("function serializeChannelAccount", start);
    const finalize = routes.slice(start, end);
    expect(finalize).toContain("return db.transaction(async (tx) =>");
    expect(finalize).toContain('status: "active"');
    expect(finalize).toContain("externalBusinessId: params.account.waba_id");
    expect(finalize).toContain("externalPhoneId: params.phone.phone_number_id");
    expect(finalize).toContain("credentialsSecretRef: params.tokenRef");
    expect(finalize).toContain("defaultAgentId: agentId");
    expect(finalize).toContain('mode: "auto"');
    expect(finalize).toContain('"whatsapp_api_enabled", "ai_auto_send"');
    expect(finalize).toContain("isEnabled: true");
    expect(finalize).toContain("onboarding_completed: true");
    expect(finalize).toContain('status: "completed"');
    expect(finalize).toContain("resultReady: true");
  });

  it("checkpoints the encrypted customer token and redirects only internally", () => {
    expect(routes).toContain('checkpoint: "token_exchanged", encryptedTokenRef: tokenRef');
    expect(routes).toContain("resolveCredentialsSecretRef(claim.encryptedTokenRef)");
    expect(routes).toContain('res.redirect("/dashboard?whatsapp_connected=1")');
    expect(routes).not.toContain("res.redirect(mobileStored.returnTo)");
  });

  it("redacts OAuth query strings from request and error logs", () => {
    expect(app).toContain('url: req.url?.split("?")[0]');
    expect(routes).not.toContain("req.log?.warn({ err, signupAttemptId: mobileStored.signupAttemptId }");
  });
});
