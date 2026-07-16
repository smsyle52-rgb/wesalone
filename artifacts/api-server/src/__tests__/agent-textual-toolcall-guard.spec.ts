import { describe, expect, it } from "vitest";
import { extractTextualToolCalls } from "../lib/agent-reply";

// حادثة «مكبر السيارن» (11 يوليو 2026): عميل حقيقي استلم على واتساب كتلة {"tool_calls": ...}
// خاماً ملحقةً بردّ طبيعي — النموذج كتب استدعاء send_product_media نصّاً بدل القناة الأصلية.
// هذه الاختبارات تثبّت الحارس: لا يصل العميل أي كود إطلاقاً، والنيّة تُنقَذ كاستدعاء منظّم.

// الحمولة الحرفية من لقطة شاشة الحادثة (نص طبيعي + كتلة tool_calls ملحقة).
const INCIDENT_REPLY = `حياك الله يا غالي، تقصد مكبر السيارن؟ صوته قوي وما شاء الله عليه، وسعره 12,000 ريال يمني.

بأرسل لك صورته الآن عشان تشوف شكله وتتأكد منه، وإذا حابب تطلب أو عندك أي استفسار ثاني أنا معك.

{ "tool_calls": [ { "id": "call_send_media_siren", "type": "function", "function": { "name": "send_product_media", "arguments": { "productName": "مكبر سيارن", "caption": "هذه صورة مكبر السيارن اللي استفسرت عنه." } } } ] }`;

