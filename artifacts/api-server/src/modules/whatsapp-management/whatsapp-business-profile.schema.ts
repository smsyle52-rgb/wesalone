import { z } from "zod";

export const BUSINESS_PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const BUSINESS_PROFILE_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;

export const META_BUSINESS_VERTICALS = [
  "",
  "AUTOMOTIVE",
  "BEAUTY_SPA_AND_SALON",
  "CLOTHING_AND_APPAREL",
  "EDUCATION",
  "ENTERTAINMENT",
  "EVENT_PLANNING_AND_SERVICE",
  "FINANCE_AND_BANKING",
  "FOOD_AND_GROCERY",
  "HOTEL_AND_LODGING",
  "MEDICAL_AND_HEALTH",
  "NON_PROFIT",
  "OTHER",
  "PROFESSIONAL_SERVICES",
  "PUBLIC_SERVICE",
  "RESTAURANT",
  "SHOPPING_AND_RETAIL",
  "TRAVEL_AND_TRANSPORTATION",
] as const;

const optionalTrimmedText = (max: number, message: string) =>
  z.string().trim().max(max, message).optional();

const websiteSchema = z
  .string()
  .trim()
  .max(256, "رابط الموقع يجب ألا يتجاوز 256 حرفًا")
  .url("رابط الموقع غير صالح")
  .refine((value: string) => value.startsWith("https://") || value.startsWith("http://"), {
    message: "رابط الموقع يجب أن يبدأ بـ http:// أو https://",
  });

export const businessProfileUpdateSchema = z
  .object({
    about: z
      .string()
      .trim()
      .min(1, "نبذة النشاط لا يمكن أن تكون فارغة")
      .max(139, "نبذة النشاط يجب ألا تتجاوز 139 حرفًا")
      .optional(),
    address: optionalTrimmedText(256, "العنوان يجب ألا يتجاوز 256 حرفًا"),
    description: optionalTrimmedText(512, "الوصف يجب ألا يتجاوز 512 حرفًا"),
    email: z
      .union([
        z.literal(""),
        z.string().trim().email("البريد الإلكتروني غير صالح").max(128, "البريد الإلكتروني يجب ألا يتجاوز 128 حرفًا"),
      ])
      .optional(),
    websites: z.array(websiteSchema).max(2, "يمكن إضافة موقعين فقط").optional(),
    vertical: z.enum(META_BUSINESS_VERTICALS).optional(),
  })
  .strict("تم إرسال حقل غير مدعوم من Meta")
  .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, {
    message: "أرسل حقلًا واحدًا على الأقل للتحديث",
  });

export type BusinessProfileUpdateInput = z.infer<typeof businessProfileUpdateSchema>;
