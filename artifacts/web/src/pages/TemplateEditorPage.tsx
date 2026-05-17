import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Plus, Send, Save, Trash2 } from "lucide-react";
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

interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: string;
  text?: string;
  example?: string;
}

interface TemplateVariable {
  key: string;
  example?: string;
  description?: string;
}

const componentTypes: TemplateComponent["type"][] = ["HEADER", "BODY", "FOOTER", "BUTTONS"];
const tabs = ["general", "components", "variables", "preview"] as const;

function detectVariables(components: TemplateComponent[]) {
  const found = new Set<string>();
  for (const component of components) {
    const pattern = /{{\s*([^}]+)\s*}}/g;
    const text = component.text ?? "";
    let match = pattern.exec(text);
    while (match) {
      found.add(match[1].trim());
      match = pattern.exec(text);
    }
  }
  return [...found];
}

export default function TemplateEditorPage({ templateId }: { templateId?: string }) {
  const { t } = useTranslation("pages");
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("general");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    language: "ar",
    category: "utility",
    channelAccountId: "",
    status: "draft",
  });
  const [components, setComponents] = useState<TemplateComponent[]>([{ type: "BODY", text: "", example: "" }]);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);

  const detailQuery = useQuery({
    queryKey: ["template", templateId],
    queryFn: () => apiFetch(`templates/${templateId}`),
    enabled: Boolean(templateId),
  });

  const channelsQuery = useQuery({
    queryKey: ["channel-accounts"],
    queryFn: () => apiFetch("channels/accounts"),
  });

  useEffect(() => {
    const template = detailQuery.data?.template;
    if (!template) return;
    setForm({
      name: template.name ?? "",
      language: template.language ?? "ar",
      category: template.category ?? "utility",
      channelAccountId: template.channelAccountId ?? "",
      status: template.status ?? "draft",
    });
    setComponents(Array.isArray(template.components) && template.components.length > 0 ? template.components : [{ type: "BODY", text: "", example: "" }]);
    setVariables(Array.isArray(template.variables) ? template.variables : []);
  }, [detailQuery.data]);

  useEffect(() => {
    const detected = detectVariables(components);
    setVariables((current) => {
      const byKey = new Map(current.map((item) => [item.key, item]));
      return detected.map((key) => byKey.get(key) ?? { key, example: "", description: "" });
    });
  }, [components]);

  const isDraft = form.status === "draft";
  const isValid = form.name.trim() && form.category && components.some((component) => component.text?.trim());
  const channelAccounts = channelsQuery.data?.accounts ?? [];

  const previewText = useMemo(
    () => components.map((component) => component.text).filter(Boolean).join("\n\n"),
    [components],
  );

  async function saveTemplate() {
    const payload = {
      name: form.name,
      language: form.language,
      category: form.category,
      channelAccountId: form.channelAccountId || null,
      components,
      variables,
    };
    const result = templateId
      ? await apiFetch(`templates/${templateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await apiFetch("templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return result.template;
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const template = await saveTemplate();
      setMessage(t("templates.editor.saved"));
      if (!templateId) setLocation(`/templates/${template.id}`);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setSaving(true);
    setMessage(null);
    try {
      const template = await saveTemplate();
      await apiFetch(`templates/${template.id}/submit`, { method: "POST" });
      setMessage(t("templates.editor.submitted"));
      setLocation("/templates");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function updateComponent(index: number, next: Partial<TemplateComponent>) {
    setComponents((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item)));
  }

  return (
    <div dir="rtl">
      <PageHeader
        title={templateId ? t("templates.editor.editTitle") : t("templates.editor.createTitle")}
        subtitle={t("templates.editor.subtitle")}
        actions={
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !isValid || !isDraft} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50">
              <Save className="h-4 w-4" />
              {t("templates.editor.saveDraft")}
            </button>
            <button onClick={handleSubmit} disabled={saving || !isValid || !isDraft} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Send className="h-4 w-4" />
              {t("templates.editor.submit")}
            </button>
          </div>
        }
      />

      {message && <div className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{message}</div>}
      {detailQuery.data?.template?.status && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t("templates.editor.currentStatus")}</span>
          <StatusBadge status={detailQuery.data.template.status} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${activeTab === tab ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            {t(`templates.editor.tabs.${tab}`)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        {activeTab === "general" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("templates.editor.fields.name")}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!isDraft} className="w-full rounded-lg border border-input bg-background px-3 py-2" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("templates.editor.fields.language")}</span>
              <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} disabled={!isDraft} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                <option value="ar">ar</option>
                <option value="en">en</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("templates.editor.fields.category")}</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} disabled={!isDraft} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                <option value="marketing">{t("templates.categories.marketing")}</option>
                <option value="utility">{t("templates.categories.utility")}</option>
                <option value="authentication">{t("templates.categories.authentication")}</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("templates.editor.fields.channelAccount")}</span>
              <select value={form.channelAccountId} onChange={(e) => setForm({ ...form, channelAccountId: e.target.value })} disabled={!isDraft} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                <option value="">{t("templates.editor.fields.noChannelAccount")}</option>
                {channelAccounts.map((account: any) => (
                  <option key={account.id} value={account.id}>{account.displayName ?? account.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {activeTab === "components" && (
          <div className="space-y-4">
            {components.map((component, index) => (
              <div key={`${component.type}-${index}`} className="rounded-lg border border-border p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <select value={component.type} onChange={(e) => updateComponent(index, { type: e.target.value as TemplateComponent["type"] })} disabled={!isDraft} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
                    {componentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                  {components.length > 1 && (
                    <button onClick={() => setComponents((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={!isDraft} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/20 text-destructive hover:bg-destructive/10 disabled:opacity-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <textarea value={component.text ?? ""} onChange={(e) => updateComponent(index, { text: e.target.value })} disabled={!isDraft} rows={5} className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder={t("templates.editor.fields.componentText")} />
                <input value={component.example ?? ""} onChange={(e) => updateComponent(index, { example: e.target.value })} disabled={!isDraft} className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder={t("templates.editor.fields.example")} />
              </div>
            ))}
            <button onClick={() => setComponents((current) => [...current, { type: "FOOTER", text: "", example: "" }])} disabled={!isDraft} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50">
              <Plus className="h-4 w-4" />
              {t("templates.editor.addComponent")}
            </button>
          </div>
        )}

        {activeTab === "variables" && (
          <div className="space-y-3">
            {variables.length === 0 && <div className="text-sm text-muted-foreground">{t("templates.editor.noVariables")}</div>}
            {variables.map((variable, index) => (
              <div key={variable.key} className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-3">
                <div className="text-sm font-semibold">{variable.key}</div>
                <input value={variable.example ?? ""} onChange={(e) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, example: e.target.value } : item))} disabled={!isDraft} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder={t("templates.editor.fields.variableExample")} />
                <input value={variable.description ?? ""} onChange={(e) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: e.target.value } : item))} disabled={!isDraft} className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder={t("templates.editor.fields.variableDescription")} />
              </div>
            ))}
          </div>
        )}

        {activeTab === "preview" && (
          <div className="mx-auto max-w-md rounded-2xl bg-muted p-4">
            <div className="rounded-2xl rounded-tr-sm bg-primary p-4 text-sm leading-7 text-primary-foreground whitespace-pre-wrap">
              {previewText || t("templates.editor.previewEmpty")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
