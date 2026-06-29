import type { BusinessProfileUpdateInput } from "../modules/whatsapp-management/whatsapp-business-profile.schema";
import {
  fetchBusinessProfileFromMeta,
  resolveCredentialsSecretRef,
  updateBusinessProfileAtMeta,
  uploadBusinessProfileImageToMeta,
  WhatsAppBusinessProfileError,
  type SafeBusinessProfile,
  type TrustedWhatsAppAccount,
} from "./meta-whatsapp-business-profile";

function accountAccess(account: TrustedWhatsAppAccount): string {
  return resolveCredentialsSecretRef(account.credentialsSecretRef);
}

export async function fetchBusinessProfileForAccount(account: TrustedWhatsAppAccount): Promise<SafeBusinessProfile> {
  return fetchBusinessProfileFromMeta(accountAccess(account), account.trustedPhoneNumberId);
}

export async function updateBusinessProfileForAccount(
  account: TrustedWhatsAppAccount,
  input: BusinessProfileUpdateInput,
): Promise<void> {
  await updateBusinessProfileAtMeta(accountAccess(account), account.trustedPhoneNumberId, input);
}

export async function updateBusinessProfilePhotoForAccount(
  account: TrustedWhatsAppAccount,
  file: { buffer: Buffer; mimeType: string; fileName: string },
): Promise<void> {
  if (!account.trustedMetaAppId) {
    throw new WhatsAppBusinessProfileError(
      409,
      "معرّف تطبيق Meta غير محفوظ لهذا الحساب، لذلك لا يمكن رفع صورة الملف بأمان.",
      "META_APP_ID_MISSING_FOR_PROFILE_UPLOAD",
    );
  }
  const access = accountAccess(account);
  const handle = await uploadBusinessProfileImageToMeta({
    token: access,
    metaAppId: account.trustedMetaAppId,
    buffer: file.buffer,
    mimeType: file.mimeType,
    fileName: file.fileName,
  });
  await updateBusinessProfileAtMeta(access, account.trustedPhoneNumberId, { profile_picture_handle: handle });
}
