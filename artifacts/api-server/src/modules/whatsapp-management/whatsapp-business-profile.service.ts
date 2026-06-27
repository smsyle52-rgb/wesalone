import { and, eq } from "drizzle-orm";
import { channelAccountsTable, db } from "@workspace/db";
import type { BusinessProfileUpdateInput } from "./whatsapp-business-profile.schema";
import {
  assertTrustedWhatsAppAccount,
  attachLastSnapshot,
  mergeBusinessProfileSnapshot,
  readBusinessProfileSnapshot,
  safeBusinessProfileFailure,
  type SafeBusinessProfile,
  type TrustedWhatsAppAccount,
} from "../../services/meta-whatsapp-business-profile";
import {
  fetchBusinessProfileForAccount,
  updateBusinessProfileForAccount,
  updateBusinessProfilePhotoForAccount,
} from "../../services/meta-whatsapp-business-profile-account";

async function findAccount(workspaceId: string, channelAccountId: string): Promise<TrustedWhatsAppAccount> {
  const [account] = await db
    .select()
    .from(channelAccountsTable)
    .where(and(
      eq(channelAccountsTable.id, channelAccountId),
      eq(channelAccountsTable.workspaceId, workspaceId),
    ))
    .limit(1);
  return assertTrustedWhatsAppAccount(account, workspaceId);
}

async function persistProfileState(
  account: TrustedWhatsAppAccount,
  update: { profile?: SafeBusinessProfile; syncedAt?: string; lastError?: ReturnType<typeof safeBusinessProfileFailure> | null },
): Promise<void> {
  const providerConfig = mergeBusinessProfileSnapshot(account.providerConfig, update);
  await db
    .update(channelAccountsTable)
    .set({ providerConfig, updatedAt: new Date() })
    .where(and(
      eq(channelAccountsTable.id, account.id),
      eq(channelAccountsTable.workspaceId, account.workspaceId),
    ));
  account.providerConfig = providerConfig;
}

async function runProfileOperation<T>(
  account: TrustedWhatsAppAccount,
  operation: () => Promise<T>,
): Promise<T> {
  const previousSnapshot = readBusinessProfileSnapshot(account.providerConfig);
  try {
    return await operation();
  } catch (error) {
    try {
      await persistProfileState(account, { lastError: safeBusinessProfileFailure(error) });
    } catch {
      // Do not replace the original Meta/credential error with a local snapshot-write failure.
    }
    throw attachLastSnapshot(error, previousSnapshot);
  }
}

async function fetchAndPersist(account: TrustedWhatsAppAccount) {
  const profile = await fetchBusinessProfileForAccount(account);
  const syncedAt = new Date().toISOString();
  await persistProfileState(account, { profile, syncedAt, lastError: null });
  return { profile, syncedAt };
}

export async function syncBusinessProfile(workspaceId: string, channelAccountId: string) {
  const account = await findAccount(workspaceId, channelAccountId);
  return runProfileOperation(account, async () => {
    const synced = await fetchAndPersist(account);
    return { account, ...synced };
  });
}

export async function updateBusinessProfile(
  workspaceId: string,
  channelAccountId: string,
  input: BusinessProfileUpdateInput,
) {
  const account = await findAccount(workspaceId, channelAccountId);
  return runProfileOperation(account, async () => {
    await updateBusinessProfileForAccount(account, input);
    const synced = await fetchAndPersist(account);
    return { account, ...synced };
  });
}

export async function updateBusinessProfilePhoto(
  workspaceId: string,
  channelAccountId: string,
  file: { buffer: Buffer; mimeType: string; fileName: string },
) {
  const account = await findAccount(workspaceId, channelAccountId);
  return runProfileOperation(account, async () => {
    await updateBusinessProfilePhotoForAccount(account, file);
    const synced = await fetchAndPersist(account);
    return { account, ...synced };
  });
}

export async function getStoredBusinessProfileSnapshot(workspaceId: string, channelAccountId: string) {
  const account = await findAccount(workspaceId, channelAccountId);
  return { account, snapshot: readBusinessProfileSnapshot(account.providerConfig) };
}
