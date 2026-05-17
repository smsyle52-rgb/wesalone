import { z } from "zod";

export const automationTriggerTypeSchema = z.enum([
  "message.received",
  "conversation.opened",
  "contact.tag.added",
  "order.created",
  "payment.confirmed",
]);

export const automationActionTypeSchema = z.enum([
  "send.template",
  "add.tag",
  "assign.conversation",
  "create.task",
  "create.followup",
]);

export const automationTriggerSchema = z.object({
  type: automationTriggerTypeSchema,
  channel: z.string().trim().max(80).optional().nullable(),
  filters: z.record(z.unknown()).optional(),
}).passthrough();

export const automationConditionSchema = z.object({
  field: z.string().trim().min(1).max(120),
  operator: z.enum(["equals", "not_equals", "contains", "exists", "not_exists"]),
  value: z.unknown().optional(),
});

const baseActionSchema = z.object({
  type: automationActionTypeSchema,
  params: z.record(z.unknown()).default({}),
});

export const automationActionSchema = baseActionSchema.superRefine((action, ctx) => {
  const params = action.params as Record<string, unknown>;
  if (action.type === "send.template" && typeof params.template_id !== "string") {
    ctx.addIssue({ code: "custom", message: "template_id مطلوب" });
  }
  if (action.type === "add.tag" && typeof params.tag !== "string") {
    ctx.addIssue({ code: "custom", message: "tag مطلوب" });
  }
  if (action.type === "assign.conversation" && typeof params.user_id !== "string" && typeof params.team_id !== "string") {
    ctx.addIssue({ code: "custom", message: "user_id أو team_id مطلوب" });
  }
  if (action.type === "create.task" && typeof params.title !== "string") {
    ctx.addIssue({ code: "custom", message: "title مطلوب" });
  }
  if (action.type === "create.followup" && typeof params.note !== "string") {
    ctx.addIssue({ code: "custom", message: "note مطلوب" });
  }
});

export const createAutomationSchema = z.object({
  name: z.string().trim().min(1, "اسم الأتمتة مطلوب").max(160),
  description: z.string().trim().max(1000).optional().nullable(),
  trigger: automationTriggerSchema,
  conditions: z.array(automationConditionSchema).default([]),
  actions: z.array(automationActionSchema).default([]),
});

export const updateAutomationSchema = createAutomationSchema.partial();

export const listAutomationsQuerySchema = z.object({
  status: z.enum(["draft", "active", "paused"]).optional(),
});

export const testRunSchema = z.object({
  triggerPayload: z.record(z.unknown()).default({}),
});
