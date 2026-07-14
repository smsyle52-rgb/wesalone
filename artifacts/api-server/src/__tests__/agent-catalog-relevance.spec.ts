import { describe, expect, it } from "vitest";
import { selectRelevantProducts, formatProductCatalog, type CatalogProductRow } from "../lib/agent-tools";

// ب (تدقيق 13 يوليو 2026): تقليص الكتالوج المعتمد على الصلة. الهدف توكِنز أقل، لكن لا أداة بحث في
// الكتالوج فالسياق هو المرجع الوحيد للوكيل → القاعدة الحاكمة: لا يُقصّ أبداً منتج له صلة بسؤال العميل.
// هذه الاختبارات تثبّت هذا الضمان + التطبيع العربي + تجريد «ال» + اختيار الترويسة حسب القص.

function product(overrides: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    name: "منتج",
    price: "1000.00",
    currency: "YER",
    unit: null,
    quantityAvailable: null,
    imageUrl: null,
    deliveryPolicy: null,
    ...overrides,
  };
}

// متجر كبير: 20 منتجاً بأسماء فريدة، مرتّبة بالأحدثية تنازلياً (الأحدث أولاً) كما يصل من الاستدعاء.
function bigCatalog(): CatalogProductRow[] {
  return Array.from({ length: 20 }, (_, i) => product({ name: `منتج رقم ${i}`, price: `${(i + 1) * 100}.00` }));
}

describe("selectRelevantProducts — تقليص الكتالوج بالصلة", () => {
  it("متجر صغير (≤ الأرضية): يُظهر كل المنتجات بلا قص، truncated=false", () => {
    const products = [product({ name: "عطر" }), product({ name: "بخور" }), product({ name: "مسك" })];
    const { selected, truncated } = selectRelevantProducts(products, "عندكم عطر؟");
    expect(selected).toHaveLength(3);
    expect(truncated).toBe(false);
  });

  it("متجر كبير + سؤال يطابق منتجات محددة: تُدرَج المطابقات أولاً و truncated=true", () => {
    const products = [
      ...bigCatalog(),
      product({ name: "طاولة خشبية كبيرة", price: "5000.00" }),
      product({ name: "طاولة زجاج", price: "6000.00" }),
    ];
    const { selected, truncated } = selectRelevantProducts(products, "كم سعر الطاولة؟");
    expect(truncated).toBe(true);
    // المطابقتان تظهران في المقدمة
    expect(selected[0].name).toContain("طاولة");
    expect(selected[1].name).toContain("طاولة");
    expect(selected.some((p) => p.name === "طاولة خشبية كبيرة")).toBe(true);
    expect(selected.some((p) => p.name === "طاولة زجاج")).toBe(true);
  });

  it("الضمان الجوهري: منتج مطابق لكنه الأقدم (خارج حد الأحدثية) يبقى مُدرَجاً — لا تفويت", () => {
    // المنتج المطابق الوحيد هو الأخير (الأقدم). بلا منطق الصلة كان سيُقصّ ويُنفى توفّره زوراً.
    const products = [...bigCatalog(), product({ name: "مروحة سقف نادرة", price: "9000.00" })];
    const { selected } = selectRelevantProducts(products, "عندكم مروحة؟");
    expect(selected[0].name).toBe("مروحة سقف نادرة");
    expect(selected).toHaveLength(12); // مطابقة واحدة + 11 مكمّلاً = الأرضية
  });

  it("سؤال لا يطابق شيئاً (تحية/عام): يُظهر الأحدث حتى الأرضية، truncated=true", () => {
    const { selected, truncated } = selectRelevantProducts(bigCatalog(), "السلام عليكم");
    expect(truncated).toBe(true);
    expect(selected).toHaveLength(12);
    expect(selected[0].name).toBe("منتج رقم 0"); // الأحدث أولاً
  });

  it("سؤال كله كلمات وظيفية («كم سعر؟») لا يطابق كل المنتجات — يرجع الأحدث فقط", () => {
    const { selected } = selectRelevantProducts(bigCatalog(), "كم سعر؟");
    expect(selected).toHaveLength(12);
  });

  it("تجريد أداة التعريف «ال»: «الطاولة» في السؤال تطابق منتجاً اسمه «طاولة» والعكس", () => {
    const withArticleInProduct = [...bigCatalog(), product({ name: "الطاولة الملكية" })];
    expect(selectRelevantProducts(withArticleInProduct, "عندكم طاولة؟").selected[0].name).toBe("الطاولة الملكية");

    const withArticleInQuery = [...bigCatalog(), product({ name: "طاولة سفرة" })];
    expect(selectRelevantProducts(withArticleInQuery, "بكم الطاولة؟").selected[0].name).toBe("طاولة سفرة");
  });

  it("تطبيع عربي: الألف المقصورة والتاء المربوطة والهمزات لا تكسر المطابقة", () => {
    const products = [...bigCatalog(), product({ name: "كرسي مكتب" }), product({ name: "مروحة هوائية" })];
    // «كرسى» (ى) يجب أن تطابق «كرسي» (ي)
    expect(selectRelevantProducts(products, "عندكم كرسى؟").selected[0].name).toBe("كرسي مكتب");
    // «المروحه» (ه بدل ة + ال) يجب أن تطابق «مروحة»
    expect(selectRelevantProducts(products, "بكم المروحه").selected[0].name).toBe("مروحة هوائية");
  });

  it("مطابقات كثيرة: تُقصّ عند السقف (30) وتُعرض وحدها بلا مكمّلات", () => {
    const products = Array.from({ length: 35 }, (_, i) => product({ name: `صنف ${i}` }));
    const { selected, truncated } = selectRelevantProducts(products, "صنف");
    expect(selected).toHaveLength(30);
    expect(truncated).toBe(true);
  });

  it("أعلى درجة صلة تتصدّر: منتج يطابق ثلاث كلمات قبل منتج يطابق واحدة", () => {
    const products = [
      ...bigCatalog(),
      product({ name: "قميص قطن أزرق فاخر" }), // يطابق «قميص» و«قطن» و«أزرق» = 3
      product({ name: "قميص رياضي" }),          // يطابق «قميص» فقط = 1
    ];
    const { selected } = selectRelevantProducts(products, "أبغى قميص قطن أزرق");
    expect(selected[0].name).toBe("قميص قطن أزرق فاخر");
  });
});

