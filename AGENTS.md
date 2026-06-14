# Wesal One — قواعد العمل الدائمة
المستودع: smsyle52-rgb/khadamatak (main). النشر تلقائي عند push على main. commit/push بيد المالك فقط.

## اقرأ أولاً
الخطط الكاملة في مهارة wesal-one-agents (تُحمّل تلقائياً):
- مراحل 1–7  → references/agents-master-plan.md
- مراحل A–H → references/strategic-master-plan.md
الحالة الحيّة: WESAL_ONE_CHAT_HANDOFF.md في جذر المشروع.

## الحالة الحالية
المرحلة 1 مغلقة ✅. الـ worker يعمل ويـpoll. كل push ينشر api-server + worker تلقائياً.
المرحلة التالية النشطة: المرحلة 2 — أدوات المهمات (function calling).

## محميات لا تُكسر
1. الوارد واستقبال برايد لا ينقطع.
2. SSE /api/inbox/stream network-only؛ الـSW لا يلمس /api/*.
3. توقيع webhook HMAC SHA-256 لا يُضعَّف.
4. تخطيط سطح المكتب lg+ لا يُمس.
5. عزل workspace في كل استعلام.
6. لا ربط/فصل قنوات دون طلب صريح.
7. أسرار/توكنات: Secret Manager/env فقط.
8. تطبيق Wesal One (1437258534807702) قيد المراجعة لا يُلمس إلا بطلب صريح.
9. staging صريح — لا git add -A؛ commit/push بيد المالك.

## منهجية
مرحلة واحدة نشطة (+ميتا بالتوازي). ابدأ بفحص read-only. بعد كل تعديل typecheck + build:prod. تقرير ختامي مقابل بوابة الخروج. صيغة الأوامر: ROLE/TARGET/CONTEXT/TASK/CONSTRAINTS/OUTPUT.
