import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function patchFile(relativePath, replacements) {
  const filePath = resolve(root, relativePath);
  let content = readFileSync(filePath, "utf8");
  let changed = false;

  for (const { from, to, optional = false } of replacements) {
    if (!content.includes(from)) {
      // Idempotent builds: if the replacement is already present, do not fail on a second run.
      if (content.includes(to) || optional) continue;
      throw new Error(`Patch target not found in ${relativePath}: ${from.slice(0, 120)}`);
    }
    content = content.split(from).join(to);
    changed = true;
  }

  if (changed) {
    writeFileSync(filePath, content);
    console.log(`[patch-meta-embedded-signup] patched ${relativePath}`);
  } else {
    console.log(`[patch-meta-embedded-signup] no changes needed for ${relativePath}`);
  }
}

const frontendFallbackBlock = `        let sessionInfo: EmbeddedSignupSessionInfo = {};
        try {
          sessionInfo = await waitForCapturedSignupInfo(60000);
        } catch (err) {
          console.warn("[WhatsApp Embedded Signup] identifiers did not arrive over postMessage; falling back to backend discovery", err);
        } finally {
          setIsAwaitingMetaData(false);
        }`;

for (const page of [
  "artifacts/web/src/pages/OnboardingPage.tsx",
  "artifacts/web/src/pages/IntegrationsPage.tsx",
]) {
  patchFile(page, [
    {
      from: `        let sessionInfo: EmbeddedSignupSessionInfo;
        try {
          sessionInfo = await waitForCapturedSignupInfo();
        } finally {
          setIsAwaitingMetaData(false);
        }`,
      to: frontendFallbackBlock,
    },
    {
      from: `        && (!message.info?.waba_id || !message.info?.phone_number_id)`,
      to: `        && !message.info?.waba_id`,
      optional: true,
    },
    {
      from: `existing?.waba_id && existing.phone_number_id`,
      to: `existing?.waba_id`,
    },
    {
      from: `current?.waba_id && current.phone_number_id`,
      to: `current?.waba_id`,
    },
    {
      from: `Meta signup did not return WhatsApp account identifiers`,
      to: `Facebook signup did not return WhatsApp identifiers and backend discovery could not run`,
      optional: true,
    },
    {
      from: `لم نستلم بيانات واتساب من نافذة Meta بعد. تأكد أنك أكملت كل خطوات الربط داخل نافذة Meta (اختيار الحساب، رقم الهاتف، والتحقق منه) ثم أعد المحاولة.`,
      to: `لم نستلم بيانات واتساب من نافذة فيسبوك بعد، سنحاول إكمال الربط من الخلفية إن وصل كود التسجيل.`,
      optional: true,
    },
  ]);
}

patchFile("artifacts/api-server/src/modules/integrations/integrations.routes.ts", [
  {
    from: `  const wabaId = parsed.data.waba_id ?? parsed.data.wabaId ?? "";
  const phoneNumberId = parsed.data.phone_number_id ?? parsed.data.phoneNumberId ?? "";
  if (!wabaId || !phoneNumberId) {
    res.status(400).json({ error: "waba_id and phone_number_id are required", code: "missing_embedded_signup_ids" });
    return;
  }`,
    to: `  let wabaId = parsed.data.waba_id ?? parsed.data.wabaId ?? "";
  let phoneNumberId = parsed.data.phone_number_id ?? parsed.data.phoneNumberId ?? "";`,
  },
  {
    from: `  const displayNumber = parsed.data.display_phone_number ?? parsed.data.displayPhoneNumber ?? "";
  const verifiedName = parsed.data.verified_name ?? parsed.data.verifiedName ?? "";
  const configId = parsed.data.config_id ?? parsed.data.configId ?? "";
  const configKey = parsed.data.config_key ?? parsed.data.configKey ?? "whatsapp_standard";`,
    to: `  let displayNumber = parsed.data.display_phone_number ?? parsed.data.displayPhoneNumber ?? "";
  let verifiedName = parsed.data.verified_name ?? parsed.data.verifiedName ?? "";

  // 8 يوليو 2026: على الجوال قد يعرض فيسبوك صفحة "أغلق علامة التبويب" ولا تعود رسالة
  // WA_EMBEDDED_SIGNUP كاملة للصفحة الأصلية. طالما وصلنا code موثّق من FB.login، نحاول
  // اكتشاف WABA/phone_number_id من Graph بدل إفشال الحفظ بسبب postMessage ناقص.
  if (!wabaId || !phoneNumberId) {
    try {
      const discovered = await fetchMetaChannelOptions(userToken);
      const candidates = discovered.options.whatsapp_accounts.flatMap((account) =>
        account.phone_numbers.map((phone) => ({ account, phone })),
      );
      const matching = wabaId ? candidates.filter(({ account }) => account.waba_id === wabaId) : candidates;
      if (matching.length === 1) {
        const match = matching[0];
        if (!wabaId) wabaId = match.account.waba_id;
        if (!phoneNumberId) phoneNumberId = match.phone.phone_number_id;
        if (!displayNumber) displayNumber = match.phone.display_number;
        if (!verifiedName) verifiedName = match.phone.verified_name ?? "";
        req.log?.info({ wabaId, phoneNumberId }, "Completed WhatsApp embedded signup identifiers via Graph discovery");
      } else {
        req.log?.warn({ wabaIdPresent: Boolean(wabaId), candidates: matching.length }, "Could not uniquely discover WhatsApp embedded signup identifiers");
      }
    } catch (err) {
      req.log?.warn({ err, wabaIdPresent: Boolean(wabaId), phoneNumberIdPresent: Boolean(phoneNumberId) }, "WhatsApp embedded signup identifier discovery failed");
    }
  }

  if (!wabaId || !phoneNumberId) {
    res.status(409).json({
      error: "اكتمل تسجيل فيسبوك لكن لم نستطع تحديد رقم واتساب تلقائياً. إن ظهر لك خيار إغلاق التبويب، ارجع لوصال ون وحاول مرة أخرى من Chrome أو تواصل معنا لإكمال الربط.",
      code: "embedded_signup_identifier_discovery_failed",
      wabaIdPresent: Boolean(wabaId),
      phoneNumberIdPresent: Boolean(phoneNumberId),
    });
    return;
  }

  const configId = parsed.data.config_id ?? parsed.data.configId ?? "";
  const configKey = parsed.data.config_key ?? parsed.data.configKey ?? "whatsapp_standard";`,
  },
]);
