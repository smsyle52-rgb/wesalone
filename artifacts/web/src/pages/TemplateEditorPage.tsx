import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Plus, Send, Save, Trash2, TriangleAlert, Upload, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TemplateWhatsAppPreview } from "@/components/TemplateWhatsAppPreview";

// ─── Shared types (used by TemplateWhatsAppPreview) ─────────────────────────

export type HeaderFormat = "none" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

export type ButtonDraft =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string }
  | { type: "URL"; text: string; url: string; example?: string }
  | { type: "COPY_CODE"; example: string }
  | { type: "OTP" };

// ─── Utilities ───────────────────────────────────────────────────────────────

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

function getVarNumbers(text: string): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const m of (text || "").matchAll(/\{\{(\d+)\}\}/g)) {
    const n = parseInt(m[1]);
    if (!seen.has(n)) { seen.add(n); ordered.push(n); }
  }
  return ordered;
}

function renumberBody(text: string): { text: string; oldToNew: Map<number, number> } {
  const ordered = getVarNumbers(text);
  if (ordered.every((n, i) => n === i + 1)) return { text, oldToNew: new Map() };
  const oldToNew = new Map(ordered.map((old, i) => [old, i + 1] as [number, number]));
  let result = text;
  for (const [old, next] of oldToNew) result = result.replaceAll(`{{${old}}}`, `__V${next}__`);
  for (let i = 1; i <= oldToNew.size; i++) result = result.replaceAll(`__V${i}__`, `{{${i}}}`);
  return { text: result, oldToNew };
}

function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  current: string,
  insertion: string,
): { value: string; cursor: number } {
  const pos = el?.selectionStart ?? current.length;
  const before = current.slice(0, pos);
  const after = current.slice(pos);
  const sp1 = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const sp2 = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const full = sp1 + insertion + sp2;
  return { value: before + full + after, cursor: pos + full.length };
}

