import * as React from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "./dialog";
import { cn } from "@/lib/utils";

// تأكيد موحّد يستبدل window.confirm الأصلي (غير المنسّق، الحاجب لخيط الواجهة، الأعمى عن RTL والثيم،
// الكاسر لأي اختبار آلي). واجهة أمرية بسيطة: `await confirmDialog("رسالة")` → Promise<boolean> —
// أقل تغيير ممكن في مواقع الاستدعاء. الزرّ الأحمر يظهر تلقائياً لرسائل الحذف (تحوي «حذف») تمييزاً
// للإجراء غير القابل للتراجع؛ الأرشفة/الدمج تبقى بالزرّ الأساسي المحايد.

type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type OpenFn = (opts: ConfirmOptions) => Promise<boolean>;
let openConfirm: OpenFn | null = null;

export function confirmDialog(input: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof input === "string" ? { description: input } : input;
  // احتياط: لو لم يُركَّب المضيف بعد (نادر جداً) نتراجع لتأكيد المتصفح حتى لا نفقد بوابة التأكيد.
  if (!openConfirm) return Promise.resolve(window.confirm(opts.description ?? ""));
  return openConfirm(opts);
}

// يُركَّب مرّة واحدة قرب جذر التطبيق. لا يغيّر أي تخطيط (overlay/portal فقط — محمية سطح المكتب lg+).
export function ConfirmDialogHost() {
  const [state, setState] = React.useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  React.useEffect(() => {
    openConfirm = (opts) => new Promise<boolean>((resolve) => setState({ opts, resolve }));
    return () => { openConfirm = null; };
  }, []);

  const finish = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  const opts = state?.opts;
  const danger = opts?.danger ?? /حذف/.test(opts?.description ?? "");

  return (
    <Dialog open={!!state} onOpenChange={(open) => { if (!open) finish(false); }}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>{opts?.title ?? "تأكيد"}</DialogTitle>
          {opts?.description ? (
            <DialogDescription className="pt-1 text-right leading-relaxed whitespace-pre-line">
              {opts.description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={() => finish(false)}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            {opts?.cancelText ?? "إلغاء"}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => finish(true)}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-medium",
              danger
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {opts?.confirmText ?? "تأكيد"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
