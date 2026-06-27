import { and, eq } from "drizzle-orm";
import { channelAccountsTable, db } from "@workspace/db";
import type { BusinessProfileUpdateInput } from "./whatsapp-business-profile.schema";
import { assertTrustedWhatsAppAccount, attachLastSnapshot, mergeBusinessProfileSnapshot, readBusinessProfileSnapshot, safeBusinessProfileFailure, type SafeBusinessProfile, type TrustedWhatsAppAccount } from "../../services/meta-whatsapp-business-profile";
import { fetchBusinessProfileForAccount, updateBusinessProfileForAccount, updateBusinessProfilePhotoForAccount } from "../../services/meta-whatsapp-business-profile-account";
import { assertManageableWhatsAppAccountStatus } from "./whatsapp-business-profile-status";

export type BusinessProfileStatePatch = { profile?: SafeBusinessProfile; syncedAt?: string; lastError?: ReturnType<typeof safeBusinessProfileFailure> | null };

async function findAccount(workspaceId: string, channelAccountId: string): Promise<TrustedWhatsAppAccount> {
  const [account] = await db.select().from(channelAccountsTable).where(and(eq(channelAccountsTable.id, channelAccountId), eq(channelAccountsTable.workspaceId, workspaceId))).limit(1);
  const trusted = assertTrustedWhatsAppAccount(account, workspaceId);
  assertManageableWhatsAppAccountStatus(trusted.status);
  return trusted;
}

export async function persistBusinessProfileStateAtomic(account: TrustedWhatsAppAccount, update: BusinessProfileStatePatch): Promise<void> {
  const savedProviderConfig = await db.transaction(async (tx) => {
    const [latest] = await tx.select().from(channelAccountsTable).where(and(eq(channelAccountsTable.id, account.id), eq(channelAccountsTable.workspaceId, account.workspaceId))).limit(1).for("update");
    const trustedLatest = assertTrustedWhatsAppAccount(latest, account.workspaceId);
    assertManageableWhatsAppAccountStatus(trustedLatest.status);
    const providerConfig = mergeBusinessProfileSnapshot(trustedLatest.providerConfig, update);
    const [saved] = await tx.update(channelAccountsTable).set({ providerConfig, updatedAt: new Date() }).where(and(eq(channelAccountsTable.id, account.id), eq(channelAccountsTable.workspaceId, account.workspaceId))).returning({ providerConfig: channelAccountsTable.providerConfig });
    if (!saved) throw new Error("channel account disappeared during profile persistence");
    return saved.providerConfig;
  });
  account.providerConfig = savedProviderConfig && typeof savedProviderConfig === "object" ? savedProviderConfig as Record<string, unknown> : {};
}

async function runProfileOperation<T>(account: TrustedWhatsAppAccount, operation: () => Promise<T>): Promise<T> {
  const previousSnapshot = readBusinessProfileSnapshot(account.providerConfig);
  try { return await operation(); } catch (error) {
    try { await persistBusinessProfileStateAtomic(account, { lastError: safeBusinessProfileFailure(error) }); } catch {}
    throw attachLastSnapshot(error, previousSnapshot);
  }
}

async function fetchAndPersist(account: TrustedWhatsAppAccount) {
  const profile = await fetchBusinessProfileForAccount(account);
  const syncedAt = new Date().toISOString();
  await persistBusinessProfileStateAtomic(account, { profile, syncedAt, lastError: null });
  return { profile, syncedAt };
}

export async function syncBusinessProfile(workspaceId: string, channelAccountId: string) {
  const account = await findAccount(workspaceId, channelAccountId);
  return runProfileOperation(account, async () => ({ account, ...(await fetchAndPersist(account)) }));
}

export async function updateBusinessProfile(workspaceId: string, channelAccountId: string, input: BusinessProfileUpdateInput) {
  const account = await findAccount(workspaceId, channelAccountId);
  return runProfileOperation(account, async () => { await updateBusinessProfileForAccount(account, input); return { account, ...(await fetchAndPersist(account)) }; });
}

export async function updateBusinessProfilePhoto(workspaceId: string, channelAccountId: string, file: { buffer: Buffer; mimeType: string; fileName: string }) {
  const account = await findAccount(workspaceId, channelAccountId);
  return runProfileOperation(account, async () => { await updateBusinessProfilePhotoForAccount(account, file); return { account, ...(await fetchAndPersist(account)) }; });
}

export async function getStoredBusinessProfileSnapshot(workspaceId: string, channelAccountId: string) {
  const account = await findAccount(workspaceId, channelAccountId);
  return { account, snapshot: readBusinessProfileSnapshot(account.providerConfig) };
}
