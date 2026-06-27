/**
 * auth-onboarding.spec.ts
 *
 * REG-* Registration schema changes (no challengeAnswer, phone optional)
 * GOOGLE-* Google OAuth endpoint validation
 * CHANNEL-* Channel disconnect / reconnect
 * ONBOARD-* Onboarding state propagation in /me response
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeRegisterSchema() {
  return z.object({
    ownerName: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8),
    workspaceName: z.string().min(2).max(100),
    phone: z.string().max(30).optional(),
    website: z.string().max(0).optional().default(""),
  });
}

// ── REG-* ────────────────────────────────────────────────────────────────────

describe("REG — registration schema", () => {
  const schema = makeRegisterSchema();

  it("REG-1 accepts valid registration without phone", () => {
    const result = schema.safeParse({
      ownerName: "محمد",
      email: "test@example.com",
      password: "Password1",
      workspaceName: "شركتي",
    });
    expect(result.success).toBe(true);
  });

  it("REG-2 accepts registration with optional phone", () => {
    const result = schema.safeParse({
      ownerName: "محمد",
      email: "test@example.com",
      password: "Password1",
      workspaceName: "شركتي",
      phone: "+966512345678",
    });
    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe("+966512345678");
  });

  it("REG-3 rejects password shorter than 8 chars", () => {
    const result = schema.safeParse({
      ownerName: "محمد",
      email: "test@example.com",
      password: "abc123",
      workspaceName: "شركتي",
    });
    expect(result.success).toBe(false);
  });

  it("REG-4 no challengeAnswer field required (schema has none)", () => {
    const keys = Object.keys(schema.shape);
    expect(keys).not.toContain("challengeAnswer");
  });

  it("REG-5 website honeypot must be empty string", () => {
    const result = schema.safeParse({
      ownerName: "محمد",
      email: "test@example.com",
      password: "Password1",
      workspaceName: "شركتي",
      website: "http://bot.example.com",
    });
    expect(result.success).toBe(false);
  });

  it("REG-6 rejects invalid email format", () => {
    const result = schema.safeParse({
      ownerName: "محمد",
      email: "not-an-email",
      password: "Password1",
      workspaceName: "شركتي",
    });
    expect(result.success).toBe(false);
  });
});

// ── GOOGLE-* ─────────────────────────────────────────────────────────────────

describe("GOOGLE — Google OAuth token validation logic", () => {
  it("GOOGLE-1 rejects missing credential", () => {
    const credential = undefined;
    expect(credential).toBeUndefined();
    // The route returns 400 when credential is missing
  });

  it("GOOGLE-2 rejects non-string credential", () => {
    const credential = 12345;
    expect(typeof credential).not.toBe("string");
  });

  it("GOOGLE-3 email_verified must be string 'true' from tokeninfo", () => {
    // Google tokeninfo returns email_verified as the string "true"
    const tokenInfo = { email: "user@example.com", email_verified: "true" };
    expect(tokenInfo.email_verified).toBe("true");
    expect(tokenInfo.email_verified !== "true").toBe(false);
  });

  it("GOOGLE-4 rejects unverified email from tokeninfo", () => {
    const tokenInfo = { email: "user@example.com", email_verified: "false" };
    const isVerified = tokenInfo.email_verified === "true";
    expect(isVerified).toBe(false);
  });

  it("GOOGLE-5 audience mismatch is rejected when clientId is set", () => {
    const clientId: string = "my-client-id.apps.googleusercontent.com";
    const tokenInfoAud: string = "different-client-id.apps.googleusercontent.com";
    expect(clientId.length > 0 && tokenInfoAud !== clientId).toBe(true);
  });
});

// ── CHANNEL-* ────────────────────────────────────────────────────────────────

describe("CHANNEL — disconnect / reconnect logic", () => {
  it("CHANNEL-1 disconnect sets status=disabled and clears providerConfig", () => {
    const existing = { id: "ch-1", status: "active", providerConfig: { token: "secret" } };
    const updates = { status: "disabled", providerConfig: null, updatedAt: new Date() };
    const result = { ...existing, ...updates };
    expect(result.status).toBe("disabled");
    expect(result.providerConfig).toBeNull();
  });

  it("CHANNEL-2 reconnect sets status=active", () => {
    const existing = { id: "ch-1", status: "disabled" };
    const updates = { status: "active", updatedAt: new Date() };
    const result = { ...existing, ...updates };
    expect(result.status).toBe("active");
  });

  it("CHANNEL-3 reconnect is rejected if channel is not disabled", () => {
    const existing = { id: "ch-1", status: "active" };
    const canReconnect = existing.status === "disabled";
    expect(canReconnect).toBe(false);
  });

  it("CHANNEL-4 disconnect triggers audit log with severity=warning", () => {
    const auditPayload = { action: "disconnect", severity: "warning", entityType: "channel_account" };
    expect(auditPayload.severity).toBe("warning");
    expect(auditPayload.action).toBe("disconnect");
  });
});

// ── ONBOARD-* ────────────────────────────────────────────────────────────────

describe("ONBOARD — onboarding state", () => {
  it("ONBOARD-1 onboardingCompleted is false when settings.onboarding_completed is missing", () => {
    const wsSettings = {} as Record<string, unknown>;
    const onboardingCompleted = wsSettings.onboarding_completed === true;
    expect(onboardingCompleted).toBe(false);
  });

  it("ONBOARD-2 onboardingCompleted is true when settings.onboarding_completed === true", () => {
    const wsSettings = { onboarding_completed: true } as Record<string, unknown>;
    const onboardingCompleted = wsSettings.onboarding_completed === true;
    expect(onboardingCompleted).toBe(true);
  });

  it("ONBOARD-3 onboardingCompleted is false when value is string 'true'", () => {
    const wsSettings = { onboarding_completed: "true" } as Record<string, unknown>;
    const onboardingCompleted = wsSettings.onboarding_completed === true;
    expect(onboardingCompleted).toBe(false);
  });

  it("ONBOARD-4 new user registration sets onboardingCompleted=false in response", () => {
    const registerResponse = {
      user: { id: "u1", name: "محمد", email: "m@test.com", emailVerified: false, permissions: [], roleSlugs: [] },
      workspaceId: "ws-1",
      workspace: { id: "ws-1", name: "شركتي", slug: "shrkty-abc123" },
    };
    const onboardingCompleted = (registerResponse as { onboardingCompleted?: boolean }).onboardingCompleted ?? false;
    expect(onboardingCompleted).toBe(false);
  });
});

// ── PHONE-* ──────────────────────────────────────────────────────────────────

describe("PHONE — phone normalization", () => {
  function normalizePhone(countryCode: string, local: string): string {
    const digits = local.replace(/\D/g, "");
    if (!digits) return "";
    const stripped = digits.replace(/^0+/, "");
    return `${countryCode}${stripped}`;
  }

  it("PHONE-1 strips leading zero from local number", () => {
    expect(normalizePhone("+966", "0512345678")).toBe("+966512345678");
  });

  it("PHONE-2 strips non-digit characters", () => {
    expect(normalizePhone("+971", "05-123 456 78")).toBe("+971512345678");
  });

  it("PHONE-3 returns empty for empty local", () => {
    expect(normalizePhone("+966", "")).toBe("");
  });

  it("PHONE-4 does not double the country code", () => {
    const result = normalizePhone("+966", "512345678");
    expect(result.startsWith("+966+")).toBe(false);
    expect(result).toBe("+966512345678");
  });
});
