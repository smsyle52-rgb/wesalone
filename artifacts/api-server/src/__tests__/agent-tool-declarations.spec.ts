import { describe, expect, it } from "vitest";
import { buildAgentToolDeclarations } from "../lib/agent-tools";

// عقد الأدوات المنظّم (native function calling) هو الأساس الذي تعتمد عليه حلقة الوكيل بعد
// التحوّل عن تحليل JSON النصّي. هذه الاختبارات تثبّت بنيته حتى لا ينجرف بصمت.

type Schema = Record<string, unknown>;
const asSchema = (v: unknown): Schema => v as Schema;
const requiredOf = (params: unknown): string[] => (asSchema(params).required as string[]) ?? [];
const propsOf = (params: unknown): Schema => asSchema(asSchema(params).properties);

const policy = (key: string) => ({ key, requiresApproval: false, config: {} });

describe("buildAgentToolDeclarations — عقد الأدوات المنظّم", () => {
  it("ينتج تعريفاً واحداً لكل أداة ممرَّرة باسمها الصحيح ووصف غير فارغ", () => {
    const keys = ["create_order", "log_payment_claim", "schedule_followup", "send_product_media", "handoff_to_human"];
    const decls = buildAgentToolDeclarations(keys.map(policy));
    expect(decls.map((d) => d.name)).toEqual(keys);
    for (const d of decls) {
      expect(d.description.trim().length).toBeGreaterThan(0);
      expect(asSchema(d.parameters).type).toBe("object");
    }
  });

  it("create_order يشترط items، وكل بند يشترط name/quantity/unitPrice، والعملة enum", () => {
    const [decl] = buildAgentToolDeclarations([policy("create_order")]);
    expect(requiredOf(decl.parameters)).toContain("items");
    const items = asSchema(propsOf(decl.parameters).items);
    const itemSchema = asSchema(items.items);
    expect(requiredOf(itemSchema)).toEqual(expect.arrayContaining(["name", "quantity", "unitPrice"]));
    expect(Array.isArray(asSchema(propsOf(decl.parameters).currency).enum)).toBe(true);
  });

  it("log_payment_claim يشترط amount، وschedule_followup يشترط dueAt", () => {
    const [payment] = buildAgentToolDeclarations([policy("log_payment_claim")]);
    expect(requiredOf(payment.parameters)).toContain("amount");
    const [followup] = buildAgentToolDeclarations([policy("schedule_followup")]);
    expect(requiredOf(followup.parameters)).toContain("dueAt");
  });

  it("handoff_to_human وsend_product_media بلا حقول إلزامية (لا تُعيق النموذج)", () => {
    const [handoff] = buildAgentToolDeclarations([policy("handoff_to_human")]);
    expect(requiredOf(handoff.parameters)).toEqual([]);
    const [media] = buildAgentToolDeclarations([policy("send_product_media")]);
    expect(requiredOf(media.parameters)).toEqual([]);
  });

  it("قائمة فارغة تُنتج تعريفات فارغة", () => {
    expect(buildAgentToolDeclarations([])).toEqual([]);
  });
});
