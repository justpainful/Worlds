import { describe, expect, it } from "vitest";
import {
  colToName,
  cycleRefAbsolute,
  evaluateWorkbook,
  generateAutofillValue,
  nameToCol,
  newSheet,
  shiftFormulaReferences,
  type WorkbookData,
} from "./engine";

describe("spreadsheet engine", () => {
  it("converts column indices and names accurately", () => {
    expect(colToName(0)).toBe("A");
    expect(colToName(25)).toBe("Z");
    expect(colToName(26)).toBe("AA");
    expect(colToName(51)).toBe("AZ");
    expect(nameToCol("A")).toBe(0);
    expect(nameToCol("Z")).toBe(25);
    expect(nameToCol("AA")).toBe(26);
    expect(nameToCol("AZ")).toBe(51);
  });

  it("evaluates math, conditional, lookup, financial, and cross-sheet formulas", () => {
    const s1 = newSheet("Sales");
    s1.cells["A1"] = { v: "Item" };
    s1.cells["B1"] = { v: "Price" };
    s1.cells["A2"] = { v: "Laptop" };
    s1.cells["B2"] = { v: "4500" };
    s1.cells["A3"] = { v: "Monitor" };
    s1.cells["B3"] = { v: "1200" };
    s1.cells["A4"] = { v: "Keyboard" };
    s1.cells["B4"] = { v: "300" };
    s1.cells["B5"] = { v: "=SUM(B2:B4)" };
    s1.cells["B6"] = { v: '=SUMIF(B2:B4, ">=1000")' };
    s1.cells["B7"] = { v: '=VLOOKUP("Monitor", A2:B4, 2, FALSE)' };
    s1.cells["B8"] = { v: '=XLOOKUP("Keyboard", A2:A4, B2:B4, "Missing")' };
    s1.cells["B9"] = { v: '=IF(B5>5000, "Target Met", "Below")' };
    s1.cells["B10"] = { v: '=IFERROR(10/0, "Safe")' };

    const s2 = newSheet("Summary");
    s2.cells["A1"] = { v: "=Sales!B5 * 1.15" };

    const wb: WorkbookData = { sheets: [s1, s2], activeSheetId: s1.id };
    const ev = evaluateWorkbook(wb);

    expect(ev[s1.id]["B5"].value).toBe(6000);
    expect(ev[s1.id]["B6"].value).toBe(5700);
    expect(ev[s1.id]["B7"].value).toBe(1200);
    expect(ev[s1.id]["B8"].value).toBe(300);
    expect(ev[s1.id]["B9"].value).toBe("Target Met");
    expect(ev[s1.id]["B10"].value).toBe("Safe");
    expect(ev[s2.id]["A1"].value).toBeCloseTo(6900, 5);
  });

  it("detects circular references with #CYCLE!", () => {
    const s1 = newSheet("Cycle");
    s1.cells["A1"] = { v: "=B1 + 1" };
    s1.cells["B1"] = { v: "=A1 + 1" };
    const ev = evaluateWorkbook({ sheets: [s1], activeSheetId: s1.id });
    expect(ev[s1.id]["A1"].error).toBe("#CYCLE!");
    expect(ev[s1.id]["B1"].error).toBe("#CYCLE!");
  });

  it("shifts relative references while keeping $ absolute references intact", () => {
    expect(shiftFormulaReferences("=A1+$B$1+$C2+D$3", 2, 1)).toBe("=B3+$B$1+$C4+E$3");
  });

  it("cycles relative and absolute coordinates on F4 (cycleRefAbsolute)", () => {
    const step1 = cycleRefAbsolute("=SUM(A1:B5)", 6);
    expect(step1.formula).toBe("=SUM($A$1:B5)");
    const step2 = cycleRefAbsolute(step1.formula, 6);
    expect(step2.formula).toBe("=SUM(A$1:B5)");
    const step3 = cycleRefAbsolute(step2.formula, 6);
    expect(step3.formula).toBe("=SUM($A1:B5)");
    const step4 = cycleRefAbsolute(step3.formula, 6);
    expect(step4.formula).toBe("=SUM(A1:B5)");
  });

  it("autofills numeric series, weekdays, dates, and relative formulas", () => {
    const numFill = generateAutofillValue(
      [
        { r: 0, c: 0, cell: { v: "10" } },
        { r: 1, c: 0, cell: { v: "20" } },
      ],
      2,
      0,
      0,
    );
    expect(numFill.v).toBe("30");

    const dayFill = generateAutofillValue([{ r: 0, c: 0, cell: { v: "الأحد" } }], 1, 0, 0);
    expect(dayFill.v).toBe("الإثنين");

    const formulaFill = generateAutofillValue([{ r: 1, c: 2, cell: { v: "=A2*B2+$D$1" } }], 2, 2, 0);
    expect(formulaFill.v).toBe("=A3*B3+$D$1");
  });
});
