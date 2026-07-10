import { describe, expect, it } from "vitest";
import {
  defaultAgentToolPolicies,
  hasCriticalAgentToolFailure,
  resolveOrderItemsAgainstInventory,
  type AgentToolResult,
  type InventoryProductLite,
  type OrderItemInput,
} from "../lib/agent-tools";

// شكوى المالك الأولى: «الوكلاء لا يستخدمون المخزون/الطلبات». سببان جذريان مؤكَّدان (9 يوليو
// 2026): (أ) وكيل جديد بصفر صفوف تهيئة = صفر أدوات فعلية — لا واجهة لتفعيلها أصلاً، و
// (ب) create_order كان يُدرج بنود الطلب كنص حر غير مربوط بالمخزون فيخترع النموذج السعر.
// هذان الاختباران يثبّتان الإصلاحين: دالة نقية للإعداد الافتراضي، ودالة نقية لمطابقة
// المخزون — كلتاهما بلا db فتُختبَران مباشرة.

function product(overrides: Partial<InventoryProductLite> = {}): InventoryProductLite {
  return { id: "prod-1", name: "منتج", price: "100.00", currency: "YER", ...overrides };
}

function item(overrides: Partial<OrderItemInput> = {}): OrderItemInput {
  return { name: "منتج", quantity: 1, unitPrice: 100, ...overrides };
}

describe("defaultAgentToolPolicies — الإعداد الافتراضي الآمن للأدوات الخمس", () => {
  it("يُرجع الأدوات الخمس كلها بلا اشتراط موافقة بشرية", () => {
    const policies = defaultAgentToolPolicies();
    expect(policies.map((p) => p.key).sort()).toEqual(
      ["create_order", "handoff_to_human", "log_payment_claim", "schedule_followup", "send_product_media"].sort(),
    );
    expect(policies).toHaveLength(5);
    for (const policy of policies) {
      expect(policy.requiresApproval).toBe(false);
      expect(policy.config).toEqual({});
    }
  });
});

