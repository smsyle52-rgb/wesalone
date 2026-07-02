-- شغّل هذا على قاعدة الإنتاج قبل دفع دفعة P0 (2 يوليو 2026) — يحتاجه حارس الهجرة الجديد
-- في scripts/migrate-phase345.sql. إن رجعت أي صفوف: عطّل الحساب الخاطئ بـ
--   UPDATE channel_accounts SET status='disabled' WHERE id='<المعرّف الخاطئ>';
-- ثم ادفع. لو تجاهلت هذا الفحص، الهجرة نفسها ستوقف النشر بنفس الرسالة (fail-loud)
-- والإنتاج الحالي يبقى سليماً — لكن تشغيله الآن يوفر عليك جولة نشر فاشلة.

SELECT 'whatsapp' AS channel, ext_id, array_agg(id) AS conflicting_ids, array_agg(workspace_id) AS workspace_ids
FROM (
  SELECT id, workspace_id, COALESCE(provider_config->>'phone_number_id', provider_config->>'phoneNumberId') AS ext_id
  FROM channel_accounts
  WHERE channel_type IN ('whatsapp', 'whatsapp_api') AND status = 'active'
) x
WHERE ext_id IS NOT NULL
GROUP BY ext_id HAVING count(*) > 1

UNION ALL

SELECT 'instagram', provider_config->>'igAccountId', array_agg(id), array_agg(workspace_id)
FROM channel_accounts
WHERE channel_type = 'instagram' AND status = 'active' AND provider_config->>'igAccountId' IS NOT NULL
GROUP BY provider_config->>'igAccountId' HAVING count(*) > 1

UNION ALL

SELECT 'messenger', provider_config->>'pageId', array_agg(id), array_agg(workspace_id)
FROM channel_accounts
WHERE channel_type = 'messenger' AND status = 'active' AND provider_config->>'pageId' IS NOT NULL
GROUP BY provider_config->>'pageId' HAVING count(*) > 1;

-- لا صفوف = لا ازدواج، الدفع آمن مباشرة.
