---
name: wesal-one-agents
description: >-
  الدستور الحاكم لمنصّة وصال ون (Wesal One) — منصّة وكلاء مبيعات ذكية متعددة العملاء
  على ثلاث قنوات ميتا (واتساب، ماسنجر/صفحات، إنستغرام). استخدم هذه المهارة فوراً وحرفياً في
  أي جلسة كلود كود أو كوديكس تخص وصال ون: عند أمر «اتبع المهارة» أو «اقرأ الخطة وكمّل» أو
  «وش الخطوة التالية»، أو عند فحص/إصلاح/بناء أي نطاق (تسجيل الدخول والمصادقة، عزل العملاء،
  الأسرار والتوكنات، متانة القنوات الثلاث، حلقة الرد agent-runner، أدوات المهمات function calling،
  جودة الاسترجاع، الموثوقية/الـworker، حماية البيانات، الفوترة، التصليب الأمني، الإعداد، الاختبار،
  الطيار والإطلاق)، أو عند سؤال عن الحالة/الخطوة التالية — حتى لو لم يُذكر اسم الملف.
  Trigger whenever Abu Sila mentions Wesal One, الموظف الذكي، agent-runner، tenant isolation،
  embedded signup، أو يطلب متابعة الخطة. التنفيذ نطاقاً-نطاقاً ببوابات إغلاق، نطاق واحد نشط فقط،
  الأمن والعزل قبل الميزات. القرارات الهندسية مقفلة؛ المحميات تسري دائماً؛ commit/push بيد المالك فقط.
---

# منصّة وصال ون — الدستور الحاكم

**ابدأ هنا:** خطة العمل التي تتبعها هي `references/launch-readiness-plan.md`.
عند أي أمر متابعة («اتبع المهارة» / «اقرأ الخطة وكمّل» / «وش الخطوة التالية»):
1. اقرأ `references/launch-readiness-plan.md` (**النحيف — يُقرأ كاملاً**) + `WESAL_ONE_CHAT_HANDOFF.md` (الحالة الحيّة). **لتوفير الرصيد:** `references/domain-details.md` يُفتح **للنطاق النشط فقط**، لا يُقرأ كاملاً.
2. طبّق **الحلقة التشغيلية** (القسم 0 من الخطة): عالِج أولاً أي عطل إنتاجي مؤكّد (PD-1…PD-6، القسم 2) → ثم جِد أول نطاق ليس ✅ في جدول الحالة → افتح تفاصيله من `domain-details.md` → افحص (read-only) أو أصلح حسب حالته → توقّف وانتظر القرار.
3. التزم **المحميات** ومعايير الهندسة (القسم 2 من الخطة) في كل خطوة.

## الملفات المرجعية
| الملف | المحتوى |
|---|---|
| `references/launch-readiness-plan.md` | **الدستور التشغيلي النحيف** — الحلقة، البريف، المحميات، سجلّ الأعطال PD، **جدول حالة الـ30 نطاقاً**. اقرأه أولاً كاملاً. |
| `references/domain-details.md` | **تفاصيل النطاقات الـ30 الكاملة** (ما يُفحص/الخريطة/الثغرات/القرارات/البوابة). **للنطاق النشط فقط — لا يُقرأ كاملاً** (توفير رصيد). |
| `references/agents-master-plan.md` | القرارات الهندسية المقفلة لحلقة الوكلاء (مراحل 1–7). مرجع تفصيلي. |
| `references/strategic-master-plan.md` | خارطة الأعمال من اليوم للإطلاق (مراحل A–H). مرجع تفصيلي. |

## الحالة (الحيّة في WESAL_ONE_CHAT_HANDOFF.md)
- المرحلة 1 (حلقة الرد) **مقفلة** ✅ — الـworker يـpoll، domain_events تُعالَج، webhook يستقبل، الـ401 محلول.
- **النشط الآن:** عالِج أولاً سجلّ الأعطال الإنتاجية المؤكّدة (PD-1…PD-6) — الوارد (PD-2 ثم PD-1، النطاق 23) أولاً. الحالة الدقيقة في `WESAL_ONE_CHAT_HANDOFF.md`.
- الحالة المتغيّرة لكل جلسة تُكتب في `WESAL_ONE_CHAT_HANDOFF.md` فقط (لا تُكرّر هنا تفادياً للتناقض).

