import { WhatsAppBusinessProfileError } from "../../services/meta-whatsapp-business-profile";

const MANAGEABLE_CHANNEL_STATUSES = new Set(["active"]);

export function assertManageableWhatsAppAccountStatus(status: string): void {
  if (!MANAGEABLE_CHANNEL_STATUSES.has(status)) {
    throw new WhatsAppBusinessProfileError(
      409,
      "حساب واتساب غير نشط أو غير متصل، ولا يمكن إدارة ملفه التجاري حاليًا.",
      "WHATSAPP_ACCOUNT_INACTIVE",
    );
  }
}
