import { describe, expect, it } from "vitest";
import { HANDOFF_NOTICE, ensureHandoffCommunicated } from "../lib/agent-reply";
import { replyPromisesHandoff } from "../lib/agent-escalation";

// شكوى إنتاج (9 يوليو 2026): «الوكيل عند التحويل البشري لا يخبر العميل — ينقطع فجأة».
// أغلب التصعيدات خادمية (كلمة مفتاحية من العميل، وعد التأكد، بوابة الادّعاء) حيث نصّ النموذج
// لا يذكر التحويل — فيتبدّل agent_status بصمت. ensureHandoffCommunicated تضمن إعلام العميل دوماً.

describe("ensureHandoffCommunicated — لا انقطاع صامت عند التصعيد", () => {
  it("يُلحق إشعار التحويل عندما يُصعَّد ردٌّ لا يذكر التحويل", () => {
    const result = ensureHandoffCommunicated("سعر الشحن للرياض 20 ريال.", true);
    expect(result.noticeAppended).toBe(true);
    expect(result.reply).toContain("سعر الشحن للرياض 20 ريال.");
    expect(result.reply).toContain(HANDOFF_NOTICE);
  });

  it("لا يُلحق شيئاً عندما لا يوجد تصعيد", () => {
    const result = ensureHandoffCommunicated("تمام، الطلب جاهز.", false);
    expect(result.noticeAppended).toBe(false);
    expect(result.reply).toBe("تمام، الطلب جاهز.");
  });

  it("لا يكرّر الإشعار إذا كان الردّ يعِد بالتحويل أصلاً (وعد الوكيل النصّي)", () => {
    const reply = "سأحول طلبك الآن لأحد الزملاء ليكمل معك.";
    const result = ensureHandoffCommunicated(reply, true);
    expect(result.noticeAppended).toBe(false);
    expect(result.reply).toBe(reply);
  });

  it("لا يكرّر الإشعار عند تأكيد أداة handoff الحتمي («بحوّلك…»)", () => {
    const result = ensureHandoffCommunicated("لحظة من فضلك، بحوّلك لأحد أعضاء الفريق ليكمل معك.", true);
    expect(result.noticeAppended).toBe(false);
  });

  it("لا يكرّر الإشعار إذا كان الردّ هو إشعار التحويل نفسه (رصيد نفد/ردّ فارغ)", () => {
    const result = ensureHandoffCommunicated(HANDOFF_NOTICE, true);
    expect(result.noticeAppended).toBe(false);
    expect(result.reply).toBe(HANDOFF_NOTICE);
  });

  it("لا يُلحق إشعاراً على ردٍّ فارغ (لا يخترع رسالة من عدم)", () => {
    const result = ensureHandoffCommunicated("   ", true);
    expect(result.noticeAppended).toBe(false);
    expect(result.reply).toBe("");
  });

  it("إشعار التحويل نفسه لا يُطابَق كوعد تحويل — فلا يولّد تصعيداً جديداً أو حلقة", () => {
    // لو طابق replyPromisesHandoff لأنشأ سبب تصعيد زائفاً عند إعادة الفحص — تأكيد أنه محايد.
    expect(replyPromisesHandoff(HANDOFF_NOTICE)).toBe(false);
  });
});