## القواعد الثابتة (تفصيلها في القسم 2 من الخطة)
- نطاق واحد نشط فقط؛ لا تقفز؛ الأمن والعزل قبل الميزات. ميتا تتقدّم بالتوازي حصراً.
- ابدأ كل نطاق بفحص read-only؛ بعد كل تعديل typecheck + build:prod؛ تقرير ختامي مقابل بوابة الإغلاق.
- staging صريح للملفات — لا `git add -A`؛ **commit/push بيد المالك فقط**.
- أسرار/توكنات في Secret Manager فقط؛ تطبيق ميتا (1437258534807702) لا يُلمس إلا بطلب صريح.
- تأكّد من الصلاحية قبل البناء (الكتالوج/الإعلانات غير متوفرين حالياً).
- صيغة الأوامر: ROLE / TARGET / CONTEXT / TASK / CONSTRAINTS / OUTPUT.

## Wesal One UI Foundation

### المعمارية المعتمدة
- `Base UI` (`@base-ui/react`) هو محرك الـprimitives والسلوك وإمكانية الوصول.
- `shadcn/ui` بنمط `base-nova` هو مصدر المكونات القابلة للتعديل والمحفوظة داخل المستودع.
- `Tailwind CSS v4` وCSS Variables هما طبقة التنسيق.
- `@workspace/ui` في `lib/ui` هي الحزمة المشتركة الرسمية، و`@workspace/ui/styles/tokens.css` هو مدخل الـDesign Tokens المركزي للألوان والمسافات والحواف والظلال والحركة.
- وصال ون عربي أولاً، وRTL أولاً، وMobile First. يستعمل `DirectionProvider` اتجاه RTL افتراضياً، ويحدد تطبيق الويب الاتجاه الفعلي حسب اللغة.
- الحزمة للعرض والتفاعل فقط؛ لا تستورد API clients أو المصادقة أو قاعدة البيانات أو routes أو منطق المنتج.

### قواعد إلزامية للوكلاء والمطورين
- افحص `@workspace/ui` قبل إنشاء أي مكون جديد. لا تنشئ نسخة ثانية من Button أو Dialog أو Select أو Drawer أو أي مكون موجود.
- استخدم Design Tokens بدلاً من الألوان والقيم العشوائية، واستخدم الخصائص المنطقية `start` و`end` و`inline` و`block` بدلاً من الاعتماد المباشر على `left` و`right`.
- يجب أن تدعم المكونات الجديدة RTL والجوال ولوحة المفاتيح وfocus المرئي وحالات disabled وloading وerror وإمكانية الوصول.
- لا تستخدم primitive library أخرى دون قرار معماري موثق. تبقى مكونات Radix القديمة حتى تُهاجر كل شاشة عمداً وتُختبر.
- لا تغيّر APIs أو قاعدة البيانات أو المصادقة أو الصلاحيات أو منطق الأعمال ضمن مهام التصميم، ولا تعِد كتابة الصفحات كاملة دون ضرورة.
- لا تستخدم الشكل الافتراضي لـshadcn كهوية نهائية؛ هوية وصال ون البصرية تُبنى فوق النظام المشترك.
- كل شاشة تُصمم لاحقاً في مهمة مستقلة وفرع مستقل. لا تعدّل عدة شاشات حساسة في دفعة واحدة دون اختبارات.
- شغّل اختبارات المكونات وtypecheck وbuild قبل الدمج، ووثّق أي استثناء مبرر بدلاً من تكرار مكون مشترك.

### المكونات والـexports المتاحة
تُستورد المكونات من subpaths صريحة في `@workspace/ui`:

