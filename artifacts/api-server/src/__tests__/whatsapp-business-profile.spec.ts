import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { ChannelAccount } from "@workspace/db";
import {
  assertTrustedWhatsAppAccount,
  buildBusinessProfileAuditData,
  fetchBusinessProfileFromMeta,
  mergeBusinessProfileSnapshot,
  resolveCredentialsSecretRef,
  sanitizeMetaPayload,
  updateBusinessProfileAtMeta,
  validateProfileImage,
  WhatsAppBusinessProfileError,
} from "../services/meta-whatsapp-business-profile";
import { BUSINESS_PROFILE_IMAGE_MAX_BYTES } from "../modules/whatsapp-management/whatsapp-business-profile.schema";

function account(overrides: Partial<ChannelAccount> = {}): ChannelAccount {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000010",
    channelType: "whatsapp",
    name: "whatsapp-123",
    displayName: "WhatsApp +967700000000",
    status: "active",
    providerConfig: {
      provider: "meta",
      waba_id: "waba-1",
      phone_number_id: "phone-1",
      meta_app_id: "app-1",
      embeddedSignup: true,
      configKey: "whatsapp_standard",
    },
    credentialsSecretRef: null,
    defaultAgentId: null,
    createdBy: null,
    createdAt: new Date("2026-06-27T00:00:00.000Z"),
    updatedAt: new Date("2026-06-27T00:00:00.000Z"),
    externalAccountId: null,
    externalBusinessId: null,
    externalPhoneId: null,
    healthStatus: null,
    lastHealthAt: null,
    ...overrides,
  };
}

