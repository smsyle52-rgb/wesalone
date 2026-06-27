import { Phone, ExternalLink, Copy, Key, Image, Video, FileText, CornerDownLeft } from "lucide-react";
import type { ButtonDraft, HeaderFormat } from "@/pages/TemplateEditorPage";

interface Props {
  headerFormat: HeaderFormat;
  headerText: string;
  headerVarExample: string;
  bodyText: string;
  bodyVarExamples: Record<number, string>;
  footerText: string;
  buttons: ButtonDraft[];
}

function renderWithVars(text: string, examples: Record<number, string>) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) {
    const n = parseInt(m[1]);
    if ((m.index ?? 0) > last) parts.push(<span key={k++}>{text.slice(last, m.index)}</span>);
    const ex = examples[n];
    parts.push(
      ex ? (
        <span key={k++} className="font-semibold" style={{ color: "#1a7f64" }}>{ex}</span>
      ) : (
        <span key={k++} style={{ background: "#fef3c7", color: "#92400e", borderRadius: 2, padding: "0 2px" }}>{`{{${n}}}`}</span>
      ),
    );
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < text.length) parts.push(<span key={k++}>{text.slice(last)}</span>);
  return parts;
}

export function TemplateWhatsAppPreview({
  headerFormat,
  headerText,
  headerVarExample,
  bodyText,
  bodyVarExamples,
  footerText,
  buttons,
}: Props) {
  const renderedHeader =
    headerFormat === "TEXT" && headerText
      ? renderWithVars(headerText, headerVarExample ? { 1: headerVarExample } : {})
      : null;

  const renderedBody = renderWithVars(bodyText || "أهلاً، هذا قالب رسالة واتساب.", bodyVarExamples);

  return (
    <div dir="ltr" className="rounded-2xl overflow-hidden border border-border shadow-sm text-left">
      {/* WA header bar */}
      <div className="px-3 py-2.5 flex items-center gap-2.5" style={{ background: "#1f7a68" }}>
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white/90 shrink-0"
          style={{ background: "rgba(255,255,255,0.15)" }}
        >
          و
        </div>
        <div className="text-sm font-semibold text-white">عملك</div>
      </div>

      {/* Chat area */}
      <div className="p-3" style={{ background: "#efeae2", minHeight: 160 }}>
        <div className="max-w-[88%] ml-auto">
          {/* Main bubble */}
          <div className="rounded-2xl rounded-tr-none overflow-hidden shadow-sm" style={{ background: "#d9fdd3" }}>
            {/* Header media placeholders */}
            {headerFormat === "IMAGE" && (
              <div className="flex items-center justify-center h-28" style={{ background: "#c5c5c5" }}>
                <Image className="w-8 h-8 text-white/70" />
              </div>
            )}
            {headerFormat === "VIDEO" && (
              <div className="flex items-center justify-center h-28" style={{ background: "#c5c5c5" }}>
                <Video className="w-8 h-8 text-white/70" />
              </div>
            )}
            {headerFormat === "DOCUMENT" && (
              <div className="flex items-center gap-2 m-2 px-3 py-2 rounded-lg" style={{ background: "#f0f2f5" }}>
                <FileText className="w-5 h-5 shrink-0" style={{ color: "#667781" }} />
                <span className="text-xs" style={{ color: "#667781" }}>مستند.pdf</span>
              </div>
            )}

            {/* Header text */}
            {renderedHeader && (
              <div className="px-3 pt-2.5 text-sm font-semibold text-[#111b21]" dir="rtl">
                {renderedHeader}
              </div>
            )}

            {/* Body */}
            <div className="px-3 py-2 text-sm text-[#111b21] whitespace-pre-wrap leading-[1.5]" dir="rtl">
              {renderedBody}
            </div>

            {/* Footer */}
            {footerText && (
              <div className="px-3 pb-1.5 text-xs leading-4" style={{ color: "#667781" }} dir="rtl">
                {footerText}
              </div>
            )}

            {/* Timestamp */}
            <div className="px-3 pb-2 flex justify-end">
              <span className="text-[10px]" style={{ color: "#667781" }}>
                12:34 ✓✓
              </span>
            </div>
          </div>

          {/* Buttons — each gets its own bubble */}
          {buttons.length > 0 && (
            <div
              className="mt-[1px] rounded-b-2xl overflow-hidden shadow-sm"
              style={{ background: "#d9fdd3" }}
            >
              {buttons.map((btn, idx) => (
                <div key={idx}>
                  {idx > 0 && <div className="mx-3" style={{ borderTop: "1px solid #c1ebc1" }} />}
                  <button
                    type="button"
                    className="w-full py-2 px-3 text-xs font-medium flex items-center justify-center gap-1"
                    style={{ color: "#009de0" }}
                  >
                    {btn.type === "QUICK_REPLY" && <CornerDownLeft className="w-3.5 h-3.5" />}
                    {btn.type === "PHONE_NUMBER" && <Phone className="w-3.5 h-3.5" />}
                    {btn.type === "URL" && <ExternalLink className="w-3.5 h-3.5" />}
                    {btn.type === "COPY_CODE" && <Copy className="w-3.5 h-3.5" />}
                    {btn.type === "OTP" && <Key className="w-3.5 h-3.5" />}
                    <span>
                      {btn.type === "QUICK_REPLY" && (btn.text || "رد سريع")}
                      {btn.type === "PHONE_NUMBER" && (btn.text || "اتصل بنا")}
                      {btn.type === "URL" && (btn.text || "اعرف المزيد")}
                      {btn.type === "COPY_CODE" && `نسخ: ${btn.example || "..."}`}
                      {btn.type === "OTP" && "نسخ الكود"}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