function getButtonValidationError(buttons: ButtonDraft[], category: string): string | null {
  if (!buttons.length) return null;
  const types = buttons.map((b) => b.type);
  const hasQR = types.some((t) => t === "QUICK_REPLY");
  const hasOTP = types.some((t) => t === "OTP");
  const hasCopy = types.some((t) => t === "COPY_CODE");
  const hasCTA = types.some((t) => t === "PHONE_NUMBER" || t === "URL");
  if (hasQR && hasCTA) return "لا يمكن دمج الردود السريعة مع أزرار الإجراء";
  if (hasOTP && buttons.length > 1) return "زر OTP يجب أن يكون بمفرده";
  if ((hasOTP || hasCopy) && category !== "authentication") return "أزرار OTP ونسخ الكود متاحة فقط لفئة المصادقة";
  if (category === "authentication" && hasCTA) return "فئة المصادقة لا تدعم أزرار الهاتف أو الروابط";
  const ctaCount = types.filter((t) => t === "PHONE_NUMBER" || t === "URL").length;
  if (ctaCount > 2) return "الحد الأقصى زرين من نوع الإجراء (هاتف + رابط)";
  if (types.filter((t) => t === "QUICK_REPLY").length > 10) return "الحد الأقصى 10 ردود سريعة";
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TemplateEditorPage({ templateId }: { templateId?: string }) {
  const { t } = useTranslation("pages");
  const [, setLocation] = useLocation();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // General
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("ar");
  const [category, setCategory] = useState<"marketing" | "utility" | "authentication">("utility");
  const [channelAccountId, setChannelAccountId] = useState("");
  const [status, setStatus] = useState("draft");

  // Header
  const [headerFormat, setHeaderFormat] = useState<HeaderFormat>("none");
  const [headerText, setHeaderText] = useState("");
  const [headerVarExample, setHeaderVarExample] = useState("");
  const [headerHandle, setHeaderHandle] = useState(""); // Media upload handle from Meta
  const [headerUploadState, setHeaderUploadState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Body
  const [bodyText, setBodyText] = useState("");
  const [bodyVarExamples, setBodyVarExamples] = useState<Record<number, string>>({});
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);

  // Footer
  const [footerText, setFooterText] = useState("");

  // Buttons
  const [buttons, setButtons] = useState<ButtonDraft[]>([]);
  const [newButtonType, setNewButtonType] = useState<ButtonDraft["type"]>("QUICK_REPLY");

  const bodyVarNums = useMemo(() => getVarNumbers(bodyText), [bodyText]);
  const headerHasVar = headerText.includes("{{1}}");
  const buttonError = useMemo(() => getButtonValidationError(buttons, category), [buttons, category]);
  const bodyVarsContiguous = bodyVarNums.every((n, i) => n === i + 1);
  const isAuthentication = category === "authentication";

  const EDITABLE_STATUSES = ["draft", "approved", "rejected", "paused", "disabled", "failed"];
  const isDraft = status === "draft";
  const isEditable = EDITABLE_STATUSES.includes(status);
  const mediaHeaderSelected = headerFormat === "IMAGE" || headerFormat === "VIDEO" || headerFormat === "DOCUMENT";
  const canSaveDraft = Boolean(name.trim() && bodyText.trim());
  const canSubmit =
    canSaveDraft &&
    !buttonError &&
    bodyVarsContiguous &&
    bodyVarNums.every((n) => bodyVarExamples[n]?.trim()) &&
    (!headerHasVar || headerVarExample.trim()) &&
    (!mediaHeaderSelected || headerHandle.trim() !== "") &&
    buttons.every((b) => {
      if (b.type === "URL") return !(b.url?.includes("{{1}}")) || (b.example && b.example.trim() !== "");
      return true;
    });

  // ─── Data loading ────────────────────────────────────────────────────────

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

    setName(template.name ?? "");
    setLanguage(template.language ?? "ar");
    setCategory(template.category ?? "utility");
    setChannelAccountId(template.channelAccountId ?? "");
    setStatus(template.status ?? "draft");

    const comps: Array<Record<string, unknown>> = Array.isArray(template.components) ? template.components : [];

    const header = comps.find((c) => c["type"] === "HEADER") as Record<string, unknown> | undefined;
    if (header) {
      setHeaderFormat((header["format"] as HeaderFormat | undefined) ?? "TEXT");
      setHeaderText((header["text"] as string) ?? "");
      const ex = (header["example"] as Record<string, unknown> | undefined);
      setHeaderVarExample((ex?.["header_text"] as string[] | undefined)?.[0] ?? "");
      const existingHandle = (ex?.["header_handle"] as string[] | undefined)?.[0] ?? "";
      setHeaderHandle(existingHandle);
      setHeaderUploadState(existingHandle ? "done" : "idle");
    } else {
      setHeaderFormat("none");
      setHeaderText("");
      setHeaderVarExample("");
      setHeaderHandle("");
      setHeaderUploadState("idle");
    }

    const body = comps.find((c) => c["type"] === "BODY") as Record<string, unknown> | undefined;
    if (body) {
      const bt = (body["text"] as string) ?? "";
      setBodyText(bt);
      const ex = (body["example"] as Record<string, unknown> | undefined);
      const bodyExArr = (ex?.["body_text"] as string[][] | undefined)?.[0] ?? [];
      const varNums = getVarNumbers(bt);
      const examples: Record<number, string> = {};
      varNums.forEach((n, i) => { examples[n] = bodyExArr[i] ?? ""; });
      setBodyVarExamples(examples);
    } else {
      setBodyText("");
      setBodyVarExamples({});
    }

    const footer = comps.find((c) => c["type"] === "FOOTER") as Record<string, unknown> | undefined;
    setFooterText((footer?.["text"] as string) ?? "");

    const buttonsComp = comps.find((c) => c["type"] === "BUTTONS") as Record<string, unknown> | undefined;
    const rawButtons = (buttonsComp?.["buttons"] as Array<Record<string, unknown>> | undefined) ?? [];
    // Normalize URL button example: string[] from API → string in UI
    const loadedButtons: ButtonDraft[] = rawButtons.map((btn) => {
      if (btn["type"] === "URL" && Array.isArray(btn["example"])) {
        return { ...btn, example: (btn["example"] as string[])[0] ?? "" } as ButtonDraft;
      }
      return btn as ButtonDraft;
    });
    setButtons(loadedButtons);
  }, [detailQuery.data]);

  // ─── Build API payload ────────────────────────────────────────────────────

  function buildPayload(renumber: boolean) {
    let finalBody = bodyText;
    let finalBodyVarExamples = bodyVarExamples;

    if (renumber) {
      const { text: rb, oldToNew } = renumberBody(bodyText);
      finalBody = rb;
      if (oldToNew.size > 0) {
        const reverseMap = new Map([...oldToNew.entries()].map(([k, v]) => [v, k] as [number, number]));
        const newExamples: Record<number, string> = {};
        getVarNumbers(rb).forEach((n) => {
          const originalN = reverseMap.get(n) ?? n;
          newExamples[n] = bodyVarExamples[originalN] ?? "";
        });
        finalBodyVarExamples = newExamples;
      }
    }

    const bodyVarNums2 = getVarNumbers(finalBody);
    const bodyExamplesArr = bodyVarNums2.map((n) => finalBodyVarExamples[n] ?? "");

    const components: unknown[] = [];

    if (headerFormat !== "none") {
      const headerComp: Record<string, unknown> = { type: "HEADER", format: headerFormat };
      if (headerFormat === "TEXT") {
        headerComp["text"] = headerText;
        if (headerHasVar && headerVarExample) {
          headerComp["example"] = { header_text: [headerVarExample] };
        }
      } else if (headerHandle) {
        headerComp["example"] = { header_handle: [headerHandle] };
      }
      components.push(headerComp);
    }

    const bodyComp: Record<string, unknown> = { type: "BODY", text: finalBody };
    if (bodyExamplesArr.length > 0) {
      bodyComp["example"] = { body_text: [bodyExamplesArr] };
    }
    components.push(bodyComp);

    if (footerText.trim()) components.push({ type: "FOOTER", text: footerText });
    if (buttons.length > 0) {
      // Meta API requires url button example as string[], not string
      const apiButtons = buttons.map((btn) => {
        if (btn.type === "URL" && typeof btn.example === "string" && btn.example) {
          return { ...btn, example: [btn.example] };
        }
        return btn;
      });
      components.push({ type: "BUTTONS", buttons: apiButtons });
    }

    return {
      name,
      language,
      category,
      channelAccountId: channelAccountId || null,
      components,
      variables: [],
    };
  }

  // ─── Media upload ─────────────────────────────────────────────────────────

  async function handleMediaUpload(file: File) {
    setHeaderUploadState("uploading");
    try {
      const channelId = channelAccountId || undefined;
      const res = await fetch(`${BASE}/templates/header-media`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": file.type,
          "x-file-name": encodeURIComponent(file.name),
          ...(channelId ? { "x-channel-account-id": channelId } : {}),
        },
        body: file,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as Record<string, string>).error ?? "فشل رفع الملف");
      }
      const data = (await res.json()) as { header_handle: string };
      setHeaderHandle(data.header_handle);
      setHeaderUploadState("done");
    } catch (err) {
      setHeaderUploadState("error");
      setMessage({ type: "err", text: (err as Error).message });
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  async function saveTemplate(renumber: boolean) {
    const payload = buildPayload(renumber);
    const result = templateId
      ? await apiFetch(`templates/${templateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await apiFetch("templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    return result.template;
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const template = await saveTemplate(true);
      setMessage({ type: "ok", text: t("templates.editor.saved") });
      if (!templateId) setLocation(`/templates/${template.id}`);
    } catch (err) {
      setMessage({ type: "err", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setSaving(true);
    setMessage(null);
    try {
      const template = await saveTemplate(true);
      await apiFetch(`templates/${template.id}/submit`, { method: "POST" });
      setMessage({ type: "ok", text: t("templates.editor.submitted") });
      setLocation("/templates");
    } catch (err) {
      setMessage({ type: "err", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  // ─── Variable insertion ───────────────────────────────────────────────────

  const insertBodyVar = useCallback(() => {
    const current = bodyText;
    const nums = getVarNumbers(current);
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    const { value, cursor } = insertAtCursor(bodyRef.current, current, `{{${next}}}`);
    setBodyText(value);
    requestAnimationFrame(() => {
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(cursor, cursor);
    });
  }, [bodyText]);

  const insertHeaderVar = useCallback(() => {
    if (headerHasVar) return;
    const { value, cursor } = insertAtCursor(headerInputRef.current, headerText, "{{1}}");
    setHeaderText(value);
    requestAnimationFrame(() => {
      headerInputRef.current?.focus();
      headerInputRef.current?.setSelectionRange(cursor, cursor);
    });
  }, [headerText, headerHasVar]);

  // ─── Button management ────────────────────────────────────────────────────

  const canAddButton = useMemo(() => {
    if (!isEditable) return false;
    const types = buttons.map((b) => b.type);
    const hasOTP = types.some((t) => t === "OTP");
    if (hasOTP) return false;
    if (isAuthentication) {
      const hasCopy = types.some((t) => t === "COPY_CODE");
      return !hasCopy;
    }
    const hasQR = types.some((t) => t === "QUICK_REPLY");
    const hasCTA = types.some((t) => t === "PHONE_NUMBER" || t === "URL");
    const ctaCount = types.filter((t) => t === "PHONE_NUMBER" || t === "URL").length;
    if (hasCTA && ctaCount >= 2) return false;
    if (hasQR && types.length >= 10) return false;
    return true;
  }, [buttons, isDraft, isAuthentication]);

  function addButton() {
    let btn: ButtonDraft;
    switch (newButtonType) {
      case "QUICK_REPLY": btn = { type: "QUICK_REPLY", text: "" }; break;
      case "PHONE_NUMBER": btn = { type: "PHONE_NUMBER", text: "", phone_number: "" }; break;
      case "URL": btn = { type: "URL", text: "", url: "" }; break;
      case "COPY_CODE": btn = { type: "COPY_CODE", example: "" }; break;
      case "OTP": btn = { type: "OTP" }; break;
    }
    setButtons((prev) => [...prev, btn]);
  }

  function updateButton(idx: number, patch: Partial<ButtonDraft>) {
    setButtons((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } as ButtonDraft : b)));
  }

  function changeButtonType(idx: number, nextType: ButtonDraft["type"]) {
    const old = buttons[idx];
    const text = "text" in old ? old.text : "";
    let btn: ButtonDraft;
    switch (nextType) {
      case "QUICK_REPLY": btn = { type: "QUICK_REPLY", text }; break;
      case "PHONE_NUMBER": btn = { type: "PHONE_NUMBER", text, phone_number: "" }; break;
      case "URL": btn = { type: "URL", text, url: "" }; break;
      case "COPY_CODE": btn = { type: "COPY_CODE", example: "" }; break;
      case "OTP": btn = { type: "OTP" }; break;
    }
    setButtons((prev) => prev.map((b, i) => (i === idx ? btn : b)));
  }

  const channelAccounts: Array<{ id: string; displayName?: string; name: string }> =
    channelsQuery.data?.accounts ?? [];

  // ─── Render ───────────────────────────────────────────────────────────────

  const fieldClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
  const sectionClass = "rounded-xl border border-border bg-card p-5 space-y-4";
  const labelClass = "block text-sm font-medium text-foreground mb-1";

  return (
    <div dir="rtl">
      <PageHeader
        title={templateId ? t("templates.editor.editTitle") : t("templates.editor.createTitle")}
        subtitle={t("templates.editor.subtitle")}
        actions={
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !canSaveDraft || !isEditable}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isDraft ? t("templates.editor.saveDraft") : t("templates.editor.saveEdits")}
            </button>
            {isDraft && (
              <button
                onClick={handleSubmit}
                disabled={saving || !canSubmit}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {t("templates.editor.submit")}
              </button>
            )}
          </div>
        }
      />

      {message && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            message.type === "ok"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-destructive/20 bg-destructive/5 text-destructive"
          }`}
        >
          {message.text}
        </div>
      )}

      {detailQuery.data?.template?.status && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t("templates.editor.currentStatus")}</span>
          <StatusBadge status={detailQuery.data.template.status} />
        </div>
      )}

      {detailQuery.data?.template?.rejectionReason && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">{t("templates.editor.rejectionReason")}</div>
            <div className="mt-0.5 text-muted-foreground">{detailQuery.data.template.rejectionReason}</div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Left: form ─────────────────────────────────────────────────── */}
        <div className="space-y-5 min-w-0">

          {/* General info */}
          <div className={sectionClass}>
            <h3 className="text-sm font-semibold text-foreground">{t("templates.editor.sections.general")}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>{t("templates.editor.fields.name")}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.replace(/ /g, "_"))}
                  disabled={!isEditable}
                  maxLength={120}
                  placeholder="my_template_name"
                  className={fieldClass}
                  dir="ltr"
                />
              </label>

              <label className="space-y-1">
                <span className={labelClass}>{t("templates.editor.fields.language")}</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={!isEditable}
                  className={fieldClass}
                >
                  <option value="ar">العربية (ar)</option>
                  <option value="en">English (en)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className={labelClass}>{t("templates.editor.fields.category")}</span>
                <select
                  value={category}
                  onChange={(e) => {
                    const cat = e.target.value as typeof category;
                    setCategory(cat);
                    if (cat === "authentication") {
                      // drop incompatible buttons
                      setButtons((prev) => prev.filter((b) => b.type === "OTP" || b.type === "COPY_CODE"));
                      setNewButtonType("COPY_CODE");
                    } else {
                      setButtons((prev) => prev.filter((b) => b.type !== "OTP" && b.type !== "COPY_CODE"));
                      setNewButtonType("QUICK_REPLY");
                    }
                  }}
                  disabled={!isEditable}
                  className={fieldClass}
                >
                  <option value="marketing">{t("templates.categories.marketing")}</option>
                  <option value="utility">{t("templates.categories.utility")}</option>
                  <option value="authentication">{t("templates.categories.authentication")}</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className={labelClass}>{t("templates.editor.fields.channelAccount")}</span>
                <select
                  value={channelAccountId}
                  onChange={(e) => setChannelAccountId(e.target.value)}
                  disabled={!isEditable}
                  className={fieldClass}
                >
                  <option value="">{t("templates.editor.fields.noChannelAccount")}</option>
                  {channelAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.displayName ?? acc.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Header */}
          <div className={sectionClass}>
            <h3 className="text-sm font-semibold text-foreground">{t("templates.editor.sections.header")}</h3>

            {/* Format selector */}
            <div className="flex flex-wrap gap-2">
              {(["none", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  disabled={!isEditable}
                  onClick={() => {
                    setHeaderFormat(fmt);
                    if (fmt !== "TEXT") { setHeaderText(""); setHeaderVarExample(""); }
                    if (fmt === "TEXT" || fmt === "none") { setHeaderHandle(""); setHeaderUploadState("idle"); }
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    headerFormat === fmt
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  } disabled:opacity-50`}
                >
                  {fmt === "none" ? t("templates.editor.header.none") : fmt}
                </button>
              ))}
            </div>

            {/* Text header input */}
            {headerFormat === "TEXT" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={labelClass}>{t("templates.editor.header.text")}</span>
                  <span className="text-xs text-muted-foreground">{headerText.length}/60</span>
                </div>
                <input
                  ref={headerInputRef}
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  disabled={!isEditable}
                  maxLength={60}
                  placeholder={t("templates.editor.header.placeholder")}
                  className={fieldClass}
                />
                {!headerHasVar && (
                  <button
                    type="button"
                    disabled={!isEditable}
                    onClick={insertHeaderVar}
                    className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    {t("templates.editor.addVariable")}
                  </button>
                )}
                {headerHasVar && (
                  <label className="block space-y-1">
                    <span className="text-xs text-muted-foreground">{t("templates.editor.header.varExample")} {"{{1}}"}</span>
                    <input
                      value={headerVarExample}
                      onChange={(e) => setHeaderVarExample(e.target.value)}
                      disabled={!isEditable}
                      placeholder={t("templates.editor.fields.exampleValue")}
                      className={fieldClass}
                    />
                  </label>
                )}
              </div>
            )}

            {headerFormat !== "none" && headerFormat !== "TEXT" && (
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={
                    headerFormat === "IMAGE" ? "image/jpeg,image/png"
                    : headerFormat === "VIDEO" ? "video/mp4"
                    : "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  }
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleMediaUpload(file);
                  }}
                />
                <button
                  type="button"
                  disabled={!isEditable || headerUploadState === "uploading"}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {headerUploadState === "uploading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {t("templates.editor.header.uploadMedia")}
                </button>
                {headerUploadState === "done" && headerHandle && (
                  <p className="text-xs text-green-700">
                    ✓ {t("templates.editor.header.mediaUploaded")}
                  </p>
                )}
                {headerUploadState === "error" && (
                  <p className="text-xs text-destructive">{t("templates.editor.header.mediaError")}</p>
                )}
                {!headerHandle && (
                  <p className="text-xs text-muted-foreground">{t("templates.editor.header.mediaNote")}</p>
                )}
              </div>
            )}
          </div>

          {/* Body */}
          <div className={sectionClass}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{t("templates.editor.sections.body")}</h3>
              <span className="text-xs text-muted-foreground">{bodyText.length}/1024</span>
            </div>

            <div className="space-y-2">
              <textarea
                ref={bodyRef}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                disabled={!isEditable}
                rows={5}
                maxLength={1024}
                placeholder={t("templates.editor.body.placeholder")}
                className={`${fieldClass} resize-none`}
              />
              <button
                type="button"
                disabled={!isEditable}
                onClick={insertBodyVar}
                className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                {t("templates.editor.addVariable")}
              </button>

              {!bodyVarsContiguous && bodyVarNums.length > 0 && (
                <p className="flex items-center gap-1 text-xs text-amber-600">
                  <TriangleAlert className="h-3 w-3 shrink-0" />
                  {t("templates.editor.body.nonContiguous")}
                </p>
              )}
            </div>

            {/* Per-variable examples */}
            {bodyVarNums.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                <span className="text-xs font-medium text-muted-foreground">{t("templates.editor.body.varExamples")}</span>
                {bodyVarNums.map((n) => (
                  <div key={n} className="flex items-center gap-2">
                    <code className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-mono">{`{{${n}}}`}</code>
                    <input
                      value={bodyVarExamples[n] ?? ""}
                      onChange={(e) => setBodyVarExamples((prev) => ({ ...prev, [n]: e.target.value }))}
                      disabled={!isEditable}
                      placeholder={t("templates.editor.fields.exampleValue")}
                      className={`${fieldClass} flex-1`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={sectionClass}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{t("templates.editor.sections.footer")}</h3>
              <span className="text-xs text-muted-foreground">{footerText.length}/60</span>
            </div>
            <input
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              disabled={!isEditable}
              maxLength={60}
              placeholder={t("templates.editor.footer.placeholder")}
              className={fieldClass}
            />
          </div>

          {/* Buttons */}
          <div className={sectionClass}>
            <h3 className="text-sm font-semibold text-foreground">{t("templates.editor.sections.buttons")}</h3>

            {buttonError && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {buttonError}
              </div>
            )}

            {/* Existing buttons */}
            <div className="space-y-3">
              {buttons.map((btn, idx) => (
                <div key={idx} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {/* Type selector per button */}
                    <select
                      value={btn.type}
                      onChange={(e) => changeButtonType(idx, e.target.value as ButtonDraft["type"])}
                      disabled={!isEditable}
                      className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
                    >
                      {!isAuthentication && <option value="QUICK_REPLY">{t("templates.editor.buttons.quickReply")}</option>}
                      {!isAuthentication && <option value="PHONE_NUMBER">{t("templates.editor.buttons.phone")}</option>}
                      {!isAuthentication && <option value="URL">{t("templates.editor.buttons.url")}</option>}
                      {isAuthentication && <option value="COPY_CODE">{t("templates.editor.buttons.copyCode")}</option>}
                      {isAuthentication && <option value="OTP">{t("templates.editor.buttons.otp")}</option>}
                    </select>
                    <button
                      type="button"
                      onClick={() => setButtons((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={!isEditable}
                      className="mr-auto text-destructive hover:text-destructive/80 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Type-specific fields */}
                  {btn.type === "QUICK_REPLY" && (
                    <input
                      value={btn.text}
                      onChange={(e) => updateButton(idx, { text: e.target.value } as Partial<ButtonDraft>)}
                      disabled={!isEditable}
                      maxLength={25}
                      placeholder={t("templates.editor.buttons.textPlaceholder")}
                      className={fieldClass}
                    />
                  )}

                  {btn.type === "PHONE_NUMBER" && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={btn.text}
                        onChange={(e) => updateButton(idx, { text: e.target.value } as Partial<ButtonDraft>)}
                        disabled={!isEditable}
                        maxLength={25}
                        placeholder={t("templates.editor.buttons.textPlaceholder")}
                        className={fieldClass}
                      />
                      <input
                        value={btn.phone_number}
                        onChange={(e) => updateButton(idx, { phone_number: e.target.value } as Partial<ButtonDraft>)}
                        disabled={!isEditable}
                        maxLength={20}
                        placeholder="+966500000000"
                        className={fieldClass}
                        dir="ltr"
                      />
                    </div>
                  )}

                  {btn.type === "URL" && (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          value={btn.text}
                          onChange={(e) => updateButton(idx, { text: e.target.value } as Partial<ButtonDraft>)}
                          disabled={!isEditable}
                          maxLength={25}
                          placeholder={t("templates.editor.buttons.textPlaceholder")}
                          className={fieldClass}
                        />
                        <input
                          value={btn.url}
                          onChange={(e) => updateButton(idx, { url: e.target.value } as Partial<ButtonDraft>)}
                          disabled={!isEditable}
                          maxLength={2000}
                          placeholder="https://example.com/{{1}}"
                          className={fieldClass}
                          dir="ltr"
                        />
                      </div>
                      {btn.url?.includes("{{1}}") && (
                        <input
                          value={btn.example ?? ""}
                          onChange={(e) => updateButton(idx, { example: e.target.value } as Partial<ButtonDraft>)}
                          disabled={!isEditable}
                          placeholder={t("templates.editor.buttons.urlExamplePlaceholder")}
                          className={fieldClass}
                          dir="ltr"
                        />
                      )}
                      {btn.url?.includes("{{1}}") && (
                        <p className="text-xs text-muted-foreground">{t("templates.editor.buttons.dynamicUrlNote")}</p>
                      )}
                    </div>
                  )}

                  {btn.type === "COPY_CODE" && (
                    <input
                      value={btn.example}
                      onChange={(e) => updateButton(idx, { example: e.target.value } as Partial<ButtonDraft>)}
                      disabled={!isEditable}
                      maxLength={15}
                      placeholder={t("templates.editor.buttons.codePlaceholder")}
                      className={fieldClass}
                      dir="ltr"
                    />
                  )}

                  {btn.type === "OTP" && (
                    <p className="text-xs text-muted-foreground">{t("templates.editor.buttons.otpNote")}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Add button row */}
            {isDraft && canAddButton && (
              <div className="flex items-center gap-2">
                <select
                  value={newButtonType}
                  onChange={(e) => setNewButtonType(e.target.value as ButtonDraft["type"])}
                  className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {!isAuthentication && <option value="QUICK_REPLY">{t("templates.editor.buttons.quickReply")}</option>}
                  {!isAuthentication && <option value="PHONE_NUMBER">{t("templates.editor.buttons.phone")}</option>}
                  {!isAuthentication && <option value="URL">{t("templates.editor.buttons.url")}</option>}
                  {isAuthentication && <option value="COPY_CODE">{t("templates.editor.buttons.copyCode")}</option>}
                  {isAuthentication && <option value="OTP">{t("templates.editor.buttons.otp")}</option>}
                </select>
                <button
                  type="button"
                  onClick={addButton}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                >
                  <Plus className="h-4 w-4" />
                  {t("templates.editor.addButton")}
                </button>
              </div>
            )}

            {buttons.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("templates.editor.buttons.empty")}</p>
            )}
          </div>
        </div>

        {/* ── Right: preview ──────────────────────────────────────────────── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t("templates.editor.previewTitle")}</h3>
            <TemplateWhatsAppPreview
              headerFormat={headerFormat}
              headerText={headerText}
              headerVarExample={headerVarExample}
              bodyText={bodyText}
              bodyVarExamples={bodyVarExamples}
              footerText={footerText}
              buttons={buttons}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
