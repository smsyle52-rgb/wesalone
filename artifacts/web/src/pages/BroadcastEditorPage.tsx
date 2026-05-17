import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Save, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui/PageHeader";

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

const tabs = ["basics", "audience", "variables", "schedule", "review"] as const;

export default function BroadcastEditorPage() {
  const { t } = useTranslation("pages");
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("basics");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    templateId: "",
    channelAccountId: "",
    selectedContacts: [] as string[],
    includeTags: "",
    variableMapping: "{}",
    scheduleMode: "now",
    scheduledAt: "",
  });

  const templatesQuery = useQuery({
    queryKey: ["templates-approved"],
    queryFn: () => apiFetch("templates?status=approved"),
  });
  const channelsQuery = useQuery({
    queryKey: ["channel-accounts"],
    queryFn: () => apiFetch("channels/accounts"),
  });
  const contactsQuery = useQuery({
    queryKey: ["contacts-for-broadcast"],
    queryFn: () => apiFetch("contacts?limit=200"),
  });

  const templates = templatesQuery.data?.templates ?? [];
  const channelAccounts = channelsQuery.data?.accounts ?? [];
  const contacts = contactsQuery.data?.contacts ?? [];
  const selectedTemplate = templates.find((template: any) => template.id === form.templateId);
  const selectedContacts = useMemo(
    () => contacts.filter((contact: any) => form.selectedContacts.includes(contact.id)),
    [contacts, form.selectedContacts],
  );

  const variables = Array.isArray(selectedTemplate?.variables) ? selectedTemplate.variables : [];
  const valid = form.name.trim() && form.templateId && form.channelAccountId && (form.selectedContacts.length > 0 || form.includeTags.trim());

  function toggleContact(id: string) {
    setForm((current) => ({
      ...current,
      selectedContacts: current.selectedContacts.includes(id)
        ? current.selectedContacts.filter((contactId) => contactId !== id)
        : [...current.selectedContacts, id],
    }));
  }

  async function saveBroadcast(startAfterCreate: boolean) {
    setSaving(true);
    setMessage(null);
    try {
      let variableMapping: Record<string, string> = {};
      try {
        variableMapping = form.variableMapping.trim() ? JSON.parse(form.variableMapping) : {};
      } catch {
        setMessage(t("broadcasts.editor.invalidMapping"));
        return;
      }

      const payload = {
        name: form.name,
        templateId: form.templateId,
        channelAccountId: form.channelAccountId,
        audienceFilter: {
          contact_ids: form.selectedContacts,
          includeTags: form.includeTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        },
        variableMapping,
        scheduledAt: form.scheduleMode === "scheduled" && form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      };
      const result = await apiFetch("broadcasts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (startAfterCreate) {
        await apiFetch(`broadcasts/${result.broadcast.id}/start`, { method: "POST" });
      }
      setLocation(`/broadcasts/${result.broadcast.id}`);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div dir="rtl">
      <PageHeader
        title={t("broadcasts.editor.title")}
        subtitle={t("broadcasts.editor.subtitle")}
        actions={
          <div className="flex gap-2">
            <button onClick={() => saveBroadcast(false)} disabled={saving || !valid} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50">
              <Save className="h-4 w-4" />
              {t("broadcasts.editor.saveDraft")}
            </button>
            <button onClick={() => saveBroadcast(true)} disabled={saving || !valid} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Send className="h-4 w-4" />
              {form.scheduleMode === "scheduled" ? t("common.schedule") : t("common.sendNow")}
            </button>
          </div>
        }
      />

      {message && <div className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{message}</div>}

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-full px-4 py-2 text-sm font-medium ${activeTab === tab ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
            {t(`broadcasts.editor.tabs.${tab}`)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        {activeTab === "basics" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("broadcasts.editor.fields.name")}</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("broadcasts.editor.fields.template")}</span>
              <select value={form.templateId} onChange={(event) => setForm({ ...form, templateId: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                <option value="">{t("broadcasts.editor.fields.selectTemplate")}</option>
                {templates.map((template: any) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("broadcasts.editor.fields.channelAccount")}</span>
              <select value={form.channelAccountId} onChange={(event) => setForm({ ...form, channelAccountId: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                <option value="">{t("broadcasts.editor.fields.selectChannel")}</option>
                {channelAccounts.map((account: any) => <option key={account.id} value={account.id}>{account.displayName ?? account.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {activeTab === "audience" && (
          <div className="space-y-4">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t("broadcasts.editor.fields.tags")}</span>
              <input value={form.includeTags} onChange={(event) => setForm({ ...form, includeTags: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2" placeholder={t("broadcasts.editor.fields.tagsPlaceholder")} />
            </label>
            <div className="rounded-lg border border-border">
              <div className="border-b border-border p-3 text-sm font-semibold">{t("broadcasts.editor.fields.contacts")}</div>
              <div className="max-h-72 space-y-1 overflow-y-auto p-3">
                {contacts.map((contact: any) => (
                  <label key={contact.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted">
                    <input type="checkbox" checked={form.selectedContacts.includes(contact.id)} onChange={() => toggleContact(contact.id)} />
                    <span>{contact.name}</span>
                    <span className="text-muted-foreground">{contact.phone ?? ""}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">{t("broadcasts.editor.audienceCount", { count: selectedContacts.length })}</div>
          </div>
        )}

        {activeTab === "variables" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("broadcasts.editor.variablesHint")}</p>
            {variables.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {variables.map((variable: any) => <span key={variable.key} className="rounded-full bg-muted px-3 py-1 text-xs">{variable.key}</span>)}
              </div>
            )}
            <textarea value={form.variableMapping} onChange={(event) => setForm({ ...form, variableMapping: event.target.value })} rows={8} dir="ltr" className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm" />
          </div>
        )}

        {activeTab === "schedule" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">{t("broadcasts.editor.fields.scheduleMode")}</span>
              <select value={form.scheduleMode} onChange={(event) => setForm({ ...form, scheduleMode: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2">
                <option value="now">{t("common.sendNow")}</option>
                <option value="scheduled">{t("common.schedule")}</option>
              </select>
            </label>
            {form.scheduleMode === "scheduled" && (
              <label className="space-y-1 text-sm">
                <span className="font-medium">{t("broadcasts.editor.fields.scheduledAt")}</span>
                <input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} className="w-full rounded-lg border border-input bg-background px-3 py-2" />
              </label>
            )}
          </div>
        )}

        {activeTab === "review" && (
          <div className="space-y-3 text-sm">
            <div><span className="font-semibold">{t("broadcasts.editor.fields.name")}:</span> {form.name || "—"}</div>
            <div><span className="font-semibold">{t("broadcasts.editor.fields.template")}:</span> {selectedTemplate?.name ?? "—"}</div>
            <div><span className="font-semibold">{t("broadcasts.table.audience")}:</span> {selectedContacts.length}</div>
            <div><span className="font-semibold">{t("broadcasts.table.scheduledAt")}:</span> {form.scheduleMode === "scheduled" ? form.scheduledAt || "—" : t("common.sendNow")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
