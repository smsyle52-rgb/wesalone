import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("WhatsApp BSUID migration contract", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../");
  const migration = readFileSync(resolve(root, "lib/db/drizzle/0032_whatsapp_bsuid_identities.sql"), "utf8");
  const bundle = readFileSync(resolve(root, "scripts/migrate-phase345.sql"), "utf8");

  it("adds the scoped contact channel identities table", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS contact_channel_identities");
    expect(migration).toContain("channel_account_id uuid NOT NULL REFERENCES channel_accounts");
    expect(migration).toContain("identity_type text NOT NULL");
    expect(migration).toContain("normalized_identity text NOT NULL");
  });

  it("scopes uniqueness by workspace, channel account, identity type, and identity", () => {
    expect(migration).toContain("uq_contact_channel_identities_scope");
    expect(migration).toContain("workspace_id, channel_account_id, identity_type, normalized_identity");
  });

  it("keeps the canonical production migration bundle in sync", () => {
    expect(bundle).toContain("0032_whatsapp_bsuid_identities");
    expect(bundle).toContain("CREATE TABLE IF NOT EXISTS contact_channel_identities");
    expect(bundle).toContain("uq_contact_channel_identities_scope");
  });
});