function encryptedRef(token: string, material: string): string {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(material).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function response(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("WhatsApp Business Profile security contract", () => {
  const workspaceId = "00000000-0000-4000-8000-000000000010";

  beforeEach(() => {
    process.env.META_GRAPH_VERSION = "v22.0";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.META_SYSTEM_USER_TOKEN;
  });

  it("rejects a channel account from another workspace", () => {
    expect(() => assertTrustedWhatsAppAccount(account({ workspaceId: "other-workspace" }), workspaceId))
      .toThrowError(WhatsAppBusinessProfileError);
    try {
      assertTrustedWhatsAppAccount(account({ workspaceId: "other-workspace" }), workspaceId);
    } catch (error) {
      expect((error as WhatsAppBusinessProfileError).code).toBe("WHATSAPP_ACCOUNT_NOT_FOUND");
    }
  });

  it("rejects a non-WhatsApp or non-Meta provider", () => {
    const invalid = account({ providerConfig: { provider: "custom", waba_id: "w", phone_number_id: "p" } });
    expect(() => assertTrustedWhatsAppAccount(invalid, workspaceId)).toThrowError(/ليس حساب واتساب/);
  });

  it("uses only WABA and phone identifiers stored in the trusted account", () => {
    const trusted = assertTrustedWhatsAppAccount(account(), workspaceId);
    expect(trusted.trustedWabaId).toBe("waba-1");
    expect(trusted.trustedPhoneNumberId).toBe("phone-1");
  });

  it("decrypts the channel-specific encrypted credentials reference", () => {
    const material = "local-test-secret";
    const ref = encryptedRef("channel-token-only", material);
    expect(resolveCredentialsSecretRef(ref, material)).toBe("channel-token-only");
  });

  it("rejects a missing or corrupted credentials reference", () => {
    expect(() => resolveCredentialsSecretRef(null, "secret")).toThrowError(/لا يوجد رمز وصول/);
    expect(() => resolveCredentialsSecretRef("enc:v1:broken", "secret")).toThrowError(/تالفة/);
  });

  it("does not fall back to a generic environment token", () => {
    process.env.META_ACCESS_TOKEN = "must-not-be-used";
    process.env.META_SYSTEM_USER_TOKEN = "must-not-be-used-either";
    expect(() => resolveCredentialsSecretRef(null, "secret")).toThrowError(/لا يوجد رمز وصول/);
  });

  it("reads the real profile response from Meta and only returns supported safe fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      data: [{
        about: "وصال ون",
        description: "خدمة عملاء",
        email: "support@example.com",
        websites: ["https://example.com"],
        vertical: "PROFESSIONAL_SERVICES",
        profile_picture_url: "https://cdn.example.com/profile.jpg",
        access_token: "must-not-leak",
      }],
    }, 200, { "x-fb-request-id": "fb-request-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const profile = await fetchBusinessProfileFromMeta("channel-token", "phone-1");
    expect(profile.about).toBe("وصال ون");
    expect(profile.websites).toEqual(["https://example.com"]);
    expect(profile).not.toHaveProperty("access_token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("phone-1/whatsapp_business_profile");
  });

  it("accepts an update only after Meta returns success=true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(updateBusinessProfileAtMeta("channel-token", "phone-1", { about: "نبذة جديدة" }))
      .resolves.toBeUndefined();
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.method).toBe("POST");
    expect(String(options.body)).toContain('"messaging_product":"whatsapp"');
  });

  it("rejects a Meta failure and never converts it to a local success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      error: { code: 190, message: "Invalid OAuth access token", access_token: "secret" },
    }, 401)));
    await expect(updateBusinessProfileAtMeta("channel-token", "phone-1", { about: "نبذة" }))
      .rejects.toMatchObject({ code: "META_BUSINESS_PROFILE_ERROR" });
  });

  it("rejects an unconfirmed HTTP 200 Meta update", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ success: false })));
    await expect(updateBusinessProfileAtMeta("channel-token", "phone-1", { about: "نبذة" }))
      .rejects.toMatchObject({ code: "META_BUSINESS_PROFILE_UNCONFIRMED" });
  });

  it("rejects unsupported MIME types and mismatched image content", () => {
    expect(() => validateProfileImage(Buffer.from("hello"), "image/gif")).toThrowError(/JPEG أو PNG/);
    expect(() => validateProfileImage(Buffer.from("not-a-jpeg"), "image/jpeg")).toThrowError(/لا يطابق/);
  });

  it("rejects empty and oversized images", () => {
    expect(() => validateProfileImage(Buffer.alloc(0), "image/png")).toThrowError(/فارغ/);
    expect(() => validateProfileImage(Buffer.alloc(BUSINESS_PROFILE_IMAGE_MAX_BYTES + 1), "image/png"))
      .toThrowError(/يتجاوز/);
  });

  it("preserves all existing providerConfig keys while namespacing the safe snapshot", () => {
    const original = {
      provider: "meta",
      waba_id: "waba-1",
      phone_number_id: "phone-1",
      embeddedSignup: true,
      configId: "config-1",
      whatsappManagement: { anotherFeature: { enabled: true } },
    };
    const merged = mergeBusinessProfileSnapshot(original, {
      profile: { about: "آخر قيمة" },
      syncedAt: "2026-06-27T01:00:00.000Z",
      lastError: null,
    });
    expect(merged.provider).toBe("meta");
    expect(merged.embeddedSignup).toBe(true);
    expect(merged.configId).toBe("config-1");
    expect((merged.whatsappManagement as any).anotherFeature.enabled).toBe(true);
    expect((merged.whatsappManagement as any).businessProfile.profile.about).toBe("آخر قيمة");
  });

  it("removes secrets from safe Meta data, audit data, and nested payloads", () => {
    const sanitized = sanitizeMetaPayload({
      access_token: "secret-token",
      nested: { Authorization: "Bearer secret", message: "safe" },
      client_secret: "secret",
    }) as any;
    expect(sanitized.access_token).toBeUndefined();
    expect(sanitized.nested.Authorization).toBeUndefined();
    expect(sanitized.nested.message).toBe("safe");

    const audit = buildBusinessProfileAuditData({
      correlationId: "11111111-1111-4111-8111-111111111111",
      operation: "update",
      status: "failed",
      error: new WhatsAppBusinessProfileError(502, "خطأ آمن", "META_ERROR", {
        code: 190,
        message: "safe message",
      }),
    });
    expect(JSON.stringify(audit)).not.toContain("token");
    expect(JSON.stringify(audit)).not.toContain("Authorization");
  });

  it("keeps the server-generated correlationId in safe audit data", () => {
    const correlationId = "22222222-2222-4222-8222-222222222222";
    const audit = buildBusinessProfileAuditData({
      correlationId,
      operation: "sync",
      status: "success",
    });
    expect(audit.correlationId).toBe(correlationId);
  });
});
