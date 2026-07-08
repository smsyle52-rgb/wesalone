import { describe, expect, it } from "vitest";
import { RECENCY_BONUS_MAX, RECENCY_BONUS_WINDOW_DAYS, recencyBonus } from "../services/knowledge-retrieval";
import { formatKnowledgeItem } from "../lib/agent-reply";

// حادثة حيّة (9 يوليو 2026): تاجر صحّح رصيد الباقة المجانية من 1000 إلى 500 نقطة في قاعدة
// المعرفة، لكن الوكيل ظلّ يردّ بالرقمين بالتناوب — لأن مصدرين (القديم غير المؤرشف + الجديد)
// كانا متقاربين في درجة التطابق، فيقلب الترتيب حسب صياغة سؤال العميل فقط. هذه الاختبارات تثبت
// كسر التعادل بالحداثة (recencyBonus) ووسم التاريخ الظاهر للنموذج (formatKnowledgeItem).

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe("recencyBonus — كسر التعادل بالحداثة", () => {
  it("لا مكافأة لمصدر بلا تاريخ تحديث معروف", () => {
    expect(recencyBonus(null)).toBe(0);
  });

  it("مكافأة قصوى لمصدر حُدّث الآن", () => {
    expect(recencyBonus(new Date())).toBeCloseTo(RECENCY_BONUS_MAX, 5);
  });

  it("لا مكافأة لمصدر أقدم من نافذة الحداثة", () => {
    expect(recencyBonus(daysAgo(RECENCY_BONUS_WINDOW_DAYS + 1))).toBe(0);
    expect(recencyBonus(daysAgo(90))).toBe(0);
  });

  it("تتناقص المكافأة اطّراداً مع تقادم المصدر", () => {
    const fresh = recencyBonus(daysAgo(1));
    const mid = recencyBonus(daysAgo(15));
    const old = recencyBonus(daysAgo(29));
    expect(fresh).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(old);
    expect(old).toBeGreaterThan(0);
  });

  it("المكافأة صغيرة بما لا يكفي لتجاوز فارق تطابق حقيقي", () => {
    // أقصى مكافأة ممكنة (0.05) أصغر بكثير من وزن أي مكوّن تطابق حقيقي (0.4 أو 0.6) —
    // فهي تكسر التعادل بين مصدرين متقاربين، ولا تقلب مصدراً أضعف تطابقاً فوق أقوى.
    expect(RECENCY_BONUS_MAX).toBeLessThan(0.1);
  });

  it("المثال الحي: مصدر مصحَّح اليوم يتغلّب على نسخة قديمة متقاربة الدرجة", () => {
    const oldScore = 0.5 + recencyBonus(daysAgo(120)); // الوثيقة القديمة (١٠٠٠) — لم تُحدَّث منذ أشهر
    const freshScore = 0.5 + recencyBonus(daysAgo(0)); // الوثيقة المصحَّحة اليوم (٥٠٠)
    expect(freshScore).toBeGreaterThan(oldScore);
  });
});

describe("formatKnowledgeItem — وسم الحداثة الظاهر للنموذج", () => {
  it("يعرض تاريخ آخر تحديث بصيغة YYYY-MM-DD قبل عنوان المصدر", () => {
    const formatted = formatKnowledgeItem(
      { title: "الباقة المجانية", content: "500 نقطة", updatedAt: new Date("2026-07-06T10:00:00Z") },
      0,
    );
    expect(formatted).toContain("(آخر تحديث: 2026-07-06)");
    expect(formatted).toContain("الباقة المجانية");
    expect(formatted).toContain("500 نقطة");
  });

  it("يعرض 'غير معروف' بدل الانهيار عند غياب تاريخ التحديث", () => {
    const formatted = formatKnowledgeItem({ title: "عنوان", content: "محتوى", updatedAt: null }, 2);
    expect(formatted).toContain("(آخر تحديث: غير معروف)");
    expect(formatted.startsWith("[3]")).toBe(true);
  });
});
