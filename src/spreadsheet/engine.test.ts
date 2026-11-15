import { describe, expect, it } from "vitest";
import {
  colToName,
  conditionalStyle,
  type ConditionalRule,
  type EvaluatedCell,
  cycleRefAbsolute,
  evaluateWorkbook,
  generateAutofillValue,
  nameToCol,
  newSheet,
  shiftFormulaReferences,
  shiftSheetStructure,
  shiftSpan,
  westernDigits,
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

describe("conditional formatting", () => {
  const num = (n: number): EvaluatedCell => ({ raw: String(n), value: n, display: String(n), error: null, isFormula: false, numeric: n });
  const txt = (s: string): EvaluatedCell => ({ raw: s, value: s, display: s, error: null, isFormula: false, numeric: null });
  const rule = (op: ConditionalRule["op"], value: string, value2?: string): ConditionalRule => ({ id: "r", range: "F2:F6", op, value, value2, bg: "#dcfce7", color: "#14532d" });
  // F3 is row 2, column 5.
  it("colours numbers above a value inside the range only", () => {
    expect(conditionalStyle([rule("gt", "90")], 2, 5, num(94))).toEqual({ bg: "#dcfce7", color: "#14532d" });
    expect(conditionalStyle([rule("gt", "90")], 2, 5, num(87))).toBeNull();
    expect(conditionalStyle([rule("gt", "90")], 7, 5, num(99))).toBeNull();
    expect(conditionalStyle([rule("gt", "90")], 2, 4, num(99))).toBeNull();
  });
  it("handles less than, between, equals, contains and not empty", () => {
    expect(conditionalStyle([rule("lt", "50")], 1, 5, num(20))).not.toBeNull();
    expect(conditionalStyle([rule("between", "80", "70")], 1, 5, num(75))).not.toBeNull();
    expect(conditionalStyle([rule("between", "80", "70")], 1, 5, num(85))).toBeNull();
    expect(conditionalStyle([rule("eq", "A")], 1, 5, txt("A"))).not.toBeNull();
    expect(conditionalStyle([rule("eq", "10")], 1, 5, num(10))).not.toBeNull();
    expect(conditionalStyle([rule("contains", "bio")], 1, 5, txt("Biology"))).not.toBeNull();
    expect(conditionalStyle([rule("notEmpty", "")], 1, 5, txt(" "))).toBeNull();
    expect(conditionalStyle([rule("gt", "1")], 1, 5, undefined)).toBeNull();
  });
  it("ignores errors and broken ranges", () => {
    expect(conditionalStyle([rule("notEmpty", "")], 1, 5, { ...txt("#DIV/0!"), error: "#DIV/0!" })).toBeNull();
    expect(conditionalStyle([{ ...rule("gt", "1"), range: "nope" }], 1, 5, num(5))).toBeNull();
  });
});

describe("inserting and deleting rows and columns", () => {
  it("shrinks a range that loses its edge instead of breaking it", () => {
    expect(shiftSpan(1, 9, 9, -1)).toEqual([1, 8]);
    expect(shiftSpan(1, 9, 1, -1)).toEqual([1, 8]);
    expect(shiftSpan(4, 4, 4, -1)).toBeNull();
    expect(shiftSpan(1, 9, 5, 1)).toEqual([1, 10]);
    expect(shiftSpan(1, 9, 0, 1)).toEqual([2, 10]);
  });

  it("keeps formulas, other sheets and quoted text right when a row goes", () => {
    const sh = newSheet("Grades");
    sh.cells["B2"] = { v: "10" };
    sh.cells["B10"] = { v: "5" };
    sh.cells["C1"] = { v: "=SUM(B2:B10)" };
    sh.cells["C2"] = { v: "=Other!B10+B10" };
    sh.cells["C3"] = { v: "=CONCAT(\"B10\", LOG10(B2))" };
    sh.cells["C4"] = { v: "=Grades!B10" };
    const out = shiftSheetStructure(sh, "row", 9, -1);
    expect(out.cells["C1"].v).toBe("=SUM(B2:B9)");
    expect(out.cells["C2"].v).toBe("=Other!B10+#REF!");
    expect(out.cells["C3"].v).toBe("=CONCAT(\"B10\", LOG10(B2))");
    expect(out.cells["C4"].v).toBe("=#REF!");
    expect(out.cells["B10"]).toBeUndefined();
  });

  it("moves widths, merges, highlights and frozen panes with the cells", () => {
    const sh = newSheet("S");
    sh.colWidths = { 0: 80, 2: 140 };
    sh.merges = [{ r1: 0, c1: 2, r2: 0, c2: 3 }];
    sh.conditionalRules = [{ id: "r", range: "C2:D20", op: "gt", value: "5", bg: "#000", color: "#fff" }];
    sh.frozenCols = 2;
    const ins = shiftSheetStructure(sh, "col", 1, 1);
    expect(ins.colWidths).toEqual({ 0: 80, 3: 140 });
    expect(ins.merges).toEqual([{ r1: 0, c1: 3, r2: 0, c2: 4 }]);
    expect(ins.conditionalRules[0].range).toBe("D2:E20");
    expect(ins.frozenCols).toBe(3);
    const del = shiftSheetStructure(sh, "col", 3, -1);
    expect(del.merges).toEqual([]);
    expect(del.conditionalRules[0].range).toBe("C2:C20");
    expect(del.frozenCols).toBe(2);
  });
});

describe("Arabic digits", () => {
  it("counts cells and formulas typed with an Arabic keyboard as numbers", () => {
    expect(westernDigits("٣٫٥٪")).toBe("3.5%");
    const s = newSheet("درجات ٢");
    s.cells["A1"] = { v: "٩٥" };
    s.cells["A2"] = { v: "12.5" };
    s.cells["A3"] = { v: "٣٫٥" };
    s.cells["A4"] = { v: "=SUM(A1:A3)" };
    s.cells["A5"] = { v: "=A1*٢" };
    s.cells["A6"] = { v: "=SUM(A1،A2)" };
    s.cells["A7"] = { v: "١٬٢٥٠" };
    s.cells["A8"] = { v: "٥٠٪" };
    s.cells["A9"] = { v: "=IF(A1>٩٠؛\"ممتاز\"؛\"جيد\")" };
    const ev = evaluateWorkbook({ sheets: [s], activeSheetId: s.id })[s.id];
    expect(ev["A1"].numeric).toBe(95);
    expect(ev["A4"].value).toBe(111);
    expect(ev["A5"].value).toBe(190);
    expect(ev["A6"].value).toBe(107.5);
    expect(ev["A7"].numeric).toBe(1250);
    expect(ev["A8"].numeric).toBe(0.5);
    expect(ev["A9"].value).toBe("ممتاز");
    // Text that only looks Arabic stays text.
    s.cells["B1"] = { v: "الوحدة ٣" };
    expect(evaluateWorkbook({ sheets: [s], activeSheetId: s.id })[s.id]["B1"].value).toBe("الوحدة ٣");
  });
});