describe("resolveOrderItemsAgainstInventory — ربط بنود الطلب بكتالوج المخزون", () => {
  it("تطابق تام لاسم المنتج يربط المعرّف ويعتمد سعر الكتالوج", () => {
    const inventory = [product({ id: "p1", name: "كرتون مياه", price: "1500.00" })];
    const items = [item({ name: "كرتون مياه", unitPrice: 1500 })];
    const [resolved] = resolveOrderItemsAgainstInventory(items, inventory);
    expect(resolved.inventoryProductId).toBe("p1");
    expect(resolved.resolvedUnitPrice).toBe(1500);
    expect(resolved.item).toEqual(items[0]);
  });

  it("يتجاوز فروق الحالة (case) والمسافات الزائدة عند المطابقة", () => {
    const inventory = [product({ id: "p1", name: "Water Carton", price: "1500.00" })];
    const items = [item({ name: "  WATER   carton  ", unitPrice: 1000 })];
    const [resolved] = resolveOrderItemsAgainstInventory(items, inventory);
    expect(resolved.inventoryProductId).toBe("p1");
    expect(resolved.resolvedUnitPrice).toBe(1500);
  });

  it("يطابق الاسم العربي رغم مسافة زائدة في نهاية اسم البند", () => {
    const inventory = [product({ id: "p1", name: "كرتون مياه", price: "1200.00" })];
    const items = [item({ name: "كرتون مياه ", unitPrice: 1000 })];
    const [resolved] = resolveOrderItemsAgainstInventory(items, inventory);
    expect(resolved.inventoryProductId).toBe("p1");
    expect(resolved.resolvedUnitPrice).toBe(1200);
  });

  it("تطابق احتواء فريد عند غياب تطابق تام", () => {
    const inventory = [product({ id: "p1", name: "كرتون مياه صغير 600 مل", price: "1300.00" })];
    const items = [item({ name: "كرتون مياه", unitPrice: 1000 })];
    const [resolved] = resolveOrderItemsAgainstInventory(items, inventory);
    expect(resolved.inventoryProductId).toBe("p1");
    expect(resolved.resolvedUnitPrice).toBe(1300);
  });

  it("مرشّحا احتواء (غموض) → بلا ربط، مع الإبقاء على سعر النموذج", () => {
    const inventory = [
      product({ id: "p1", name: "كرتون مياه صغير", price: "1300.00" }),
      product({ id: "p2", name: "كرتون مياه كبير", price: "1800.00" }),
    ];
    const items = [item({ name: "كرتون مياه", unitPrice: 1000 })];
    const [resolved] = resolveOrderItemsAgainstInventory(items, inventory);
    expect(resolved.inventoryProductId).toBeNull();
    expect(resolved.resolvedUnitPrice).toBe(1000);
    expect(resolved.modelPrice).toBe(1000);
  });

  it("بند غير موجود في المخزون يمرّ بسعر النموذج كما هو", () => {
    const inventory = [product({ id: "p1", name: "شاي", price: "500.00" })];
    const items = [item({ name: "قهوة غير موجودة في الكتالوج", unitPrice: 700 })];
    const [resolved] = resolveOrderItemsAgainstInventory(items, inventory);
    expect(resolved.inventoryProductId).toBeNull();
    expect(resolved.resolvedUnitPrice).toBe(700);
    expect(resolved.modelPrice).toBe(700);
  });

  it("عند التطابق، سعر الكتالوج يطغى على سعر النموذج ويُحفَظ سعر النموذج في modelPrice", () => {
    const inventory = [product({ id: "p1", name: "كرتون مياه", price: "2500.00" })];
    const items = [item({ name: "كرتون مياه", unitPrice: 2000 })];
    const [resolved] = resolveOrderItemsAgainstInventory(items, inventory);
    expect(resolved.inventoryProductId).toBe("p1");
    expect(resolved.resolvedUnitPrice).toBe(2500);
    expect(resolved.modelPrice).toBe(2000);
  });

  it("سعر كتالوج صفري (غير صالح) — يُبقي سعر النموذج رغم التطابق", () => {
    const inventory = [product({ id: "p1", name: "كرتون مياه", price: "0" })];
    const items = [item({ name: "كرتون مياه", unitPrice: 900 })];
    const [resolved] = resolveOrderItemsAgainstInventory(items, inventory);
    expect(resolved.inventoryProductId).toBe("p1");
    expect(resolved.resolvedUnitPrice).toBe(900);
    expect(resolved.modelPrice).toBe(900);
  });
});

// حادثة 10 يوليو: فشل «إرسال صورة منتج» (منتج بلا صورة) كان يمسح الردّ النصي السليم كله
// ويحوّل المحادثة بشرياً «بلا سبب». الفشل الحرج فقط (وعد معاملاتي فشل فعلياً) يستوجب ذلك.
describe("hasCriticalAgentToolFailure — تمييز الفشل الحرج عن الحميد", () => {
  const result = (tool: AgentToolResult["tool"], status: AgentToolResult["status"]): AgentToolResult =>
    ({ tool, status, summary: "" });

  it.each(["create_order", "log_payment_claim", "schedule_followup", "handoff_to_human"] as const)(
    "فشل %s الفعلي = حرج (يمسح الردّ ويصعّد)",
    (tool) => {
      expect(hasCriticalAgentToolFailure([result(tool, "failed")])).toBe(true);
    },
  );

  it("فشل send_product_media حميد — الردّ النصي يبقى ولا تصعيد", () => {
    expect(hasCriticalAgentToolFailure([result("send_product_media", "failed")])).toBe(false);
  });

  it("skip (أداة معطّلة/مجهولة) ليس فشلاً حرجاً — بوابة الادّعاء تحمي النص", () => {
    expect(hasCriticalAgentToolFailure([result("create_order", "skipped")])).toBe(false);
  });

  it("نجاح كامل أو قائمة فارغة — لا مشكلة", () => {
    expect(hasCriticalAgentToolFailure([result("create_order", "success")])).toBe(false);
    expect(hasCriticalAgentToolFailure([])).toBe(false);
  });

  it("فشل حميد + فشل حرج معاً — الحرج يغلب", () => {
    expect(hasCriticalAgentToolFailure([
      result("send_product_media", "failed"),
      result("create_order", "failed"),
    ])).toBe(true);
  });
});
