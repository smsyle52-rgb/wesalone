import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Play, Save, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";

const BASE = `${import.meta.env.BASE_URL}api`;

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/${path}`, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      throw new Error(json.error ?? text);
    } catch {
      throw new Error(text);
    }
  }
  return res.json();
}

const steps = ["trigger", "conditions", "actions"] as const;
const triggerTypes = ["message.received", "conversation.opened", "contact.tag.added", "order.created", "payment.confirmed"];
const operators = ["equals", "not_equals", "contains", "exists", "not_exists"];
const actionTypes = ["send.template", "add.tag", "assign.conversation", "create.task", "create.followup"];

type ConditionForm = { field: string; operator: string; value: string };
type ActionForm = { type: string; params: string };

export default function AutomationEditorPage({ automationId }: { automationId?: string }) {
  const { t } = useTranslation("pages");
  const [, setLocation] = useLocation();
  const [activeStep, setActiveStep] = useState<(typeof steps)[number]>("trigger");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showTestRun, setShowTestRun] = useState(false);
  const [testPayload, setTestPayload] = useState('{\n  "message": {\n    "text": "مرحبا"\n  }\n}');
  const [testResult, setTestResult] = useState<any>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    triggerType: "message.received",
    triggerChannel: "",
    triggerFilters: "{}",
    conditions: [] as ConditionForm[],
    actions: [] as ActionForm[],
    status: "draft",
  });

  const automationQuery = useQuery({
    queryKey: ["automation", automationId],
    queryFn: () => apiFetch(`automations/${automationId}`),
    enabled: Boolean(automationId),
  });

  useEffect(() => {
    const automation = automationQuery.data?.automation;
    if (!automation) return;
    const trigger = automation.trigger ?? {};
    setForm({
      name: automation.name ?? "",
      description: automation.description ?? "",
      triggerType: trigger.type ?? "message.received",
      triggerChannel: trigger.channel ?? "",
      triggerFilters: JSON.stringify(trigger.filters ?? {}, null, 2),
      conditions: Array.isArray(automation.conditions)
        ? automation.conditions.map((condition: any) => ({
          field: condition.field ?? "",
          operator: condition.operator ?? "equals",
          value: condition.value === undefined ? "" : JSON.stringify(condition.value),
        }))
        : [],
      actions: Array.isArray(automation.actions)
        ? automation.actions.map((action: any) => ({
          type: action.type ?? "add.tag",
          params: JSON.stringify(action.params ?? {}, null, 2),
        }))
        : [],
      status: automation.status ?? "draft",
    });
  }, [automationQuery.data]);

  function addCondition() {
    setForm((current) => ({ ...current, conditions: [...current.conditions, { field: "", operator: "equals", value: "" }] }));
  }

  function updateCondition(index: number, patch: Partial<ConditionForm>) {
    setForm((current) => ({
      ...current,
      conditions: current.conditions.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)),
    }));
  }

  function removeCondition(index: number) {
    setForm((current) => ({ ...current, conditions: current.conditions.filter((_, i) => i !== index) }));
  }

  function addAction() {
    setForm((current) => ({ ...current, actions: [...current.actions, { type: "add.tag", params: '{\n  "tag": "new"\n}' }] }));
  }

  function updateAction(index: number, patch: Partial<ActionForm>) {
    setForm((current) => ({
      ...current,
      actions: current.actions.map((action, i) => (i === index ? { ...action, ...patch } : action)),
    }));
  }

  function removeAction(index: number) {
    setForm((current) => ({ ...current, actions: current.actions.filter((_, i) => i !== index) }));
  }

  function parsePayload() {
    let filters: Record<string, unknown> = {};
    try {
      filters = form.triggerFilters.trim() ? JSON.parse(form.triggerFilters) : {};
    } catch {
      throw new Error(t("automations.editor.invalidTriggerFilters"));
    }
    return {
      name: form.name,
      description: form.description || null,
      trigger: { type: form.triggerType, channel: form.triggerChannel || null, filters },
      conditions: form.conditions
        .filter((condition) => condition.field.trim())
        .map((condition) => ({
          field: condition.field.trim(),
          operator: condition.operator,
          value: condition.value.trim() ? JSON.parse(condition.value) : undefined,
        })),
      actions: form.actions.map((action) => ({
        type: action.type,
        params: action.params.trim() ? JSON.parse(action.params) : {},
      })),
    };
  }

  async function saveAutomation(activateAfterSave = false) {
    setSaving(true);
    setMessage(null);
    try {
      const payload = parsePayload();
      const result = automationId
        ? await apiFetch(`automations/${automationId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await apiFetch("automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (activateAfterSave) {
        await apiFetch(`automations/${result.automation.id}/activate`, { method: "POST" });
      }
      setLocation(`/automations/${result.automation.id}`);
      setMessage(t("automations.editor.saved"));
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setSaving(true);
    setMessage(null);
    try {
      const payload = JSON.parse(testPayload);
      let currentId = automationId;
      if (!currentId) {
        const created = await apiFetch("automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsePayload()) });
        currentId = created.automation.id;
        setLocation(`/automations/${currentId}`);
      }
      const result = await apiFetch(`automations/${currentId}/test-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerPayload: payload }),
      });
      setTestResult(result);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const valid = form.name.trim() && form.triggerType;

  return (
    <div dir="rtl">
      <PageHeader
        title={automationId ? t("automations.editor.editTitle") : t("automations.editor.createTitle")}
        subtitle={t("automations.editor.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <button onClick={() => saveAutomation(false)} disabled={saving || !valid} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50">
              <Save className="h-4 w-4" />
              {t("common.save")}
            </button>
            <button onClick={() => setShowTestRun(true)} disabled={saving || !valid} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50">
              <Play className="h-4 w-4" />
              {t("common.testRun")}
            </button>
            <button onClick={() => saveAutomation(true)} disabled={saving || !valid} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Zap className="h-4 w-4" />
              {t("common.activate")}
            </button>
          </div>
        }
      />

      {automationId && <div className="mb-4"><StatusBadge status={form.status} /></div>}
      {message && <div className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{message}</div>}

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("automations.editor.fields.name")}</span>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("automations.editor.fields.description")}</span>
          <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2" />
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {steps.map((step) => (
          <button key={step} onClick={() => setActiveStep(step)} className={`rounded-full px-4 py-2 text-sm font-medium ${activeStep === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
            {t(`automations.editor.steps.${step}`)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        {activeStep === "trigger" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("automations.editor.fields.triggerType")}</span>
              <select value={form.triggerType} onChange={(event) => setForm({ ...form, triggerType: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                {triggerTypes.map((type) => <option key={type} value={type}>{t(`automations.triggers.${type}`)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("automations.editor.fields.channel")}</span>
              <input value={form.triggerChannel} onChange={(event) => setForm({ ...form, triggerChannel: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2" />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="font-medium">{t("automations.editor.fields.filters")}</span>
              <textarea value={form.triggerFilters} onChange={(event) => setForm({ ...form, triggerFilters: event.target.value })} rows={6} dir="ltr" className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm" />
            </label>
          </div>
        )}

        {activeStep === "conditions" && (
          <div className="space-y-3">
            <button onClick={addCondition} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">{t("automations.editor.addCondition")}</button>
            {form.conditions.length === 0 && <p className="text-sm text-muted-foreground">{t("automations.editor.noConditions")}</p>}
            {form.conditions.map((condition, index) => (
              <div key={index} className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[1fr_180px_1fr_auto]">
                <input value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value })} placeholder={t("automations.editor.fields.conditionField")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                <select value={condition.operator} onChange={(event) => updateCondition(index, { operator: event.target.value })} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  {operators.map((operator) => <option key={operator} value={operator}>{t(`automations.operators.${operator}`)}</option>)}
                </select>
                <input value={condition.value} onChange={(event) => updateCondition(index, { value: event.target.value })} placeholder={t("automations.editor.fields.conditionValue")} dir="ltr" className="rounded-lg border border-input bg-background px-3 py-2 text-sm" />
                <button onClick={() => removeCondition(index)} className="rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10">{t("common.delete")}</button>
              </div>
            ))}
          </div>
        )}

        {activeStep === "actions" && (
          <div className="space-y-3">
            <button onClick={addAction} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">{t("automations.editor.addAction")}</button>
            {form.actions.length === 0 && <p className="text-sm text-muted-foreground">{t("automations.editor.noActions")}</p>}
            {form.actions.map((action, index) => (
              <div key={index} className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[240px_1fr_auto]">
                <select value={action.type} onChange={(event) => updateAction(index, { type: event.target.value })} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  {actionTypes.map((type) => <option key={type} value={type}>{t(`automations.actions.${type}`)}</option>)}
                </select>
                <textarea value={action.params} onChange={(event) => updateAction(index, { params: event.target.value })} rows={5} dir="ltr" className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm" />
                <button onClick={() => removeAction(index)} className="h-10 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10">{t("common.delete")}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showTestRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("automations.editor.testRunTitle")}</h2>
              <button onClick={() => setShowTestRun(false)} className="rounded-lg px-3 py-2 text-sm hover:bg-muted">{t("common.cancel")}</button>
            </div>
            <textarea value={testPayload} onChange={(event) => setTestPayload(event.target.value)} rows={8} dir="ltr" className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm" />
            <button onClick={runTest} disabled={saving} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Play className="h-4 w-4" />
              {t("common.testRun")}
            </button>
            {testResult && (
              <pre dir="ltr" className="mt-4 max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