describe("extractTextualToolCalls — حارس تسريب استدعاءات الأدوات النصّية", () => {
  it("حمولة الحادثة الحرفية: يقتصّ الكتلة كاملةً وينقذ استدعاء send_product_media بوسائطه", () => {
    const result = extractTextualToolCalls(INCIDENT_REPLY);

    expect(result.cleanText).not.toContain("tool_calls");
    expect(result.cleanText).not.toContain("{");
    expect(result.cleanText).toContain("وسعره 12,000 ريال يمني");
    expect(result.cleanText).toContain("بأرسل لك صورته الآن");

    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]!.name).toBe("send_product_media");
    expect(result.calls[0]!.arguments.productName).toBe("مكبر سيارن");
    expect(result.calls[0]!.arguments.caption).toContain("هذه صورة مكبر السيارن");
  });

  it("ردّ نظيف بلا أي كتلة: يمرّ كما هو حرفياً وبلا استدعاءات", () => {
    const clean = "أهلاً بك! سعر المنتج 5,000 ريال يمني وهو متوفر حالياً. تحب أجهز لك طلب؟";
    const result = extractTextualToolCalls(clean);
    expect(result.cleanText).toBe(clean);
    expect(result.calls).toHaveLength(0);
  });

  it("صيغة OpenAI حيث arguments سلسلة JSON مضمّنة (لا كائن): تُفكّ وتُنقَذ", () => {
    const reply = `تمام، لحظة.\n{"tool_calls":[{"function":{"name":"send_product_media","arguments":"{\\"productName\\":\\"عطر عود\\"}"}}]}`;
    const result = extractTextualToolCalls(reply);
    expect(result.cleanText).toBe("تمام، لحظة.");
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]!.arguments.productName).toBe("عطر عود");
  });

  it("صيغة function_call المفردة: تُنقَذ أيضاً", () => {
    const reply = `ثواني بس.\n{"function_call": {"name": "create_order", "arguments": {"productName": "بخور", "quantity": 2}}}`;
    const result = extractTextualToolCalls(reply);
    expect(result.cleanText).toBe("ثواني بس.");
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]!.name).toBe("create_order");
    expect(result.calls[0]!.arguments.quantity).toBe(2);
  });

  it("صيغة {name, arguments} العارية بلا غلاف: تُنقَذ", () => {
    const reply = `حاضر.\n{"name": "schedule_followup", "arguments": {"note": "متابعة"}}`;
    const result = extractTextualToolCalls(reply);
    expect(result.cleanText).toBe("حاضر.");
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]!.name).toBe("schedule_followup");
  });

  it("كتلة مبتورة بلا قوس إغلاق (ردّ مقطوع): تُقتصّ حتى نهاية النص — لا يتسرّب كود مبتور", () => {
    const reply = `سعره 3,000 ريال.\n{ "tool_calls": [ { "function": { "name": "send_product_media", "arguments": { "productName": "مكب`;
    const result = extractTextualToolCalls(reply);
    expect(result.cleanText).toBe("سعره 3,000 ريال.");
    expect(result.cleanText).not.toContain("{");
  });

  it("كتلة JSON تالفة لكنها مكتملة الأقواس: تُقتصّ بلا إنقاذ (الاقتصاص أولوية مطلقة)", () => {
    const reply = `أهلاً.\n{"tool_calls": [ {"function": {"name": 123}} ]}`;
    const result = extractTextualToolCalls(reply);
    expect(result.cleanText).toBe("أهلاً.");
    expect(result.calls).toHaveLength(0);
  });

  it("أقواس داخل نصوص عربية بين علامتي اقتباس لا تكسر موازنة الأقواس", () => {
    const reply = `تمام.\n{"tool_calls":[{"function":{"name":"send_product_media","arguments":{"caption":"صورة {المنتج} المطلوب"}}}]}`;
    const result = extractTextualToolCalls(reply);
    expect(result.cleanText).toBe("تمام.");
    expect(result.calls[0]!.arguments.caption).toBe("صورة {المنتج} المطلوب");
  });

  // حادثة ثانية (13 يوليو 2026): عميل حقيقي استلم "استدعاء أداة handoff_to_human(reason=\"...\")"
  // بأقواس عادية — صياغة مختلفة تماماً عن كتلة JSON أعلاه، فشل ممرّ JSON في التقاطها إطلاقاً.
  describe("الممرّ الثاني — صيغة نداء الدالة بأقواس عادية", () => {
    it("حمولة الحادثة الحرفية: يقتصّ السطر كاملاً (بالعبارة العربية التمهيدية) وينقذ handoff_to_human بوسيطة reason", () => {
      const reply = `أهلاً بك يا غالي، ولا تقلق بخصوص الحساب؛ الموديل هذا مش ظاهر عندي في النظام حالياً وثواني لزميلي في العمل يدخل يتأكد لك من توفره وسعره في المخزن ويحل حالاً لك أي مشكلة في التواصل.\nاستدعاء أداة handoff_to_human(reason="العميل يواجه مشكلة في مراسلة الرقم المعروض وظهور رسالة تقييد الحساب، ويحتاج التأكد من توفر موديل الملكي")`;
      const result = extractTextualToolCalls(reply);

      expect(result.cleanText).not.toContain("استدعاء أداة");
      expect(result.cleanText).not.toContain("handoff_to_human");
      expect(result.cleanText).not.toContain("(");
      expect(result.cleanText).toContain("ولا تقلق بخصوص الحساب");

      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]!.name).toBe("handoff_to_human");
      expect(result.calls[0]!.arguments.reason).toContain("تقييد الحساب");
    });

    it("بلا أي عبارة تمهيدية على الإطلاق: يُكتشف وينقذ بالاعتماد على اسم الأداة وحده", () => {
      const reply = `تمام، لحظة.\ncreate_order(productName="بخور فاخر", quantity="2")`;
      const result = extractTextualToolCalls(reply);
      expect(result.cleanText).toBe("تمام، لحظة.");
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0]!.name).toBe("create_order");
      expect(result.calls[0]!.arguments.quantity).toBe("2");
    });

    it("قوس داخل قيمة مقتبسة لا يكسر موازنة الأقواس", () => {
      const reply = `حسناً.\nschedule_followup(note="تابع بعد يومين (مساءً)")`;
      const result = extractTextualToolCalls(reply);
      expect(result.cleanText).toBe("حسناً.");
      expect(result.calls[0]!.arguments.note).toBe("تابع بعد يومين (مساءً)");
    });

    it("قوس مبتور بلا إغلاق (ردّ مقطوع): يُقتصّ حتى نهاية السطر — لا إنقاذ لاستدعاء مبتور", () => {
      const reply = `سعره 3000 ريال.\nاستدعاء أداة log_payment_claim(amount="30`;
      const result = extractTextualToolCalls(reply);
      expect(result.cleanText).toBe("سعره 3000 ريال.");
      expect(result.cleanText).not.toContain("(");
      expect(result.calls).toHaveLength(0);
    });

    it("أكثر من استدعاء نصّي في نفس الردّ: يُنقذ الاثنان", () => {
      const reply = `send_product_media(productName="مكينة كيمي")\nhandoff_to_human(reason="متابعة")`;
      const result = extractTextualToolCalls(reply);
      expect(result.cleanText).toBe("");
      expect(result.calls.map((c) => c.name)).toEqual(["send_product_media", "handoff_to_human"]);
    });
  });
});
