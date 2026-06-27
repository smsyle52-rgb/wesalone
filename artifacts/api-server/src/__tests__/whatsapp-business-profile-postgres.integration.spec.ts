import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { ChannelAccount } from "@workspace/db";
import { assertTrustedWhatsAppAccount } from "../services/meta-whatsapp-business-profile";

type ClosablePool = {
  end: () => Promise<void>;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

let databasePool: ClosablePool | undefined;

afterAll(async () => {
  await databasePool?.end();
});

describe("WhatsApp Business Profile PostgreSQL integration", () => {
  it("preserves a real concurrent providerConfig update in PostgreSQL", async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for the WhatsApp Business Profile PostgreSQL integration test");
    }

    const { pool } = await import("@workspace/db");
    const { persistBusinessProfileStateAtomic } = await import(
      "../modules/whatsapp-management/whatsapp-business-profile.service"
    );
    databasePool = pool;

    await pool.query(`
      alter table channel_accounts
        add column if not exists credentials_secret_ref text,
        add column if not exists default_agent_id uuid,
        add column if not exists created_by uuid,
        add column if not exists external_account_id text,
        add column if not exists external_business_id text,
        add column if not exists external_phone_id text,
        add column if not exists health_status text,
        add column if not exists last_health_at timestamptz
    `);

    const workspaceId = randomUUID();
    const channelAccountId = randomUUID();
    const channelName = `test-${randomUUID()}`;
    const initialProviderConfig: Record<string, unknown> = {
      provider: "meta",
      waba_id: "waba-integration",
      phone_number_id: "phone-integration",
      meta_app_id: "app-integration",
      existingChannelSetting: true,
    };

    try {
      await pool.query(
        `insert into workspaces (id, name, slug, plan, status, settings)
         values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [workspaceId, "Profile concurrency test", `profile-${randomUUID()}`, "trial", "active", "{}"],
      );

      await pool.query(
        `insert into channel_accounts
          (id, workspace_id, channel_type, name, display_name, status, provider_config)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          channelAccountId,
          workspaceId,
          "whatsapp",
          channelName,
          "WhatsApp PostgreSQL integration test",
          "active",
          JSON.stringify(initialProviderConfig),
        ],
      );

      const staleAccount: ChannelAccount = {
        id: channelAccountId,
        workspaceId,
        channelType: "whatsapp",
        name: channelName,
        displayName: "WhatsApp PostgreSQL integration test",
        status: "active",
        providerConfig: initialProviderConfig,
        credentialsSecretRef: null,
        defaultAgentId: null,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        externalAccountId: null,
        externalBusinessId: null,
        externalPhoneId: null,
        healthStatus: null,
        lastHealthAt: null,
      };
      const stale = assertTrustedWhatsAppAccount(staleAccount, workspaceId);

      await pool.query(
        `update channel_accounts
         set provider_config = $1::jsonb
         where id = $2`,
        [
          JSON.stringify({
            ...initialProviderConfig,
            concurrentSetting: { enabled: true },
          }),
          channelAccountId,
        ],
      );

      await persistBusinessProfileStateAtomic(stale, {
        profile: { about: "لقطة ذرية" },
        syncedAt: new Date().toISOString(),
        lastError: null,
      });

      const savedResult = await pool.query<{ provider_config: unknown }>(
        `select provider_config
         from channel_accounts
         where id = $1
         limit 1`,
        [channelAccountId],
      );
      const saved = savedResult.rows[0];
      if (!saved) {
        throw new Error("The WhatsApp channel account disappeared during the PostgreSQL integration test");
      }

      const config = asRecord(saved.provider_config, "saved providerConfig");
      const concurrentSetting = asRecord(config.concurrentSetting, "concurrentSetting");
      const whatsappManagement = asRecord(config.whatsappManagement, "whatsappManagement");
      const businessProfile = asRecord(whatsappManagement.businessProfile, "businessProfile");
      const profile = asRecord(businessProfile.profile, "businessProfile.profile");

      expect(config.existingChannelSetting).toBe(true);
      expect(concurrentSetting.enabled).toBe(true);
      expect(profile.about).toBe("لقطة ذرية");
    } finally {
      try {
        await pool.query("delete from channel_accounts where id = $1", [channelAccountId]);
      } finally {
        await pool.query("delete from workspaces where id = $1", [workspaceId]);
      }
    }
  });
});