- **Buttons:** `Button`, `buttonVariants`, `IconButton`, وtype export باسم `IconButtonProps`.
- **Fields and Inputs:** `Input`, `Textarea`, `Label`, `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldLegend`, `FieldSeparator`, `FieldSet`, `FieldContent`, `FieldTitle`, `InputGroup`, `InputGroupAddon`, `InputGroupButton`, `InputGroupText`, `InputGroupInput`, `InputGroupTextarea`.
- **Selection controls:** `Checkbox`, `RadioGroup`, `RadioGroupItem`, `Switch`, `Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator`, `SelectTrigger`, `SelectValue`, `Combobox`, `ComboboxInput`, `ComboboxContent`, `ComboboxList`, `ComboboxItem`, `ComboboxGroup`, `ComboboxLabel`, `ComboboxCollection`, `ComboboxEmpty`, `ComboboxSeparator`, `ComboboxChips`, `ComboboxChip`, `ComboboxChipsInput`, `ComboboxTrigger`, `ComboboxValue`, `useComboboxAnchor`.
- **Menus and Popovers:** `DropdownMenu`, `DropdownMenuPortal`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuLabel`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuSub`, `DropdownMenuSubTrigger`, `DropdownMenuSubContent`, `Popover`, `PopoverContent`, `PopoverDescription`, `PopoverHeader`, `PopoverTitle`, `PopoverTrigger`, `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`.
- **Dialogs and Drawers:** `Dialog`, `DialogClose`, `DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`, `DialogOverlay`, `DialogPortal`, `DialogTitle`, `DialogTrigger`, `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogMedia`, `AlertDialogOverlay`, `AlertDialogPortal`, `AlertDialogTitle`, `AlertDialogTrigger`, `Drawer`, `DrawerTrigger`, `DrawerClose`, `DrawerContent`, `DrawerHeader`, `DrawerFooter`, `DrawerTitle`, `DrawerDescription`, `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`.
- **Tabs and navigation primitives:** `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `tabsListVariants`, `ScrollArea`, `ScrollBar`, `Separator`.
- **Feedback and status states:** `Badge`, `badgeVariants`, `Toaster`, `Skeleton`, `Spinner`.
- **Tables and data display:** `Avatar`, `AvatarImage`, `AvatarFallback`, `AvatarGroup`, `AvatarGroupCount`, `AvatarBadge`, `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption`.
- **Loading, Empty and Error states:** `LoadingState`, `Empty`, `EmptyHeader`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`, `EmptyMedia`, `ErrorState`.
- **Infrastructure:** `DirectionProvider` و`cn` من `@workspace/ui/lib/utils`.

للقائمة الدقيقة عند التطوير، اعتبر `lib/ui/package.json` وexports ملفات `lib/ui/src/components/*` المرجع التنفيذي؛ لا تخمّن اسماً غير موجود.

### طريقة الاستخدام

```tsx
import { Button } from "@workspace/ui/button";
import { Field, FieldLabel } from "@workspace/ui/field";
import { Input } from "@workspace/ui/input";

export function ContactNameField() {
  return (
    <Field>
      <FieldLabel htmlFor="contact-name">اسم جهة الاتصال</FieldLabel>
      <Input id="contact-name" name="contactName" />
      <Button type="submit">حفظ</Button>
    </Field>
  );
}
```

### مختبر المكونات
- الصفحة في `artifacts/web/src/pages/dev/UiLabPage.tsx` والمسار المحلي `/__ui-lab`.
- شغّل `corepack pnpm --filter @workspace/web dev` ثم افتح `/__ui-lab`.
- التحميل والمسار محميان بـ`import.meta.env.DEV` في `artifacts/web/src/App.tsx`، ولذلك لا يظهر المختبر في Production.
- يُستخدم لفحص RTL/LTR والجوال (بدءاً من 320px) وlight/dark والتركيز ولوحة المفاتيح وEscape وعودة التركيز والحالات المختلفة والقص والoverflow.

### أوامر التحقق الفعلية

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @workspace/ui test
corepack pnpm --filter @workspace/ui run typecheck
corepack pnpm run typecheck
corepack pnpm run build:prod
```

لا يحتوي المستودع حالياً على إعداد lint أو product integration-test runner؛ لا تخترع أمراً لهما حتى تُضاف أدوات مخصصة.

### خطة التصميم القادمة وحالة النظام
- تأسيس النظام اكتمل، ولم يبدأ تصميم صفحات المنتج بعد. إعادة التصميم ستكون شاشة شاشة، وكل شاشة تستخدم المكونات المشتركة.
- commits المرجعية: `e05e3eb` لتوثيق اكتمال التأسيس، و`3bf215b` لحالة `main` المعتمدة بعد الدمج.
- الحالة المعتمدة: `WESAL_UI_FOUNDATION_READY`.
