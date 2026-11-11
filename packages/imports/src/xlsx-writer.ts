import ExcelJS from "exceljs"

export type XlsxSheetInput = {
  /** Tab name; trimmed to Excel's 31-character limit. */
  name: string
  header: string[]
  rows: (string | number | boolean | null)[][]
  rightToLeft?: boolean
}

// Excel forbids these in sheet names.
const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g
// A cell starting with these runs as a formula when opened (CSV/XLSX injection).
const FORMULA_PREFIX = /^[=+\-@\t\r]/

const safeCell = (value: string | number | boolean | null) =>
  typeof value === "string" && FORMULA_PREFIX.test(value) ? `'${value}` : value

/** Writes plain tables to an .xlsx file, one sheet per table. */
export const createXlsxWorkbook = async (
  sheets: XlsxSheetInput[],
): Promise<Uint8Array<ArrayBuffer>> => {
  const workbook = new ExcelJS.Workbook()
  const used = new Set<string>()
  for (const sheet of sheets) {
    let name =
      sheet.name.replace(INVALID_SHEET_CHARS, " ").trim().slice(0, 31) ||
      "Sheet"
    for (let i = 2; used.has(name); i++) {
      name = `${name.slice(0, 28)} ${i}`
    }
    used.add(name)
    const ws = workbook.addWorksheet(name, {
      views: [
        { rightToLeft: Boolean(sheet.rightToLeft), state: "frozen", ySplit: 1 },
      ],
    })
    ws.addRow(sheet.header).font = { bold: true }
    for (const row of sheet.rows) {
      ws.addRow(row.map(safeCell))
    }
    // ExcelJS returns null columns for a sheet with no cells (an empty table).
    for (const column of ws.columns ?? []) {
      column.width = 18
    }
  }
  const data = await workbook.xlsx.writeBuffer()
  return new Uint8Array(data as ArrayBuffer)
}
