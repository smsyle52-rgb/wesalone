import { describe, expect, it } from "vitest";
import { formatMetaStoreContext, type MetaStoreAdInput, type MetaStorePostInput } from "../lib/agent-tools";

// الطور 2 (11 يوليو 2026): سياق ميتا انتقل من مسار الاقتراح اليدوي المعطَّل (ai.routes.ts) إلى
// دالة تنسيق نقية مشتركة يستدعيها المسار الحيّ أيضاً (agent-reply.ts). هذه الاختبارات تثبّت
// شكل الإخراج المحقون فعلياً في برومبت النموذج: تاريخ صريح لكل منشور، وسطر التأريض الإلزامي في
// نهاية الكتلة غير الفارغة، وأن تصفية نافذة الـ14 يوماً ليست مسؤولية هذه الدالة (تعيش في SQL).

const GROUNDING_LINE = "تنبيه إلزامي: هذه منشورات/إعلانات تسويقية للسياق فقط — الأسعار والتوفر تُؤخذ حصراً من قائمة المخزون، وأي سعر أو عرض وارد في منشور أو إعلان لا يُعتمد ولا يُقتبس إلا إذا كان موجوداً بنفسه في قائمة المخزون أو معرفة النشاط.";

function ad(overrides: Partial<MetaStoreAdInput> = {}): MetaStoreAdInput {
  return { name: "حملة تجريبية", promotedProductIds: [], ...overrides };
}

function post(overrides: Partial<MetaStorePostInput> = {}): MetaStorePostInput {
  return {
    message: "عرض اليوم على جميع المنتجات",
    permalinkUrl: "https://facebook.com/posts/1",
    externalPostId: "post-1",
    publishedAt: new Date("2026-07-03T10:00:00Z"),
    ...overrides,
  };
}

describe("formatMetaStoreContext — تنسيق سياق ميتا النقي", () => {
  it("إدخال فارغ (بلا إعلانات ولا منشورات) → سياق ومصادر فارغة تماماً", () => {
    const result = formatMetaStoreContext({ ads: [], posts: [], productNames: new Map() });
    expect(result).toEqual({ context: "", sources: [] });
  });

  it("كل سطر منشور يحمل تاريخ نشره المختصر (ISO) بوضوح", () => {
    const result = formatMetaStoreContext({
      ads: [],
      posts: [post({ publishedAt: new Date("2026-07-03T10:00:00Z") })],
      productNames: new Map(),
    });
    expect(result.context).toContain("2026-07-03");
    expect(result.sources[0]).toContain("2026-07-03");
  });

  it("منشور بلا تاريخ نشر (publishedAt فارغ) لا يفتعل تاريخاً", () => {
    const result = formatMetaStoreContext({
      ads: [],
      posts: [post({ publishedAt: null })],
      productNames: new Map(),
    });
    expect(result.context).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(result.context).toContain("عرض اليوم على جميع المنتجات");
  });

  it("يُلحق سطر التأريض الإلزامي حرفياً في نهاية الكتلة غير الفارغة", () => {
    const result = formatMetaStoreContext({ ads: [], posts: [post()], productNames: new Map() });
    expect(result.context.endsWith(GROUNDING_LINE)).toBe(true);
  });

  it("لا سطر تأريض ولا أي نص عند غياب كل من الإعلانات والمنشورات", () => {
    const result = formatMetaStoreContext({ ads: [], posts: [], productNames: new Map() });
    expect(result.context).toBe("");
    expect(result.context).not.toContain(GROUNDING_LINE);
  });

  // تصفية نافذة الـ14 يوماً تعيش في استعلام SQL بـ loadMetaStoreContext (gte + limit) لا هنا —
  // أي منشور يُمرَّر لهذه الدالة يُنسَّق كما هو بلا أي فلترة زمنية إضافية على publishedAt.
  it("ليست مسؤولية هذه الدالة تصفية المنشورات القديمة — منشور عمره سنوات يظهر كما هو", () => {
    const oldPost = post({ publishedAt: new Date("2020-01-01T00:00:00Z"), externalPostId: "old-post" });
    const result = formatMetaStoreContext({ ads: [], posts: [oldPost], productNames: new Map() });
    expect(result.context).toContain("2020-01-01");
  });

  it("سطر الإعلان يترجم معرّفات المنتجات المروَّجة لأسمائها من الخريطة", () => {
    const result = formatMetaStoreContext({
      ads: [ad({ name: "حملة الصيف", promotedProductIds: ["p1", "p2"] })],
      posts: [],
      productNames: new Map([["p1", "قهوة"], ["p2", "شاي"]]),
    });
    expect(result.context).toContain("حملة الصيف — يروّج لمنتجات: قهوة, شاي");
  });

  it("إعلان بلا منتجات مروَّجة → «غير محدد»", () => {
    const result = formatMetaStoreContext({
      ads: [ad({ name: "حملة عامة", promotedProductIds: [] })],
      posts: [],
      productNames: new Map(),
    });
    expect(result.context).toContain("حملة عامة — يروّج لمنتجات: غير محدد");
  });

  it("sources تحمل نفس أسطر الإعلانات/المنشورات بادئةً بتصنيفها", () => {
    const result = formatMetaStoreContext({
      ads: [ad({ name: "حملة الصيف" })],
      posts: [post({ externalPostId: "post-9" })],
      productNames: new Map(),
    });
    expect(result.sources[0]).toContain("إعلان نشط:");
    expect(result.sources[1]).toContain("منشور حديث:");
  });
});
