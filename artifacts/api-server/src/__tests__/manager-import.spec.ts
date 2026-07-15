import { describe, expect, it } from "vitest";
import { parseManagerInventory, parseNumeric } from "../modules/products/manager-import";

// استيراد مخزون Manager (15 يوليو 2026، أول عميل يدفع — Manager Desktop محلي). التحليل النقيّ يجب أن
// يتحمّل: عناوين إنجليزية/عربية، لصق TSV (من clipboard) أو CSV، وأرقاماً بفواصل آلاف/رموز عملة.

describe("parseNumeric — تنظيف أرقام Manager", () => {
  it("يزيل فواصل الآلاف", () => expect(parseNumeric("1,000.50")).toBe(1000.5));
  it("يزيل رمز العملة والمسافات", () => expect(parseNumeric("SAR 250")).toBe(250));
  it("فارغ/غير رقمي → null", () => { expect(parseNumeric("")).toBeNull(); expect(parseNumeric(undefined)).toBeNull(); expect(parseNumeric("—")).toBeNull(); });
  it("رقم عادي", () => expect(parseNumeric("45000")).toBe(45000));
});

describe("parseManagerInventory — عناوين إنجليزية، لصق TSV", () => {
  const tsv = [
    "Item Code\tItem Name\tUnit name\tSale Price\tQty on hand",
    "P-001\tعطر عود ملكي\tقطعة\t45,000.00\t12",
    "P-002\tبخور فاخر\t\t15000\t3",
  ].join("\n");
  const r = parseManagerInventory(tsv);

  it("يتعرّف على العنوان ويطابق الأعمدة", () => {
    expect(r.headerFound).toBe(true);
    expect(r.mappedColumns.name).toBe("item name");
    expect(r.mappedColumns.sku).toBe("item code");
    expect(r.mappedColumns.price).toBe("sale price");
    expect(r.mappedColumns.quantityAvailable).toBe("qty on hand");
  });
  it("يحوّل الصفوف بأرقام نظيفة", () => {
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ name: "عطر عود ملكي", sku: "P-001", price: 45000, quantityAvailable: 12, unit: "قطعة" });
    expect(r.rows[1]).toMatchObject({ name: "بخور فاخر", sku: "P-002", price: 15000, quantityAvailable: 3, unit: null });
  });
});

describe("parseManagerInventory — عناوين عربية، CSV", () => {
  const csv = ['الكود,الاسم,السعر,الكمية', 'A1,منتج تجريبي,"1,250",7'].join("\n");
  const r = parseManagerInventory(csv);
  it("يطابق العناوين العربية ويحترم الاقتباس في CSV", () => {
    expect(r.headerFound).toBe(true);
    expect(r.rows[0]).toMatchObject({ name: "منتج تجريبي", sku: "A1", price: 1250, quantityAvailable: 7 });
  });
});

describe("parseManagerInventory — حالات حدّية", () => {
  it("صفّ بلا اسم يُتخطّى", () => {
    const r = parseManagerInventory(["Item Name\tSale Price", "\t500", "منتج\t300"].join("\n"));
    expect(r.skipped).toBe(1);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].name).toBe("منتج");
  });
  it("بلا عمود اسم → headerFound=false", () => {
    const r = parseManagerInventory(["Code\tPrice", "X\t100"].join("\n"));
    expect(r.headerFound).toBe(false);
    expect(r.rows).toHaveLength(0);
  });
  it("الكمية تُقرّب لعدد صحيح", () => {
    const r = parseManagerInventory(["Name\tQty on hand", "منتج\t5.0"].join("\n"));
    expect(r.rows[0].quantityAvailable).toBe(5);
  });
  it("نصّ فارغ أو سطر واحد → لا صفوف", () => {
    expect(parseManagerInventory("").rows).toHaveLength(0);
    expect(parseManagerInventory("Item Name").rows).toHaveLength(0);
  });
});
