// استيراد مخزون من Manager (manager.io) — منطق تحليل نقيّ بلا DB، قابل للاختبار مباشرة.
// العميل الأول (15 يوليو 2026) يستخدم Manager Desktop (محلي، لا API سحابي)، فالمسار المضمون =
// ينسخ قائمة المخزون من Manager ويلصقها/يرفعها، ونحوّلها لمنتجات وصال. Manager Desktop «Copy to
// clipboard» ينتج TSV (فواصل tab)، والتصدير CSV ينتج فواصل فاصلة — ندعم الاثنين. العناوين قد تكون
// إنجليزية أو عربية وبأعمدة مختلفة حسب إعداد العميل، فالمطابقة بمرادفات لا بموضع ثابت.

export type ParsedProductRow = {
  name: string;
  sku: string | null;
  price: number | null;
  cost: number | null;
  quantityAvailable: number | null;
  unit: string | null;
};

export type ManagerParseResult = {
  rows: ParsedProductRow[];
  skipped: number;                       // صفوف بلا اسم منتج (تُتجاهَل)
  headerFound: boolean;                  // هل تعرّفنا على عمود الاسم على الأقل؟
  mappedColumns: Partial<Record<keyof ParsedProductRow, string>>; // الحقل → عنوان العمود المطابق (تشخيص)
};

// مرادفات العناوين (إنجليزي + عربي)، مطابقة تامّة بعد التطبيع. لا نضيف «qty owned» عمداً — المطلوب
// «qty on hand» (القابل للبيع). العناوين مطبَّعة: trim + خفض حالة + تجميع المسافات.
const FIELD_ALIASES: Array<[keyof ParsedProductRow, string[]]> = [
  ["name", ["item name", "name", "product", "product name", "الاسم", "اسم", "المنتج", "الصنف", "اسم الصنف", "اسم المنتج"]],
  ["sku", ["item code", "code", "sku", "الكود", "كود", "الرمز", "رمز", "رقم الصنف"]],
  ["price", ["sale price", "sales price", "unit price", "selling price", "price", "السعر", "سعر البيع", "سعر"]],
  ["cost", ["purchase price", "cost", "unit cost", "التكلفة", "الكلفة", "سعر الشراء"]],
  ["quantityAvailable", ["qty on hand", "quantity on hand", "quantity", "qty", "stock", "on hand", "الكمية على اليد", "الكمية", "المتوفر", "الرصيد", "الكمية المتوفرة", "المخزون"]],
  ["unit", ["unit name", "unit", "الوحدة", "وحدة"]],
];

function normalizeHeader(cell: string): string {
  return cell.replace(/["'*]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// تحليل رقم من نصّ Manager: يزيل رموز العملة وفواصل الآلاف والمسافات، ويُبقي الأرقام والنقطة والسالب.
// افتراض: الفاصلة العشرية نقطة (إعداد Manager الإنجليزي الافتراضي).
export function parseNumeric(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,\s ]/g, "").replace(/[^\d.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// تقسيم سطر واحد مع احترام علامات الاقتباس المزدوجة (لحالة CSV بقيم فيها الفاصل).
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseManagerInventory(text: string): ManagerParseResult {
  const empty: ManagerParseResult = { rows: [], skipped: 0, headerFound: false, mappedColumns: {} };
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return empty;

  // كشف الفاصل: tab (لصق Manager) أو فاصلة (CSV) — أيّهما أكثر في سطر العنوان.
  const headerLine = lines[0];
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const delimiter = tabs >= commas ? "\t" : ",";

  const headerCells = splitLine(headerLine, delimiter).map(normalizeHeader);
  const columnMap: Partial<Record<keyof ParsedProductRow, number>> = {};
  const mappedColumns: Partial<Record<keyof ParsedProductRow, string>> = {};
  for (const [field, aliases] of FIELD_ALIASES) {
    if (columnMap[field] !== undefined) continue;
    const idx = headerCells.findIndex((h) => aliases.includes(h));
    if (idx >= 0) {
      columnMap[field] = idx;
      mappedColumns[field] = headerCells[idx];
    }
  }

  if (columnMap.name === undefined) return { ...empty, mappedColumns };

  const rows: ParsedProductRow[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delimiter);
    const at = (field: keyof ParsedProductRow): string | undefined => {
      const idx = columnMap[field];
      return idx === undefined ? undefined : cells[idx];
    };
    const name = (at("name") ?? "").trim();
    if (!name) { skipped += 1; continue; }
    rows.push({
      name: name.slice(0, 200),
      sku: (at("sku") ?? "").trim().slice(0, 100) || null,
      price: parseNumeric(at("price")),
      cost: parseNumeric(at("cost")),
      quantityAvailable: (() => { const n = parseNumeric(at("quantityAvailable")); return n === null ? null : Math.round(n); })(),
      unit: (at("unit") ?? "").trim().slice(0, 50) || null,
    });
  }

  return { rows, skipped, headerFound: true, mappedColumns };
}
