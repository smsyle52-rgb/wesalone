// استخراج نص ملف المعرفة في المتصفح (نفس فلسفة ضغط الصور بالـCanvas في imageUpload.ts):
// المعالجة الثقيلة تتم هنا، والخادم يستقبل نصّاً جاهزاً فقط — فيبقى bundle الخادم
// بلا مكتبات استخراج أو native deps (قيد runtime: api-server حزمة esbuild واحدة).
//
// مكتبتا pdfjs/mammoth ثقيلتان وتُحمَّلان عبر import() ديناميكي عند الرفع فقط،
// فلا تدخلان الحزمة الرئيسية ولا تبطّئان أول تحميل للتطبيق لبقية المستخدمين.

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 ميجابايت
const NULL_BYTES = new RegExp(String.fromCharCode(0), "g");
const TRAILING_WS = /[ \t]+\n/g;

// لسمة accept في حقل اختيار الملف.
export const ACCEPTED_FILE_EXTENSIONS = ".txt,.md,.markdown,.csv,.json,.pdf,.docx";

/** يستخرج نصّاً نظيفاً من ملف نصّي/PDF/Word في المتصفح. يرمي رسالة عربية واضحة عند الفشل. */
export async function extractTextFromFile(file: File): Promise<{ text: string; charCount: number }> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("حجم الملف كبير جداً (الحد الأقصى 20 ميجابايت).");
  }

  const name = file.name.toLowerCase();
  let raw = "";

  if (name.endsWith(".pdf")) {
    raw = await extractPdf(file);
  } else if (name.endsWith(".docx")) {
    raw = await extractDocx(file);
  } else if (/\.(txt|md|markdown|csv|json|text)$/.test(name) || file.type.startsWith("text/")) {
    raw = await file.text();
  } else {
    throw new Error("نوع ملف غير مدعوم. المدعوم: نص (txt/md/csv)، PDF، أو Word (.docx).");
  }

  const text = raw.replace(NULL_BYTES, "").replace(TRAILING_WS, "\n").trim();
  if (!text) {
    throw new Error("تعذّر استخراج نص من الملف (قد يكون صورة ممسوحة ضوئياً بلا نص).");
  }
  return { text, charCount: text.length };
}

async function extractPdf(file: File): Promise<string> {
  const [pdfjsLib, workerMod] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push(pageText);
    }
    return pages.join("\n\n");
  } finally {
    await pdf.destroy();
  }
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value ?? "";
}
