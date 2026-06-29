import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { ChannelAccount } from "@workspace/db";
import { assertTrustedWhatsAppAccount, mergeBusinessProfileSnapshot, WhatsAppBusinessProfileError } from "../services/meta-whatsapp-business-profile";
import { assertManageableWhatsAppAccountStatus } from "../modules/whatsapp-management/whatsapp-business-profile-status";

function account(status = "active"): ChannelAccount {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000010",
    channelType: "whatsapp",
    name: "whatsapp-123",
    displayName: "WhatsApp test",
    status,
    providerConfig: { provider: "meta", waba_id: "waba-1", phone_number_id: "phone-1", meta_app_id: "app-1" },
  } as ChannelAccount;
}

describe("WhatsApp Business Profile hardening", () => {
  it("allows only the active channel status", () => {
    const trusted = assertTrustedWhatsAppAccount(account("active"), account().workspaceId);
    expect(() => assertManageableWhatsAppAccountStatus(trusted.status)).not.toThrow();
  });

  it.each(["disabled", "disconnected", "archived", "pending_meta_review", "coming_soon", "unknown"])(
    "rejects inactive channel status %s before a Meta operation",
    (status) => {
      const trusted = assertTrustedWhatsAppAccount(account(status), account().workspaceId);
      try {
        assertManageableWhatsAppAccountStatus(trusted.status);
        expect.fail("expected inactive account rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(WhatsAppBusinessProfileError);
        expect((error as WhatsAppBusinessProfileError).code).toBe("WHATSAPP_ACCOUNT_INACTIVE");
      }
    },
  );

  it("preserves fields added after the initial account read when merging the latest providerConfig", () => {
    const latestProviderConfig = {
      ...(account().providerConfig as Record<string, unknown>),
      concurrentSetting: { enabled: true },
      whatsappManagement: { connectionHealth: { status: "healthy" } },
    };
    const saved = mergeBusinessProfileSnapshot(latestProviderConfig, {
      profile: { about: "آخر لقطة" },
      syncedAt: "2026-06-27T10:00:00.000Z",
      lastError: null,
    });
    expect((saved.concurrentSetting as { enabled: boolean }).enabled).toBe(true);
    expect((saved.whatsappManagement as any).connectionHealth.status).toBe("healthy");
    expect((saved.whatsappManagement as any).businessProfile.profile.about).toBe("آخر لقطة");
  });

  it("mounts the router after apiLimiter and requireVerifiedEmail, with no direct app mount", () => {
    const routesSource = readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8");
    const appSource = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    const limiterIndex = routesSource.indexOf("router.use(apiLimiter)");
    const verifiedIndex = routesSource.indexOf("router.use(requireVerifiedEmail)");
    const profileIndex = routesSource.indexOf('router.use("/whatsapp-management", whatsappBusinessProfileRouter)');
    expect(limiterIndex).toBeGreaterThanOrEqual(0);
    expect(verifiedIndex).toBeGreaterThan(limiterIndex);
    expect(profileIndex).toBeGreaterThan(verifiedIndex);
    expect(appSource).not.toContain('app.use("/api/whatsapp-management"');
  });

  it("locks and rereads the latest providerConfig before saving", () => {
    const source = readFileSync(new URL("../modules/whatsapp-management/whatsapp-business-profile.service.ts", import.meta.url), "utf8");
    expect(source).toContain("db.transaction");
    expect(source).toContain('.for("update")');
    expect(source).toContain("mergeBusinessProfileSnapshot(trustedLatest.providerConfig, update)");
    expect(source).not.toContain("mergeBusinessProfileSnapshot(account.providerConfig, update)");
  });
});

const postgresIt = process.env.DATABASE_URL ? it : it.skip;

postgresIt("preserves a real concurrent providerConfig update in PostgreSQL", async () => {
  const { db, channelAccountsTable, workspacesTable } = await import("@workspace/db");
  const { persistBusinessProfileStateAtomic } = await import("../modules/whatsapp-management/whatsapp-business-profile.service");
  const workspaceId = randomUUID();
  const channelAccountId = randomUUID();
  await db.insert(workspacesTable).values({ id: workspaceId, name: "Profile concurrency test", slug: `profile-${randomUUID()}` });
  try {
    const [initial] = await db.insert(channelAccountsTable).values({
      id: channelAccountId,
      workspaceId,
      channelType: "whatsapp",
      name: "test",
      displayName: "test",
      status: "active",
      providerConfig: { provider: "meta", waba_id: "w", phone_number_id: "p", meta_app_id: "a", existingChannelSetting: true },
    }).returning();
    const stale = assertTrustedWhatsAppAccount(initial, workspaceId);
    await db.update(channelAccountsTable).set({
      providerConfig: { ...(initial.providerConfig as Record<string, unknown>), concurrentSetting: { enabled: true } },
    }).where(eq(channelAccountsTable.id, channelAccountId));
    await persistBusinessProfileStateAtomic(stale, { profile: { about: "لقطة ذرية" }, syncedAt: new Date().toISOString(), lastError: null });
    const [saved] = await db.select().from(channelAccountsTable).where(eq(channelAccountsTable.id, channelAccountId)).limit(1);
    const config = saved.providerConfig as any;
    expect(config.concurrentSetting.enabled).toBe(true);
    expect(config.existingChannelSetting).toBe(true);
    expect(config.whatsappManagement.businessProfile.profile.about).toBe("لقطة ذرية");
  } finally {
    await db.delete(workspacesTable).where(eq(workspacesTable.id, workspaceId));
  }
});
