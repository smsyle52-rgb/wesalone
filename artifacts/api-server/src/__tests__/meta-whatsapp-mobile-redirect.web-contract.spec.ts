import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const onboardingSource = readFileSync(resolve(repoRoot, "artifacts/web/src/pages/OnboardingPage.tsx"), "utf8");
const integrationsSource = readFileSync(resolve(repoRoot, "artifacts/web/src/pages/IntegrationsPage.tsx"), "utf8");

describe("Meta mobile redirect web regression contract", () => {
  it("keeps the desktop FB.login popup implementation in both pages", () => {
    expect(onboardingSource).toContain("window.FB.login((response) => {");
    expect(integrationsSource).toContain("window.FB.login((response) => {");
    expect(onboardingSource).toContain("config_id: configId");
    expect(integrationsSource).toContain("config_id: configId");
  });

  it("uses the flagged redirect only for WhatsApp on mobile", () => {
    for (const source of [onboardingSource, integrationsSource]) {
      expect(source).toContain("isWhatsAppSignupOption");
      expect(source).toContain("config.mobileRedirectEnabled && isMobileMetaRedirectViewport()");
      expect(source).toContain("embedded-signup/whatsapp/redirect/start");
      expect(source).toContain('window.matchMedia("(max-width: 767px)").matches');
    }
  });

  it("does not process or poll mobile results until the server flag is enabled", () => {
    expect(onboardingSource).toContain("metaConfigQuery.data?.mobileRedirectEnabled !== true");
    expect(integrationsSource).toContain("metaSignupConfig?.mobileRedirectEnabled !== true");
  });

  it("keeps Instagram and Messenger on their existing completion path", () => {
    expect(onboardingSource).toContain("embedded-signup/instagram-messenger/complete");
    expect(integrationsSource).toContain("embedded-signup/instagram-messenger/complete");
  });

  it("preserves the existing Integrations fallback button until live verification", () => {
    expect(integrationsSource).toContain("startRedirectSignup");
    expect(integrationsSource).toContain("الطريقة البديلة (مناسبة للجوال)");
  });
});