describe("formatProductCatalog — تنسيق الكتالوج النقي", () => {
  it("قائمة فارغة → نص فارغ", () => {
    expect(formatProductCatalog([], false)).toBe("");
  });

  it("قائمة كاملة (غير مقصوصة) → ترويسة «القائمة الحصرية» القوية", () => {
    const out = formatProductCatalog([product({ name: "عطر", price: "45000.00" })], false);
    expect(out).toContain("القائمة الحصرية");
    expect(out).toContain("- عطر: 45000.00 YER");
  });

  it("قائمة مقصوصة → ترويسة لا تدّعي الحصرية وتمنع نفي التوفّر واختلاق السعر", () => {
    const out = formatProductCatalog([product({ name: "عطر" })], true);
    expect(out).toContain("قائمة مختارة");
    expect(out).not.toContain("القائمة الحصرية");
    expect(out).toContain("لا تَنفِ توفّر");
  });

  it("سطر المنتج يحمل التوفّر وعلامة الصورة والتوصيل حين توفّرها", () => {
    const out = formatProductCatalog([
      product({ name: "كرسي", price: "300.00", currency: "SAR", quantityAvailable: 5, unit: "قطعة", imageUrl: "https://x/y.jpg", deliveryPolicy: "all" }),
    ], false);
    expect(out).toContain("- كرسي: 300.00 SAR");
    expect(out).toContain("المتوفر: 5 قطعة");
    expect(out).toContain("صورة متوفرة");
  });

  it("كمية صفر → «غير متوفر حالياً»", () => {
    const out = formatProductCatalog([product({ name: "بخور", quantityAvailable: 0 })], false);
    expect(out).toContain("غير متوفر حالياً");
  });
});
