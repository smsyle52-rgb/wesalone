import { and, count, desc, eq } from "drizzle-orm";
import { automationRunsTable, automationsTable, db } from "@workspace/db";
import { errors } from "../../lib/errors";
import type { createAutomationSchema, testRunSchema, updateAutomationSchema } from "./automations.schema";
import type { z } from "zod";

type CreateAutomationInput = z.infer<typeof createAutomationSchema>;
type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;
type TestRunInput = z.infer<typeof testRunSchema>;

type AutomationCondition = {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "exists" | "not_exists";
  value?: unknown;
};

type AutomationAction = {
  type: string;
  params: Record<string, unknown>;
};

function getByPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

function evaluateCondition(condition: AutomationCondition, payload: Record<string, unknown>) {
  const actual = getByPath(payload, condition.field);
  let passed = false;
  if (condition.operator === "exists") passed = actual !== undefined && actual !== null;
  if (condition.operator === "not_exists") passed = actual === undefined || actual === null;
  if (condition.operator === "equals") passed = actual === condition.value;
  if (condition.operator === "not_equals") passed = actual !== condition.value;
  if (condition.operator === "contains") {
    passed = Array.isArray(actual)
      ? actual.includes(condition.value)
      : typeof actual === "string" && typeof condition.value === "string" && actual.includes(condition.value);
  }

  return { ...condition, actual, passed };
}

export async function listAutomations(workspaceId: string, filters: { status?: "draft" | "active" | "paused" }) {
  const conditions = [eq(automationsTable.workspaceId, workspaceId)];
  if (filters.status) conditions.push(eq(automationsTable.status, filters.status));

  const [automations, [{ total }]] = await Promise.all([
    db
      .select()
      .from(automationsTable)
      .where(and(...conditions))
      .orderBy(desc(automationsTable.updatedAt)),
    db.select({ total: count() }).from(automationsTable).where(and(...conditions)),
  ]);

  return { automations, total: Number(total) };
}

export async function getAutomation(workspaceId: string, id: string) {
  const [automation] = await db
    .select()
    .from(automationsTable)
    .where(and(eq(automationsTable.id, id), eq(automationsTable.workspaceId, workspaceId)))
    .limit(1);

  if (!automation) throw errors.notFound("الأتمتة");
  return { automation };
}

export async function createAutomation(workspaceId: string, userId: string, input: CreateAutomationInput) {
  const [automation] = await db
    .insert(automationsTable)
    .values({
      workspaceId,
      name: input.name,
      description: input.description ?? null,
      trigger: input.trigger,
      conditions: input.conditions,
      actions: input.actions,
      createdBy: userId,
    })
    .returning();
  return automation;
}

export async function updateAutomation(workspaceId: string, id: string, input: UpdateAutomationInput) {
  await getAutomation(workspaceId, id);
  const [automation] = await db
    .update(automationsTable)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description ?? null }),
      ...(input.trigger !== undefined && { trigger: input.trigger }),
      ...(input.conditions !== undefined && { conditions: input.conditions }),
      ...(input.actions !== undefined && { actions: input.actions }),
      updatedAt: new Date(),
    })
    .where(and(eq(automationsTable.id, id), eq(automationsTable.workspaceId, workspaceId)))
    .returning();
  return automation;
}

export async function deleteAutomation(workspaceId: string, id: string) {
  const { automation } = await getAutomation(workspaceId, id);
  await db.delete(automationsTable).where(and(eq(automationsTable.id, id), eq(automationsTable.workspaceId, workspaceId)));
  return automation;
}

export async function setAutomationStatus(workspaceId: string, id: string, status: "active" | "paused") {
  await getAutomation(workspaceId, id);
  const [automation] = await db
    .update(automationsTable)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(automationsTable.id, id), eq(automationsTable.workspaceId, workspaceId)))
    .returning();
  return automation;
}

export async function testRunAutomation(workspaceId: string, id: string, input: TestRunInput) {
  const { automation } = await getAutomation(workspaceId, id);
  const now = new Date();
  const conditions = automation.conditions as AutomationCondition[];
  const actions = automation.actions as AutomationAction[];
  const evaluated = conditions.map((condition) => evaluateCondition(condition, input.triggerPayload));
  const shouldRun = evaluated.every((condition) => condition.passed);
  const actionsExecuted = actions.map((action, index) => ({
    index,
    type: action.type,
    params: action.params,
    dryRun: true,
    wouldRun: shouldRun,
  }));

  const [run] = await db.transaction(async (tx) => {
    const [automationRun] = await tx
      .insert(automationRunsTable)
      .values({
        automationId: id,
        workspaceId,
        status: "success",
        triggerPayload: { ...input.triggerPayload, testMode: true },
        conditionsEvaluated: evaluated,
        actionsExecuted,
        error: null,
        startedAt: now,
        finishedAt: now,
      })
      .returning();

    await tx
      .update(automationsTable)
      .set({ lastRunAt: now, runCount: automation.runCount + 1, updatedAt: now })
      .where(and(eq(automationsTable.id, id), eq(automationsTable.workspaceId, workspaceId)));

    return [automationRun];
  });

  return { run, shouldRun, conditions: evaluated, actions: actionsExecuted, dryRun: true };
}

export async function listAutomationRuns(workspaceId: string, id: string) {
  await getAutomation(workspaceId, id);
  const [runs, [{ total }]] = await Promise.all([
    db
      .select()
      .from(automationRunsTable)
      .where(and(eq(automationRunsTable.workspaceId, workspaceId), eq(automationRunsTable.automationId, id)))
      .orderBy(desc(automationRunsTable.startedAt))
      .limit(100),
    db
      .select({ total: count() })
      .from(automationRunsTable)
      .where(and(eq(automationRunsTable.workspaceId, workspaceId), eq(automationRunsTable.automationId, id))),
  ]);
  return { runs, total: Number(total) };
}
