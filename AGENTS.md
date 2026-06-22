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

## UI foundation rules
1. Search `@workspace/ui` before creating a component.
2. New shared primitives use shadcn/ui conventions on Base UI. Do not add another primitive engine without an architecture decision.
3. Use `@workspace/ui/styles/tokens.css`; avoid arbitrary design values.
4. Wesal One is RTL-first and mobile-first. Prefer logical CSS and verify from 320px upward.
5. Components need accessible names, visible focus, keyboard behavior, and relevant disabled/error/loading states.
6. UI work must not change APIs, database, authentication, permissions, or business logic.
7. Do not remove Radix or legacy components until every consumer is migrated and verified.
8. Run relevant typecheck, build, and component tests before each UI commit.
9. Do not duplicate an existing shared component; document justified exceptions.
10. The internal lab is development-only at `/__ui-lab`; foundation work must not redesign production pages.

See `docs/design-system/` for architecture, tokens, components, RTL/mobile/accessibility, testing, migration, and legacy guidance.
