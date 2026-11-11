import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { createXlsxWorkbook } from "../src/xlsx-writer"

describe("createXlsxWorkbook", () => {
  it("writes an empty table without failing", async () => {
    const file = await createXlsxWorkbook([
      { name: "Empty", header: [], rows: [] },
      { name: "Summary", header: ["metric", "value"], rows: [["a", 1]] },
    ])

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(file.buffer)
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      "Empty",
      "Summary",
    ])
    expect(workbook.getWorksheet("Summary")?.getCell("A2").value).toBe("a")
  })
})
