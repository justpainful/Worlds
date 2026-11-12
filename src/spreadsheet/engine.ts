/**
 * Worlds Spreadsheet Engine — Excel-compatible multi-sheet workbook model,
 * recursive-descent formula parser, dependency-safe evaluator, number/date
 * formatter, relative/absolute reference shifter, and series autofill.
 */

export type NumberFormat =
  | "auto"
  | "number"
  | "integer"
  | "currency_sar"
  | "currency_usd"
  | "accounting"
  | "percent"
  | "scientific"
  | "date"
  | "text";

export interface CellBorders {
  top?: boolean;
  right?: boolean;
  bottom?: boolean;
  left?: boolean;
  color?: string;
}

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  bg?: string;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  format?: NumberFormat;
  decimals?: number;
  border?: CellBorders;
}

export interface CellData {
  /** Raw user input, e.g. "=SUM(A1:A5)" or "42.5" or "Hello" */
  v: string;
  s?: CellStyle;
  note?: string;
}

export interface MergeRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface ConditionalRule {
  id: string;
  range: string; // e.g. "A1:F50"
  op: "gt" | "lt" | "eq" | "between" | "contains" | "notEmpty";
  value: string;
  value2?: string;
  bg: string;
  color: string;
}

export interface SheetData {
  id: string;
  name: string;
  color?: string;
  rows: number;
  cols: number;
  cells: Record<string, CellData>;
  colWidths: Record<number, number>;
  rowHeights: Record<number, number>;
  frozenRows: number;
  frozenCols: number;
  merges: MergeRange[];
  conditionalRules: ConditionalRule[];
  filter?: {
    enabled: boolean;
    colFilters: Record<number, string>;
  };
}

export interface WorkbookData {
  sheets: SheetData[];
  activeSheetId: string;
}

export type ScalarValue = number | string | boolean | null;

export interface EvaluatedCell {
  raw: string;
  value: ScalarValue;
  display: string;
  error: string | null;
  isFormula: boolean;
  numeric: number | null;
}

export interface FunctionDoc {
  name: string;
  signature: string;
  category: string;
  summary: string;
}

export const FUNCTION_DOCS: FunctionDoc[] = [
  { name: "SUM", signature: "SUM(number1, [number2], ...)", category: "Math", summary: "Adds all numbers in a range of cells." },
  { name: "AVERAGE", signature: "AVERAGE(number1, [number2], ...)", category: "Statistical", summary: "Returns the arithmetic mean of its arguments." },
  { name: "MIN", signature: "MIN(number1, [number2], ...)", category: "Statistical", summary: "Returns the smallest number in a set of values." },
  { name: "MAX", signature: "MAX(number1, [number2], ...)", category: "Statistical", summary: "Returns the largest value in a set of values." },
  { name: "COUNT", signature: "COUNT(value1, [value2], ...)", category: "Statistical", summary: "Counts the number of cells that contain numbers." },
  { name: "COUNTA", signature: "COUNTA(value1, [value2], ...)", category: "Statistical", summary: "Counts the number of non-empty cells in a range." },
  { name: "COUNTBLANK", signature: "COUNTBLANK(range)", category: "Statistical", summary: "Counts empty cells in a specified range." },
  { name: "SUMIF", signature: "SUMIF(range, criteria, [sum_range])", category: "Math", summary: "Adds the cells specified by a given condition or criteria." },
  { name: "COUNTIF", signature: "COUNTIF(range, criteria)", category: "Statistical", summary: "Counts the number of cells within a range that meet a criterion." },
  { name: "AVERAGEIF", signature: "AVERAGEIF(range, criteria, [average_range])", category: "Statistical", summary: "Finds average for the cells specified by a given criterion." },
  { name: "IF", signature: "IF(logical_test, value_if_true, [value_if_false])", category: "Logical", summary: "Checks whether a condition is met, and returns one value if TRUE and another if FALSE." },
  { name: "IFS", signature: "IFS(cond1, val1, [cond2, val2], ...)", category: "Logical", summary: "Checks multiple conditions and returns a value corresponding to the first TRUE condition." },
  { name: "IFERROR", signature: "IFERROR(value, value_if_error)", category: "Logical", summary: "Returns value_if_error if expression is an error; otherwise returns the value." },
  { name: "AND", signature: "AND(logical1, [logical2], ...)", category: "Logical", summary: "Returns TRUE if all arguments evaluate to TRUE." },
  { name: "OR", signature: "OR(logical1, [logical2], ...)", category: "Logical", summary: "Returns TRUE if any argument evaluates to TRUE." },
  { name: "NOT", signature: "NOT(logical)", category: "Logical", summary: "Reverses the logic of its argument." },
  { name: "VLOOKUP", signature: "VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])", category: "Lookup", summary: "Looks for a value in the leftmost column of a table and returns a value in the same row." },
  { name: "XLOOKUP", signature: "XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])", category: "Lookup", summary: "Searches a range or an array, and returns an item corresponding to the first match." },
  { name: "INDEX", signature: "INDEX(array, row_num, [column_num])", category: "Lookup", summary: "Returns a value from within a table or range." },
  { name: "MATCH", signature: "MATCH(lookup_value, lookup_array, [match_type])", category: "Lookup", summary: "Searches for an item in a range of cells and returns its relative position." },
  { name: "MEDIAN", signature: "MEDIAN(number1, [number2], ...)", category: "Statistical", summary: "Returns the median of the given numbers." },
  { name: "STDEV", signature: "STDEV(number1, [number2], ...)", category: "Statistical", summary: "Estimates standard deviation based on a sample." },
  { name: "PERCENTILE", signature: "PERCENTILE(array, k)", category: "Statistical", summary: "Returns the k-th percentile of values in a range." },
  { name: "RANK", signature: "RANK(number, ref, [order])", category: "Statistical", summary: "Returns the rank of a number in a list of numbers." },
  { name: "ROUND", signature: "ROUND(number, num_digits)", category: "Math", summary: "Rounds a number to a specified number of digits." },
  { name: "ROUNDUP", signature: "ROUNDUP(number, num_digits)", category: "Math", summary: "Rounds a number up, away from zero." },
  { name: "ROUNDDOWN", signature: "ROUNDDOWN(number, num_digits)", category: "Math", summary: "Rounds a number down, toward zero." },
  { name: "ABS", signature: "ABS(number)", category: "Math", summary: "Returns the absolute value of a number." },
  { name: "SQRT", signature: "SQRT(number)", category: "Math", summary: "Returns a positive square root." },
  { name: "POWER", signature: "POWER(number, power)", category: "Math", summary: "Returns the result of a number raised to a power." },
  { name: "MOD", signature: "MOD(number, divisor)", category: "Math", summary: "Returns the remainder after number is divided by divisor." },
  { name: "SUMPRODUCT", signature: "SUMPRODUCT(array1, [array2], ...)", category: "Math", summary: "Returns the sum of the products of corresponding ranges or arrays." },
  { name: "PMT", signature: "PMT(rate, nper, pv, [fv], [type])", category: "Financial", summary: "Calculates the payment for a loan based on constant payments and a constant interest rate." },
  { name: "PV", signature: "PV(rate, nper, pmt, [fv], [type])", category: "Financial", summary: "Calculates the present value of a loan or an investment." },
  { name: "FV", signature: "FV(rate, nper, pmt, [pv], [type])", category: "Financial", summary: "Calculates the future value of an investment." },
  { name: "NPV", signature: "NPV(rate, value1, [value2], ...)", category: "Financial", summary: "Calculates the net present value of an investment." },
  { name: "LEN", signature: "LEN(text)", category: "Text", summary: "Returns the number of characters in a text string." },
  { name: "TRIM", signature: "TRIM(text)", category: "Text", summary: "Removes extra spaces from text." },
  { name: "UPPER", signature: "UPPER(text)", category: "Text", summary: "Converts text to uppercase." },
  { name: "LOWER", signature: "LOWER(text)", category: "Text", summary: "Converts text to lowercase." },
  { name: "PROPER", signature: "PROPER(text)", category: "Text", summary: "Capitalizes the first letter in each word of a text value." },
  { name: "CONCAT", signature: "CONCAT(text1, [text2], ...)", category: "Text", summary: "Combines the text from multiple ranges and/or strings." },
  { name: "TEXTJOIN", signature: "TEXTJOIN(delimiter, ignore_empty, text1, ...)", category: "Text", summary: "Combines text from multiple strings with a delimiter." },
  { name: "LEFT", signature: "LEFT(text, [num_chars])", category: "Text", summary: "Returns the leftmost characters from a text value." },
  { name: "RIGHT", signature: "RIGHT(text, [num_chars])", category: "Text", summary: "Returns the rightmost characters from a text value." },
  { name: "MID", signature: "MID(text, start_num, num_chars)", category: "Text", summary: "Returns a specific number of characters from a text string." },
  { name: "SUBSTITUTE", signature: "SUBSTITUTE(text, old_text, new_text)", category: "Text", summary: "Substitutes new_text for old_text in a text string." },
  { name: "TODAY", signature: "TODAY()", category: "Date", summary: "Returns today's date formatted as YYYY-MM-DD." },
  { name: "NOW", signature: "NOW()", category: "Date", summary: "Returns current date and time." },
  { name: "YEAR", signature: "YEAR(date)", category: "Date", summary: "Returns the year of a date." },
  { name: "MONTH", signature: "MONTH(date)", category: "Date", summary: "Returns the month of a date (1-12)." },
  { name: "DAY", signature: "DAY(date)", category: "Date", summary: "Returns the day of a date (1-31)." },
  { name: "DAYS", signature: "DAYS(end_date, start_date)", category: "Date", summary: "Returns the number of days between two dates." },
  { name: "DATEDIF", signature: "DATEDIF(start_date, end_date, unit)", category: "Date", summary: "Calculates the number of days, months, or years between two dates." },
];

// ---------------------------------------------------------------------------
// Coordinate & Reference Helpers
// ---------------------------------------------------------------------------

export function colToName(col: number): string {
  let n = col + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function nameToCol(name: string): number {
  const clean = name.toUpperCase().replace(/[^A-Z]/g, "");
  let col = 0;
  for (let i = 0; i < clean.length; i++) {
    col = col * 26 + (clean.charCodeAt(i) - 64);
  }
  return col - 1;
}

export function cellKey(r: number, c: number): string {
  return `${colToName(c)}${r + 1}`;
}

export interface ParsedCellRef {
  sheet?: string;
  r: number;
  c: number;
  absR: boolean;
  absC: boolean;
}

const CELL_REF_RE = /^(?:(?:'([^']+)'|([A-Za-z0-9_\u0600-\u06FF]+))!)?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,5})$/;

export function parseCellRef(token: string): ParsedCellRef | null {
  const m = token.trim().match(CELL_REF_RE);
  if (!m) return null;
  const sheet = m[1] || m[2] || undefined;
  const absC = m[3] === "$";
  const c = nameToCol(m[4]);
  const absR = m[5] === "$";
  const r = parseInt(m[6], 10) - 1;
  if (r < 0 || c < 0 || r > 99999 || c > 16384) return null;
  return { sheet, r, c, absR, absC };
}

/** Whether one conditional rule applies to an evaluated cell at (r, c). */
export function ruleMatches(rule: ConditionalRule, r: number, c: number, ev: EvaluatedCell | undefined): boolean {
  const [a, b = a] = rule.range.split(":");
  const p = parseCellRef(a);
  const q = parseCellRef(b);
  if (!p || !q) return false;
  if (r < Math.min(p.r, q.r) || r > Math.max(p.r, q.r) || c < Math.min(p.c, q.c) || c > Math.max(p.c, q.c)) return false;
  if (!ev || ev.error) return false;
  const text = ev.value == null ? "" : String(ev.value);
  if (rule.op === "notEmpty") return text.trim() !== "";
  if (rule.op === "contains") return rule.value !== "" && text.toLowerCase().includes(rule.value.toLowerCase());
  const n = ev.numeric;
  const v = Number(rule.value);
  if (rule.op === "eq") return n !== null && rule.value.trim() !== "" && !Number.isNaN(v) ? n === v : text === rule.value;
  if (n === null || Number.isNaN(v)) return false;
  if (rule.op === "gt") return n > v;
  if (rule.op === "lt") return n < v;
  const w = Number(rule.value2);
  return !Number.isNaN(w) && n >= Math.min(v, w) && n <= Math.max(v, w);
}

/** The colours the first matching conditional rule gives a cell, if any. */
export function conditionalStyle(rules: ConditionalRule[] | undefined, r: number, c: number, ev: EvaluatedCell | undefined): { bg: string; color: string } | null {
  for (const rule of rules ?? []) if (ruleMatches(rule, r, c, ev)) return { bg: rule.bg, color: rule.color };
  return null;
}

export function formatCellRef(ref: ParsedCellRef): string {
  const prefix = ref.sheet
    ? /[^A-Za-z0-9_]/.test(ref.sheet)
      ? `'${ref.sheet}'!`
      : `${ref.sheet}!`
    : "";
  return `${prefix}${ref.absC ? "$" : ""}${colToName(ref.c)}${ref.absR ? "$" : ""}${ref.r + 1}`;
}

export function expandRangeCoords(r1: number, c1: number, r2: number, c2: number): { r: number; c: number }[] {
  const minR = Math.min(r1, r2);
  const maxR = Math.max(r1, r2);
  const minC = Math.min(c1, c2);
  const maxC = Math.max(c1, c2);
  const out: { r: number; c: number }[] = [];
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      out.push({ r, c });
    }
  }
  return out;
}

/**
 * Cycles relative/absolute reference at cursor position (`F4` shortcut in Excel):
 * A1 -> $A$1 -> A$1 -> $A1 -> A1
 */
export function cycleRefAbsolute(formula: string, cursorPos: number): { formula: string; cursorPos: number } {
  const re = /(\$?[A-Za-z]{1,3})(\$?\d{1,5})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (cursorPos >= start && cursorPos <= end) {
      const colPart = m[1];
      const rowPart = m[2];
      const absC = colPart.startsWith("$");
      const absR = rowPart.startsWith("$");
      const colClean = absC ? colPart.slice(1) : colPart;
      const rowClean = absR ? rowPart.slice(1) : rowPart;

      let next: string;
      if (!absC && !absR) next = `$${colClean}$${rowClean}`;
      else if (absC && absR) next = `${colClean}$${rowClean}`;
      else if (!absC && absR) next = `$${colClean}${rowClean}`;
      else next = `${colClean}${rowClean}`;

      const updated = formula.slice(0, start) + next + formula.slice(end);
      return { formula: updated, cursorPos: start + next.length };
    }
  }
  return { formula, cursorPos };
}

/**
 * Shifts relative cell references in a formula by `(dr, dc)` rows/cols.
 * Respects `$` on column (`$A1`) and row (`A$1`).
 */
export function shiftFormulaReferences(formula: string, dr: number, dc: number): string {
  if (!formula.startsWith("=") || (dr === 0 && dc === 0)) return formula;
  // Avoid shifting text inside double quotes
  const parts = formula.split(/("[^"]*")/g);
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part; // quoted string literal
      return part.replace(
        /(?:(?:'[^']+'|[A-Za-z0-9_\u0600-\u06FF]+)!)?\$?[A-Za-z]{1,3}\$?\d{1,5}(?!\s*\()/g,
        (match) => {
          const parsed = parseCellRef(match);
          if (!parsed) return match;
          const nextR = parsed.absR ? parsed.r : Math.max(0, parsed.r + dr);
          const nextC = parsed.absC ? parsed.c : Math.max(0, parsed.c + dc);
          return formatCellRef({ ...parsed, r: nextR, c: nextC });
        },
      );
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Default Sheet & Workbook Constructors
// ---------------------------------------------------------------------------

export function newSheet(name = "Sheet 1", rows = 60, cols = 26): SheetData {
  return {
    id: `sh_${Math.random().toString(36).slice(2, 10)}`,
    name,
    rows,
    cols,
    cells: {},
    colWidths: {},
    rowHeights: {},
    frozenRows: 0,
    frozenCols: 0,
    merges: [],
    conditionalRules: [],
  };
}

export function newWorkbook(): WorkbookData {
  const s1 = newSheet("Sheet 1");
  return {
    sheets: [s1],
    activeSheetId: s1.id,
  };
}

export function normalizeWorkbook(raw: unknown): WorkbookData {
  if (!raw || typeof raw !== "object") return newWorkbook();
  const obj = raw as Partial<WorkbookData>;
  if (!Array.isArray(obj.sheets) || obj.sheets.length === 0) return newWorkbook();
  const sheets: SheetData[] = obj.sheets.map((s, idx) => ({
    id: typeof s?.id === "string" && s.id ? s.id : `sh_${idx + 1}`,
    name: typeof s?.name === "string" && s.name.trim() ? s.name : `Sheet ${idx + 1}`,
    color: typeof s?.color === "string" ? s.color : undefined,
    rows: typeof s?.rows === "number" && s.rows >= 10 ? Math.min(500, s.rows) : 60,
    cols: typeof s?.cols === "number" && s.cols >= 5 ? Math.min(100, s.cols) : 26,
    cells: s?.cells && typeof s.cells === "object" ? { ...s.cells } : {},
    colWidths: s?.colWidths && typeof s.colWidths === "object" ? { ...s.colWidths } : {},
    rowHeights: s?.rowHeights && typeof s.rowHeights === "object" ? { ...s.rowHeights } : {},
    frozenRows: typeof s?.frozenRows === "number" ? Math.max(0, s.frozenRows) : 0,
    frozenCols: typeof s?.frozenCols === "number" ? Math.max(0, s.frozenCols) : 0,
    merges: Array.isArray(s?.merges) ? [...s.merges] : [],
    conditionalRules: Array.isArray(s?.conditionalRules) ? [...s.conditionalRules] : [],
    filter: s?.filter ? { enabled: !!s.filter.enabled, colFilters: { ...(s.filter.colFilters ?? {}) } } : undefined,
  }));
  const activeSheetId =
    typeof obj.activeSheetId === "string" && sheets.some((s) => s.id === obj.activeSheetId)
      ? obj.activeSheetId
      : sheets[0].id;
  return { sheets, activeSheetId };
}

// ---------------------------------------------------------------------------
// Formula Parser & Evaluator
// ---------------------------------------------------------------------------

class FormulaError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type EvalArg = ScalarValue | ScalarValue[][];

function flattenArgs(args: EvalArg[]): ScalarValue[] {
  const out: ScalarValue[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const row of a) {
        for (const v of row) out.push(v);
      }
    } else {
      out.push(a);
    }
  }
  return out;
}

function toNumber(v: ScalarValue, strict = false): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === "") return 0;
  const cleaned = String(v).replace(/,/g, "").trim();
  if (cleaned.endsWith("%")) {
    const n = Number(cleaned.slice(0, -1));
    if (!Number.isNaN(n)) return n / 100;
  }
  const n = Number(cleaned);
  if (Number.isNaN(n)) {
    if (strict) throw new FormulaError("#VALUE!");
    return 0;
  }
  return n;
}

function numericList(args: EvalArg[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const row of a) {
        for (const v of row) {
          if (typeof v === "number" && Number.isFinite(v)) out.push(v);
          else if (typeof v === "string" && v.trim() !== "") {
            const n = Number(v.replace(/,/g, ""));
            if (!Number.isNaN(n)) out.push(n);
          }
        }
      }
    } else if (typeof a === "number" && Number.isFinite(a)) {
      out.push(a);
    } else if (typeof a === "boolean") {
      out.push(a ? 1 : 0);
    } else if (typeof a === "string" && a.trim() !== "") {
      const n = Number(a.replace(/,/g, ""));
      if (!Number.isNaN(n)) out.push(n);
    }
  }
  return out;
}

function toCriteriaMatcher(criteria: ScalarValue): (v: ScalarValue) => boolean {
  if (typeof criteria === "number") {
    return (v) => {
      const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
      return !Number.isNaN(n) && n === criteria;
    };
  }
  if (typeof criteria === "boolean") {
    return (v) => Boolean(v) === criteria;
  }
  const str = String(criteria ?? "").trim();
  const opMatch = str.match(/^(<=|>=|<>|!=|<|>|=)(.*)$/);
  if (opMatch) {
    const op = opMatch[1];
    const rhsRaw = opMatch[2].trim();
    const rhsNum = rhsRaw !== "" ? Number(rhsRaw.replace(/,/g, "")) : NaN;
    const isNum = !Number.isNaN(rhsNum);
    return (v) => {
      const vNum = typeof v === "number" ? v : v !== null && String(v).trim() !== "" ? Number(String(v).replace(/,/g, "")) : NaN;
      if (isNum && !Number.isNaN(vNum)) {
        if (op === ">") return vNum > rhsNum;
        if (op === ">=") return vNum >= rhsNum;
        if (op === "<") return vNum < rhsNum;
        if (op === "<=") return vNum <= rhsNum;
        if (op === "=") return vNum === rhsNum;
        if (op === "<>" || op === "!=") return vNum !== rhsNum;
      }
      const lhsStr = String(v ?? "").toLowerCase();
      const rhsStr = rhsRaw.toLowerCase();
      if (op === "=") return lhsStr === rhsStr;
      if (op === "<>" || op === "!=") return lhsStr !== rhsStr;
      if (op === ">") return lhsStr > rhsStr;
      if (op === ">=") return lhsStr >= rhsStr;
      if (op === "<") return lhsStr < rhsStr;
      if (op === "<=") return lhsStr <= rhsStr;
      return false;
    };
  }
  if (str.includes("*") || str.includes("?")) {
    const pattern = new RegExp(
      "^" +
        str
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$",
      "i",
    );
    return (v) => pattern.test(String(v ?? ""));
  }
  const maybeNum = str !== "" ? Number(str.replace(/,/g, "")) : NaN;
  if (!Number.isNaN(maybeNum)) {
    return (v) => {
      const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
      return (!Number.isNaN(n) && n === maybeNum) || String(v ?? "").toLowerCase() === str.toLowerCase();
    };
  }
  return (v) => String(v ?? "").toLowerCase() === str.toLowerCase();
}

function parseDateValue(v: ScalarValue): Date {
  if (typeof v === "number") {
    // Excel serial date or epoch ms
    if (v > 1e10) return new Date(v);
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw new FormulaError("#VALUE!");
  return d;
}

// Tokenizer for formulas
type Token =
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma" };

function tokenizeFormula(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      while (i < expr.length) {
        if (expr[i] === '"' && expr[i + 1] === '"') {
          s += '"';
          i += 2;
        } else if (expr[i] === '"') {
          i++;
          break;
        } else {
          s += expr[i++];
        }
      }
      tokens.push({ type: "str", value: s });
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i++;
      continue;
    }
    if (ch === "," || ch === ";") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }
    const twoChar = expr.slice(i, i + 2);
    if (["<=", ">=", "<>", "!="].includes(twoChar)) {
      tokens.push({ type: "op", value: twoChar });
      i += 2;
      continue;
    }
    if (["+", "-", "*", "/", "^", "&", "=", "<", ">", ":", "%"].includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(expr[i + 1] ?? ""))) {
      let numStr = "";
      while (i < expr.length && /[\d.eE+-]/.test(expr[i])) {
        if ((expr[i] === "+" || expr[i] === "-") && !/[eE]/.test(numStr[numStr.length - 1] ?? "")) break;
        numStr += expr[i++];
      }
      const n = Number(numStr);
      if (Number.isNaN(n)) throw new FormulaError("#VALUE!");
      tokens.push({ type: "num", value: n });
      continue;
    }
    // Identifier, sheet-qualified reference ('Sheet 1'!$A$1), or function name
    if (ch === "'" || /[A-Za-z_$\u0600-\u06FF#]/.test(ch)) {
      let ident = "";
      if (ch === "'") {
        ident += expr[i++];
        while (i < expr.length && expr[i] !== "'") ident += expr[i++];
        if (i < expr.length) ident += expr[i++];
      }
      while (i < expr.length && /[A-Za-z0-9_$!.\u0600-\u06FF?]/.test(expr[i])) {
        ident += expr[i++];
      }
      tokens.push({ type: "ident", value: ident });
      continue;
    }
    throw new FormulaError("#VALUE!");
  }
  return tokens;
}

export function evaluateWorkbook(wb: WorkbookData): Record<string, Record<string, EvaluatedCell>> {
  const result: Record<string, Record<string, EvaluatedCell>> = {};
  const visiting = new Set<string>();

  for (const sh of wb.sheets) {
    result[sh.id] = {};
  }

  const findSheet = (nameOrId?: string): SheetData | undefined => {
    if (!nameOrId) return wb.sheets.find((s) => s.id === wb.activeSheetId) ?? wb.sheets[0];
    const lower = nameOrId.toLowerCase();
    return wb.sheets.find((s) => s.id === nameOrId || s.name.toLowerCase() === lower);
  };

  const evalCell = (sheet: SheetData, r: number, c: number): EvaluatedCell => {
    const key = cellKey(r, c);
    const existing = result[sheet.id]?.[key];
    if (existing) return existing;

    const visitKey = `${sheet.id}:${key}`;
    if (visiting.has(visitKey)) {
      throw new FormulaError("#CYCLE!");
    }

    const cell = sheet.cells[key];
    const raw = cell?.v ?? "";
    const style = cell?.s;

    if (!raw.startsWith("=")) {
      const scalar = parseRawScalar(raw);
      const numeric = typeof scalar === "number" ? scalar : null;
      const evaluated: EvaluatedCell = {
        raw,
        value: scalar,
        display: formatScalar(scalar, style),
        error: null,
        isFormula: false,
        numeric,
      };
      result[sheet.id][key] = evaluated;
      return evaluated;
    }

    visiting.add(visitKey);
    try {
      const expr = raw.slice(1).trim();
      const val = evaluateFormulaExpression(expr, sheet, r, c);
      const scalar: ScalarValue = Array.isArray(val) ? (val[0]?.[0] ?? null) : val;
      if (typeof scalar === "string" && scalar.startsWith("#") && /[!/?]$/.test(scalar)) {
        const errCell: EvaluatedCell = {
          raw,
          value: scalar,
          display: scalar,
          error: scalar,
          isFormula: true,
          numeric: null,
        };
        result[sheet.id][key] = errCell;
        return errCell;
      }
      const numeric = typeof scalar === "number" && Number.isFinite(scalar) ? scalar : null;
      const evaluated: EvaluatedCell = {
        raw,
        value: scalar,
        display: formatScalar(scalar, style),
        error: null,
        isFormula: true,
        numeric,
      };
      result[sheet.id][key] = evaluated;
      return evaluated;
    } catch (err) {
      const code = err instanceof FormulaError ? err.code : "#ERROR!";
      const errCell: EvaluatedCell = {
        raw,
        value: code,
        display: code,
        error: code,
        isFormula: true,
        numeric: null,
      };
      result[sheet.id][key] = errCell;
      return errCell;
    } finally {
      visiting.delete(visitKey);
    }
  };

  function evaluateFormulaExpression(
    expr: string,
    currentSheet: SheetData,
    currentRow: number,
    currentCol: number,
  ): EvalArg {
    const tokens = tokenizeFormula(expr);
    let pos = 0;

    const peek = (): Token | undefined => tokens[pos];
    const consume = (): Token => tokens[pos++];

    function parseComparison(): EvalArg {
      let left = parseConcat();
      while (peek()?.type === "op" && ["=", "<>", "!=", "<", "<=", ">", ">="].includes((peek() as { value: string }).value)) {
        const op = (consume() as { value: string }).value;
        const right = parseConcat();
        const lv = unwrapScalar(left);
        const rv = unwrapScalar(right);
        left = compareScalars(lv, rv, op);
      }
      return left;
    }

    function parseConcat(): EvalArg {
      let left = parseAdditive();
      while (peek()?.type === "op" && (peek() as { value: string }).value === "&") {
        consume();
        const right = parseAdditive();
        left = `${unwrapScalar(left) ?? ""}${unwrapScalar(right) ?? ""}`;
      }
      return left;
    }

    function parseAdditive(): EvalArg {
      let left = parseMultiplicative();
      while (peek()?.type === "op" && ["+", "-"].includes((peek() as { value: string }).value)) {
        const op = (consume() as { value: string }).value;
        const right = parseMultiplicative();
        const ln = toNumber(unwrapScalar(left), true);
        const rn = toNumber(unwrapScalar(right), true);
        left = op === "+" ? ln + rn : ln - rn;
      }
      return left;
    }

    function parseMultiplicative(): EvalArg {
      let left = parsePower();
      while (peek()?.type === "op" && ["*", "/"].includes((peek() as { value: string }).value)) {
        const op = (consume() as { value: string }).value;
        const right = parsePower();
        const ln = toNumber(unwrapScalar(left), true);
        const rn = toNumber(unwrapScalar(right), true);
        if (op === "/") {
          if (rn === 0) throw new FormulaError("#DIV/0!");
          left = ln / rn;
        } else {
          left = ln * rn;
        }
      }
      return left;
    }

    function parsePower(): EvalArg {
      let left = parseUnary();
      while (peek()?.type === "op" && (peek() as { value: string }).value === "^") {
        consume();
        const right = parseUnary();
        left = Math.pow(toNumber(unwrapScalar(left), true), toNumber(unwrapScalar(right), true));
      }
      return left;
    }

    function parseUnary(): EvalArg {
      if (peek()?.type === "op" && ["+", "-"].includes((peek() as { value: string }).value)) {
        const op = (consume() as { value: string }).value;
        const val = toNumber(unwrapScalar(parseUnary()), true);
        return op === "-" ? -val : val;
      }
      let atom = parseRangeOrPrimary();
      while (peek()?.type === "op" && (peek() as { value: string }).value === "%") {
        consume();
        atom = toNumber(unwrapScalar(atom), true) / 100;
      }
      return atom;
    }

    function parseRangeOrPrimary(): EvalArg {
      const t = peek();
      if (t?.type === "ident" && tokens[pos + 1]?.type === "op" && (tokens[pos + 1] as { value: string }).value === ":") {
        const startTok = consume() as { type: "ident"; value: string };
        consume(); // ':'
        const endTok = consume();
        if (!endTok || endTok.type !== "ident") throw new FormulaError("#REF!");
        const startRef = parseCellRef(startTok.value);
        const endRef = parseCellRef(endTok.value);
        if (!startRef || !endRef) throw new FormulaError("#REF!");
        const targetSheet = startRef.sheet ? findSheet(startRef.sheet) : currentSheet;
        if (!targetSheet) throw new FormulaError("#REF!");
        const minR = Math.min(startRef.r, endRef.r);
        const maxR = Math.max(startRef.r, endRef.r);
        const minC = Math.min(startRef.c, endRef.c);
        const maxC = Math.max(startRef.c, endRef.c);
        const matrix: ScalarValue[][] = [];
        for (let r = minR; r <= maxR; r++) {
          const rowVals: ScalarValue[] = [];
          for (let c = minC; c <= maxC; c++) {
            const ev = evalCell(targetSheet, r, c);
            if (ev.error) throw new FormulaError(ev.error);
            rowVals.push(ev.value);
          }
          matrix.push(rowVals);
        }
        return matrix;
      }
      return parsePrimary();
    }

    function parsePrimary(): EvalArg {
      const t = peek();
      if (!t) throw new FormulaError("#VALUE!");

      if (t.type === "num") {
        consume();
        return t.value;
      }
      if (t.type === "str") {
        consume();
        return t.value;
      }
      if (t.type === "paren" && t.value === "(") {
        consume();
        const inner = parseComparison();
        const close = consume();
        if (!close || close.type !== "paren" || close.value !== ")") {
          throw new FormulaError("#VALUE!");
        }
        return inner;
      }
      if (t.type === "ident") {
        consume();
        const rawIdent = t.value;
        const upper = rawIdent.toUpperCase();

        // Function call
        if (peek()?.type === "paren" && (peek() as { value: string }).value === "(") {
          consume(); // '('
          // Special lazy evaluation for IF / IFS / IFERROR / IFNA / CHOOSE / AND / OR
          if (upper === "IF") {
            const cond = parseComparison();
            if (peek()?.type !== "comma") throw new FormulaError("#VALUE!");
            consume();
            const isTrue = Boolean(unwrapScalar(cond));
            if (isTrue) {
              const trueVal = parseComparison();
              if (peek()?.type === "comma") {
                consume();
                skipExpression();
              }
              expectCloseParen();
              return trueVal;
            } else {
              skipExpression();
              let falseVal: EvalArg = false;
              if (peek()?.type === "comma") {
                consume();
                falseVal = parseComparison();
              }
              expectCloseParen();
              return falseVal;
            }
          }
          if (upper === "IFERROR" || upper === "IFNA") {
            let primaryVal: EvalArg;
            let caught: string | null = null;
            try {
              primaryVal = parseComparison();
            } catch (e) {
              caught = e instanceof FormulaError ? e.code : "#ERROR!";
              primaryVal = null;
            }
            if (peek()?.type !== "comma") throw new FormulaError("#VALUE!");
            consume();
            const fallbackVal = parseComparison();
            expectCloseParen();
            if (caught) {
              if (upper === "IFNA" && caught !== "#N/A") throw new FormulaError(caught);
              return fallbackVal;
            }
            return primaryVal;
          }

          const args: EvalArg[] = [];
          if (!(peek()?.type === "paren" && (peek() as { value: string }).value === ")")) {
            while (true) {
              args.push(parseComparison());
              if (peek()?.type === "comma") {
                consume();
              } else {
                break;
              }
            }
          }
          expectCloseParen();
          return callFunction(upper, args, currentRow, currentCol);
        }

        if (upper === "TRUE") return true;
        if (upper === "FALSE") return false;
        if (upper.startsWith("#")) throw new FormulaError(upper);

        const ref = parseCellRef(rawIdent);
        if (ref) {
          const targetSheet = ref.sheet ? findSheet(ref.sheet) : currentSheet;
          if (!targetSheet) throw new FormulaError("#REF!");
          const ev = evalCell(targetSheet, ref.r, ref.c);
          if (ev.error) throw new FormulaError(ev.error);
          return ev.value;
        }
        throw new FormulaError("#NAME?");
      }
      throw new FormulaError("#VALUE!");
    }

    function skipExpression() {
      let depth = 0;
      while (pos < tokens.length) {
        const tk = tokens[pos];
        if (tk.type === "paren" && tk.value === "(") depth++;
        else if (tk.type === "paren" && tk.value === ")") {
          if (depth === 0) break;
          depth--;
        } else if (tk.type === "comma" && depth === 0) {
          break;
        }
        pos++;
      }
    }

    function expectCloseParen() {
      const close = consume();
      if (!close || close.type !== "paren" || close.value !== ")") {
        throw new FormulaError("#VALUE!");
      }
    }

    const out = parseComparison();
    if (pos < tokens.length) throw new FormulaError("#VALUE!");
    return out;
  }

  for (const sh of wb.sheets) {
    for (const key of Object.keys(sh.cells)) {
      const parsed = parseCellRef(key);
      if (parsed) {
        evalCell(sh, parsed.r, parsed.c);
      }
    }
  }

  return result;
}

function unwrapScalar(arg: EvalArg): ScalarValue {
  if (Array.isArray(arg)) return arg[0]?.[0] ?? null;
  return arg;
}

function compareScalars(a: ScalarValue, b: ScalarValue, op: string): boolean {
  const an = typeof a === "number" ? a : a !== null && String(a).trim() !== "" ? Number(String(a).replace(/,/g, "")) : NaN;
  const bn = typeof b === "number" ? b : b !== null && String(b).trim() !== "" ? Number(String(b).replace(/,/g, "")) : NaN;
  if (!Number.isNaN(an) && !Number.isNaN(bn)) {
    if (op === "=") return an === bn;
    if (op === "<>" || op === "!=") return an !== bn;
    if (op === "<") return an < bn;
    if (op === "<=") return an <= bn;
    if (op === ">") return an > bn;
    if (op === ">=") return an >= bn;
  }
  const as = String(a ?? "").toLowerCase();
  const bs = String(b ?? "").toLowerCase();
  if (op === "=") return as === bs;
  if (op === "<>" || op === "!=") return as !== bs;
  if (op === "<") return as < bs;
  if (op === "<=") return as <= bs;
  if (op === ">") return as > bs;
  if (op === ">=") return as >= bs;
  return false;
}

function callFunction(name: string, args: EvalArg[], currentRow: number, currentCol: number): EvalArg {
  switch (name) {
    case "SUM": {
      return numericList(args).reduce((a, b) => a + b, 0);
    }
    case "AVERAGE":
    case "AVG": {
      const nums = numericList(args);
      if (nums.length === 0) throw new FormulaError("#DIV/0!");
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    case "MIN": {
      const nums = numericList(args);
      return nums.length ? Math.min(...nums) : 0;
    }
    case "MAX": {
      const nums = numericList(args);
      return nums.length ? Math.max(...nums) : 0;
    }
    case "COUNT": {
      return numericList(args).length;
    }
    case "COUNTA": {
      return flattenArgs(args).filter((v) => v !== null && String(v).trim() !== "").length;
    }
    case "COUNTBLANK": {
      return flattenArgs(args).filter((v) => v === null || String(v).trim() === "").length;
    }
    case "PRODUCT": {
      const nums = numericList(args);
      return nums.length ? nums.reduce((a, b) => a * b, 1) : 0;
    }
    case "SUMPRODUCT": {
      if (args.length === 0) return 0;
      const lists = args.map((a) => flattenArgs([a]).map((v) => toNumber(v)));
      const len = lists[0].length;
      if (lists.some((l) => l.length !== len)) throw new FormulaError("#VALUE!");
      let total = 0;
      for (let i = 0; i < len; i++) {
        let prod = 1;
        for (const l of lists) prod *= l[i];
        total += prod;
      }
      return total;
    }
    case "MEDIAN": {
      const nums = numericList(args).sort((a, b) => a - b);
      if (nums.length === 0) throw new FormulaError("#NUM!");
      const mid = Math.floor(nums.length / 2);
      return nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    }
    case "MODE": {
      const nums = numericList(args);
      if (nums.length === 0) throw new FormulaError("#N/A");
      const counts = new Map<number, number>();
      let best = nums[0];
      let bestCount = 0;
      for (const n of nums) {
        const c = (counts.get(n) ?? 0) + 1;
        counts.set(n, c);
        if (c > bestCount) {
          bestCount = c;
          best = n;
        }
      }
      return best;
    }
    case "STDEV":
    case "STDEVP": {
      const nums = numericList(args);
      const denom = name === "STDEV" ? nums.length - 1 : nums.length;
      if (denom <= 0) throw new FormulaError("#DIV/0!");
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance = nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / denom;
      return Math.sqrt(variance);
    }
    case "VAR":
    case "VARP": {
      const nums = numericList(args);
      const denom = name === "VAR" ? nums.length - 1 : nums.length;
      if (denom <= 0) throw new FormulaError("#DIV/0!");
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / denom;
    }
    case "PERCENTILE": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const nums = numericList([args[0]]).sort((a, b) => a - b);
      const k = toNumber(unwrapScalar(args[1]), true);
      if (nums.length === 0 || k < 0 || k > 1) throw new FormulaError("#NUM!");
      const idx = k * (nums.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return nums[lo] + (nums[hi] - nums[lo]) * (idx - lo);
    }
    case "LARGE":
    case "SMALL": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const nums = numericList([args[0]]).sort((a, b) => (name === "LARGE" ? b - a : a - b));
      const k = Math.floor(toNumber(unwrapScalar(args[1]), true));
      if (k < 1 || k > nums.length) throw new FormulaError("#NUM!");
      return nums[k - 1];
    }
    case "RANK": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const target = toNumber(unwrapScalar(args[0]), true);
      const asc = args[2] ? toNumber(unwrapScalar(args[2])) !== 0 : false;
      const nums = numericList([args[1]]).sort((a, b) => (asc ? a - b : b - a));
      const idx = nums.indexOf(target);
      if (idx === -1) throw new FormulaError("#N/A");
      return idx + 1;
    }
    case "SUMIF": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const range = flattenArgs([args[0]]);
      const matcher = toCriteriaMatcher(unwrapScalar(args[1]));
      const sumRange = args[2] ? flattenArgs([args[2]]) : range;
      let sum = 0;
      for (let i = 0; i < range.length; i++) {
        if (matcher(range[i])) {
          sum += toNumber(sumRange[i] ?? 0);
        }
      }
      return sum;
    }
    case "COUNTIF": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const range = flattenArgs([args[0]]);
      const matcher = toCriteriaMatcher(unwrapScalar(args[1]));
      return range.filter(matcher).length;
    }
    case "AVERAGEIF": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const range = flattenArgs([args[0]]);
      const matcher = toCriteriaMatcher(unwrapScalar(args[1]));
      const avgRange = args[2] ? flattenArgs([args[2]]) : range;
      let sum = 0;
      let count = 0;
      for (let i = 0; i < range.length; i++) {
        if (matcher(range[i])) {
          sum += toNumber(avgRange[i] ?? 0);
          count++;
        }
      }
      if (count === 0) throw new FormulaError("#DIV/0!");
      return sum / count;
    }
    case "IFS": {
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (Boolean(unwrapScalar(args[i]))) return args[i + 1];
      }
      throw new FormulaError("#N/A");
    }
    case "SWITCH": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const expr = unwrapScalar(args[0]);
      for (let i = 1; i + 1 < args.length; i += 2) {
        if (compareScalars(expr, unwrapScalar(args[i]), "=")) return args[i + 1];
      }
      if (args.length % 2 === 0) return args[args.length - 1];
      throw new FormulaError("#N/A");
    }
    case "CHOOSE": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const idx = Math.floor(toNumber(unwrapScalar(args[0]), true));
      if (idx < 1 || idx >= args.length) throw new FormulaError("#VALUE!");
      return args[idx];
    }
    case "AND": {
      const vals = flattenArgs(args);
      return vals.every((v) => Boolean(v));
    }
    case "OR": {
      const vals = flattenArgs(args);
      return vals.some((v) => Boolean(v));
    }
    case "XOR": {
      const vals = flattenArgs(args);
      return vals.filter((v) => Boolean(v)).length % 2 === 1;
    }
    case "NOT": {
      return !Boolean(unwrapScalar(args[0] ?? false));
    }
    case "ISBLANK": {
      const v = unwrapScalar(args[0] ?? null);
      return v === null || v === "";
    }
    case "ISNUMBER": {
      const v = unwrapScalar(args[0] ?? null);
      return typeof v === "number" && Number.isFinite(v);
    }
    case "ISTEXT": {
      const v = unwrapScalar(args[0] ?? null);
      return typeof v === "string";
    }
    case "ABS":
      return Math.abs(toNumber(unwrapScalar(args[0] ?? 0), true));
    case "SIGN":
      return Math.sign(toNumber(unwrapScalar(args[0] ?? 0), true));
    case "SQRT": {
      const n = toNumber(unwrapScalar(args[0] ?? 0), true);
      if (n < 0) throw new FormulaError("#NUM!");
      return Math.sqrt(n);
    }
    case "POWER":
      return Math.pow(toNumber(unwrapScalar(args[0] ?? 0), true), toNumber(unwrapScalar(args[1] ?? 1), true));
    case "EXP":
      return Math.exp(toNumber(unwrapScalar(args[0] ?? 0), true));
    case "LN": {
      const n = toNumber(unwrapScalar(args[0] ?? 0), true);
      if (n <= 0) throw new FormulaError("#NUM!");
      return Math.log(n);
    }
    case "LOG":
    case "LOG10": {
      const n = toNumber(unwrapScalar(args[0] ?? 0), true);
      const base = name === "LOG10" ? 10 : args[1] ? toNumber(unwrapScalar(args[1]), true) : 10;
      if (n <= 0 || base <= 0 || base === 1) throw new FormulaError("#NUM!");
      return Math.log(n) / Math.log(base);
    }
    case "MOD": {
      const n = toNumber(unwrapScalar(args[0] ?? 0), true);
      const d = toNumber(unwrapScalar(args[1] ?? 0), true);
      if (d === 0) throw new FormulaError("#DIV/0!");
      return n - d * Math.floor(n / d);
    }
    case "INT":
    case "FLOOR":
      return Math.floor(toNumber(unwrapScalar(args[0] ?? 0), true));
    case "CEILING":
      return Math.ceil(toNumber(unwrapScalar(args[0] ?? 0), true));
    case "TRUNC":
      return Math.trunc(toNumber(unwrapScalar(args[0] ?? 0), true));
    case "ROUND": {
      const n = toNumber(unwrapScalar(args[0] ?? 0), true);
      const d = args[1] ? Math.floor(toNumber(unwrapScalar(args[1]), true)) : 0;
      const factor = Math.pow(10, d);
      return Math.round(n * factor) / factor;
    }
    case "ROUNDUP": {
      const n = toNumber(unwrapScalar(args[0] ?? 0), true);
      const d = args[1] ? Math.floor(toNumber(unwrapScalar(args[1]), true)) : 0;
      const factor = Math.pow(10, d);
      return (n >= 0 ? Math.ceil(n * factor) : Math.floor(n * factor)) / factor;
    }
    case "ROUNDDOWN": {
      const n = toNumber(unwrapScalar(args[0] ?? 0), true);
      const d = args[1] ? Math.floor(toNumber(unwrapScalar(args[1]), true)) : 0;
      const factor = Math.pow(10, d);
      return Math.trunc(n * factor) / factor;
    }
    case "PI":
      return Math.PI;
    case "RAND":
      return Math.random();
    case "RANDBETWEEN": {
      const lo = Math.ceil(toNumber(unwrapScalar(args[0] ?? 0), true));
      const hi = Math.floor(toNumber(unwrapScalar(args[1] ?? 1), true));
      if (lo > hi) throw new FormulaError("#NUM!");
      return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    }
    // Lookup & Reference
    case "VLOOKUP": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const needle = unwrapScalar(args[0]);
      const table = Array.isArray(args[1]) ? args[1] : [[args[1]]];
      const colIdx = Math.floor(toNumber(unwrapScalar(args[2]), true)) - 1;
      const approx = args[3] !== undefined ? Boolean(unwrapScalar(args[3])) : false;
      if (colIdx < 0 || (table[0] && colIdx >= table[0].length)) throw new FormulaError("#REF!");
      for (const row of table) {
        if (compareScalars(row[0], needle, "=")) {
          return row[colIdx] ?? null;
        }
      }
      if (approx) {
        let bestRow: ScalarValue[] | null = null;
        for (const row of table) {
          if (compareScalars(row[0], needle, "<=")) bestRow = row;
        }
        if (bestRow) return bestRow[colIdx] ?? null;
      }
      throw new FormulaError("#N/A");
    }
    case "HLOOKUP": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const needle = unwrapScalar(args[0]);
      const table = Array.isArray(args[1]) ? args[1] : [[args[1]]];
      const rowIdx = Math.floor(toNumber(unwrapScalar(args[2]), true)) - 1;
      if (rowIdx < 0 || rowIdx >= table.length) throw new FormulaError("#REF!");
      const firstRow = table[0] ?? [];
      for (let c = 0; c < firstRow.length; c++) {
        if (compareScalars(firstRow[c], needle, "=")) {
          return table[rowIdx][c] ?? null;
        }
      }
      throw new FormulaError("#N/A");
    }
    case "XLOOKUP": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const needle = unwrapScalar(args[0]);
      const lookupList = flattenArgs([args[1]]);
      const returnList = flattenArgs([args[2]]);
      for (let i = 0; i < lookupList.length; i++) {
        if (compareScalars(lookupList[i], needle, "=")) {
          return returnList[i] ?? null;
        }
      }
      if (args[3] !== undefined) return unwrapScalar(args[3]);
      throw new FormulaError("#N/A");
    }
    case "INDEX": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const table = Array.isArray(args[0]) ? args[0] : [[args[0]]];
      const r = Math.floor(toNumber(unwrapScalar(args[1]), true)) - 1;
      const c = args[2] !== undefined ? Math.floor(toNumber(unwrapScalar(args[2]), true)) - 1 : 0;
      if (r < 0 || c < 0 || r >= table.length || c >= (table[0]?.length ?? 0)) {
        throw new FormulaError("#REF!");
      }
      return table[r][c] ?? null;
    }
    case "MATCH": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const needle = unwrapScalar(args[0]);
      const list = flattenArgs([args[1]]);
      for (let i = 0; i < list.length; i++) {
        if (compareScalars(list[i], needle, "=")) return i + 1;
      }
      throw new FormulaError("#N/A");
    }
    case "ROW":
      return currentRow + 1;
    case "COLUMN":
      return currentCol + 1;
    case "ROWS":
      return Array.isArray(args[0]) ? args[0].length : 1;
    case "COLUMNS":
      return Array.isArray(args[0]) ? (args[0][0]?.length ?? 1) : 1;
    // Financial
    case "PMT": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const rate = toNumber(unwrapScalar(args[0]), true);
      const nper = toNumber(unwrapScalar(args[1]), true);
      const pv = toNumber(unwrapScalar(args[2]), true);
      const fv = args[3] ? toNumber(unwrapScalar(args[3]), true) : 0;
      const type = args[4] ? (toNumber(unwrapScalar(args[4]), true) !== 0 ? 1 : 0) : 0;
      if (nper === 0) throw new FormulaError("#DIV/0!");
      if (rate === 0) return -(pv + fv) / nper;
      const pvif = Math.pow(1 + rate, nper);
      return (-rate * (pv * pvif + fv)) / ((1 + rate * type) * (pvif - 1));
    }
    case "FV": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const rate = toNumber(unwrapScalar(args[0]), true);
      const nper = toNumber(unwrapScalar(args[1]), true);
      const pmt = toNumber(unwrapScalar(args[2]), true);
      const pv = args[3] ? toNumber(unwrapScalar(args[3]), true) : 0;
      const type = args[4] ? (toNumber(unwrapScalar(args[4]), true) !== 0 ? 1 : 0) : 0;
      if (rate === 0) return -(pv + pmt * nper);
      const factor = Math.pow(1 + rate, nper);
      return -(pv * factor + (pmt * (1 + rate * type) * (factor - 1)) / rate);
    }
    case "PV": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const rate = toNumber(unwrapScalar(args[0]), true);
      const nper = toNumber(unwrapScalar(args[1]), true);
      const pmt = toNumber(unwrapScalar(args[2]), true);
      const fv = args[3] ? toNumber(unwrapScalar(args[3]), true) : 0;
      const type = args[4] ? (toNumber(unwrapScalar(args[4]), true) !== 0 ? 1 : 0) : 0;
      if (rate === 0) return -(fv + pmt * nper);
      const factor = Math.pow(1 + rate, nper);
      return -(fv + (pmt * (1 + rate * type) * (factor - 1)) / rate) / factor;
    }
    case "NPV": {
      if (args.length < 2) throw new FormulaError("#VALUE!");
      const rate = toNumber(unwrapScalar(args[0]), true);
      const cashflows = numericList(args.slice(1));
      return cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i + 1), 0);
    }
    // Text
    case "LEN":
      return String(unwrapScalar(args[0]) ?? "").length;
    case "TRIM":
      return String(unwrapScalar(args[0]) ?? "").trim().replace(/\s+/g, " ");
    case "UPPER":
      return String(unwrapScalar(args[0]) ?? "").toUpperCase();
    case "LOWER":
      return String(unwrapScalar(args[0]) ?? "").toLowerCase();
    case "PROPER":
      return String(unwrapScalar(args[0]) ?? "").replace(/\b\w/g, (c) => c.toUpperCase());
    case "CONCAT":
    case "CONCATENATE":
      return flattenArgs(args).map((v) => String(v ?? "")).join("");
    case "TEXTJOIN": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const delim = String(unwrapScalar(args[0]) ?? "");
      const ignoreEmpty = Boolean(unwrapScalar(args[1]));
      const items = flattenArgs(args.slice(2)).map((v) => String(v ?? ""));
      return (ignoreEmpty ? items.filter((s) => s !== "") : items).join(delim);
    }
    case "LEFT": {
      const s = String(unwrapScalar(args[0]) ?? "");
      const n = args[1] !== undefined ? Math.max(0, Math.floor(toNumber(unwrapScalar(args[1]), true))) : 1;
      return s.slice(0, n);
    }
    case "RIGHT": {
      const s = String(unwrapScalar(args[0]) ?? "");
      const n = args[1] !== undefined ? Math.max(0, Math.floor(toNumber(unwrapScalar(args[1]), true))) : 1;
      return n === 0 ? "" : s.slice(-n);
    }
    case "MID": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const s = String(unwrapScalar(args[0]) ?? "");
      const start = Math.max(1, Math.floor(toNumber(unwrapScalar(args[1]), true))) - 1;
      const len = Math.max(0, Math.floor(toNumber(unwrapScalar(args[2]), true)));
      return s.slice(start, start + len);
    }
    case "SUBSTITUTE": {
      if (args.length < 3) throw new FormulaError("#VALUE!");
      const s = String(unwrapScalar(args[0]) ?? "");
      const oldText = String(unwrapScalar(args[1]) ?? "");
      const newText = String(unwrapScalar(args[2]) ?? "");
      return oldText ? s.split(oldText).join(newText) : s;
    }
    case "REPT": {
      const s = String(unwrapScalar(args[0]) ?? "");
      const count = Math.max(0, Math.min(1000, Math.floor(toNumber(unwrapScalar(args[1] ?? 1), true))));
      return s.repeat(count);
    }
    case "VALUE":
      return toNumber(unwrapScalar(args[0] ?? 0), true);
    case "TEXT": {
      const v = unwrapScalar(args[0] ?? "");
      return String(v ?? "");
    }
    case "EXACT":
      return String(unwrapScalar(args[0]) ?? "") === String(unwrapScalar(args[1]) ?? "");
    // Date & Time
    case "TODAY": {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    case "NOW": {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    case "DATE": {
      const y = Math.floor(toNumber(unwrapScalar(args[0] ?? 2026), true));
      const m = Math.floor(toNumber(unwrapScalar(args[1] ?? 1), true));
      const day = Math.floor(toNumber(unwrapScalar(args[2] ?? 1), true));
      const dt = new Date(y, m - 1, day);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }
    case "YEAR":
      return parseDateValue(unwrapScalar(args[0])).getFullYear();
    case "MONTH":
      return parseDateValue(unwrapScalar(args[0])).getMonth() + 1;
    case "DAY":
      return parseDateValue(unwrapScalar(args[0])).getDate();
    case "DAYS": {
      const end = parseDateValue(unwrapScalar(args[0]));
      const start = parseDateValue(unwrapScalar(args[1]));
      return Math.round((end.getTime() - start.getTime()) / 86400000);
    }
    case "DATEDIF": {
      const start = parseDateValue(unwrapScalar(args[0]));
      const end = parseDateValue(unwrapScalar(args[1]));
      const unit = String(unwrapScalar(args[2] ?? "D")).toUpperCase();
      const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000);
      if (unit === "Y") return Math.floor(diffDays / 365.25);
      if (unit === "M") return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      return diffDays;
    }
    default:
      throw new FormulaError("#NAME?");
  }
}

export function parseRawScalar(raw: string): ScalarValue {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.toUpperCase() === "TRUE") return true;
  if (trimmed.toUpperCase() === "FALSE") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed.replace(/,/g, ""));
  }
  if (/^-?\d+(?:\.\d+)?%$/.test(trimmed)) {
    return Number(trimmed.slice(0, -1)) / 100;
  }
  return raw;
}

export function formatScalar(value: ScalarValue, style?: CellStyle): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const fmt = style?.format ?? "auto";
  const decimals = style?.decimals ?? 2;

  if (typeof value === "number" && Number.isFinite(value)) {
    switch (fmt) {
      case "integer":
        return Math.round(value).toLocaleString("en-US");
      case "number":
        return value.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
      case "currency_sar":
        return `${value < 0 ? "-" : ""}SAR ${Math.abs(value).toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}`;
      case "currency_usd":
        return `${value < 0 ? "-" : ""}$${Math.abs(value).toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}`;
      case "accounting":
        return value < 0
          ? `(${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })})`
          : value === 0
            ? "—"
            : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      case "percent":
        return `${(value * 100).toFixed(decimals)}%`;
      case "scientific":
        return value.toExponential(decimals);
      default: {
        if (Number.isInteger(value)) return value.toLocaleString("en-US");
        return Number(value.toFixed(6)).toLocaleString("en-US", { maximumFractionDigits: 4 });
      }
    }
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Smart Autofill Series & Row/Column Structure Operations
// ---------------------------------------------------------------------------

const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AR_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function generateAutofillValue(
  sourceCells: { r: number; c: number; cell?: CellData }[],
  targetR: number,
  targetC: number,
  stepIndex: number,
): CellData {
  if (sourceCells.length === 0) return { v: "" };
  const base = sourceCells[stepIndex % sourceCells.length];
  const raw = base.cell?.v ?? "";
  const style = base.cell?.s ? structuredClone(base.cell.s) : undefined;

  if (raw.startsWith("=")) {
    const dr = targetR - base.r;
    const dc = targetC - base.c;
    return { v: shiftFormulaReferences(raw, dr, dc), s: style };
  }

  // Numeric progression from 2+ cells
  const nums = sourceCells.map((sc) => {
    const v = (sc.cell?.v ?? "").trim();
    return v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;
  });
  if (nums.length >= 2 && nums.every((n): n is number => n !== null)) {
    const step = nums[1] - nums[0];
    const val = nums[0] + step * (sourceCells.length + stepIndex);
    return { v: String(Number(val.toFixed(8))), s: style };
  }

  const trimmed = raw.trim();
  const totalOffset = sourceCells.length + stepIndex;

  // Date YYYY-MM-DD progression
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + totalOffset);
      return {
        v: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        s: style,
      };
    }
  }

  // Weekday / Month lists
  for (const list of [EN_DAYS, AR_DAYS, EN_MONTHS]) {
    const idx = list.findIndex((item) => item.toLowerCase() === trimmed.toLowerCase());
    if (idx !== -1) {
      return { v: list[(idx + totalOffset) % list.length], s: style };
    }
  }

  // Text ending in number ("Item 1" -> "Item 2", "Q1" -> "Q2")
  const suffixMatch = trimmed.match(/^(.*?)(\d+)$/);
  if (suffixMatch) {
    const prefix = suffixMatch[1];
    const startNum = parseInt(suffixMatch[2], 10);
    return { v: `${prefix}${startNum + totalOffset}`, s: style };
  }

  return { v: raw, s: style };
}

/**
 * Inserts or deletes a row or column at `index`, shifting cells and formula references.
 */
export function shiftSheetStructure(
  sheet: SheetData,
  axis: "row" | "col",
  index: number,
  delta: 1 | -1,
): SheetData {
  const nextCells: Record<string, CellData> = {};
  const span = (a: number, b: number) => shiftSpan(a, b, index, delta);
  const at = (ref: ParsedCellRef) => (axis === "row" ? ref.r : ref.c);
  const moved = (ref: ParsedCellRef, pos: number): ParsedCellRef => (axis === "row" ? { ...ref, r: pos } : { ...ref, c: pos });

  for (const [key, cell] of Object.entries(sheet.cells)) {
    const ref = parseCellRef(key);
    if (!ref) continue;
    const s = span(at(ref), at(ref));
    if (!s) continue; // deleted
    const next = moved(ref, s[0]);

    let v = cell.v;
    if (v.startsWith("=")) {
      v = v.replace(FORMULA_REF_RE, (m, quoted: string | undefined, prefix: string | undefined, a: string, b: string | undefined) => {
        if (quoted) return m;
        // A reference to another sheet does not move with this one.
        if (prefix && prefix.slice(0, -1).replace(/^'|'$/g, "") !== sheet.name) return m;
        const p = parseCellRef(a);
        const q = b ? parseCellRef(b) : p;
        if (!p || !q) return m;
        const lo = Math.min(at(p), at(q));
        const hi = Math.max(at(p), at(q));
        const t = span(lo, hi);
        if (!t) return "#REF!";
        const first = formatCellRef(moved(at(p) <= at(q) ? p : q, t[0]));
        if (!b) return (prefix ?? "") + first;
        return `${prefix ?? ""}${first}:${formatCellRef(moved(at(p) <= at(q) ? q : p, t[1]))}`;
      });
    }
    nextCells[cellKey(next.r, next.c)] = { ...cell, v };
  }

  const shiftKeys = <T,>(map: Record<number, T>) => {
    const out: Record<number, T> = {};
    for (const [k, v] of Object.entries(map ?? {})) {
      const s = span(Number(k), Number(k));
      if (s) out[s[0]] = v;
    }
    return out;
  };

  const merges = (sheet.merges ?? []).flatMap((mg) => {
    const s = axis === "row" ? span(mg.r1, mg.r2) : span(mg.c1, mg.c2);
    if (!s) return [];
    const next = axis === "row" ? { ...mg, r1: s[0], r2: s[1] } : { ...mg, c1: s[0], c2: s[1] };
    return next.r1 === next.r2 && next.c1 === next.c2 ? [] : [next];
  });

  const conditionalRules = (sheet.conditionalRules ?? []).flatMap((rule) => {
    const [a, b = a] = rule.range.split(":");
    const p = parseCellRef(a);
    const q = parseCellRef(b);
    if (!p || !q) return [rule];
    const s = span(Math.min(at(p), at(q)), Math.max(at(p), at(q)));
    if (!s) return [];
    const lo = at(p) <= at(q) ? p : q;
    const hi = lo === p ? q : p;
    return [{ ...rule, range: `${formatCellRef(moved(lo, s[0]))}:${formatCellRef(moved(hi, s[1]))}` }];
  });

  const frozen = (n: number) => (index < n ? Math.max(0, n + delta) : n);

  return {
    ...sheet,
    rows: axis === "row" ? Math.max(10, sheet.rows + delta) : sheet.rows,
    cols: axis === "col" ? Math.max(5, sheet.cols + delta) : sheet.cols,
    cells: nextCells,
    colWidths: axis === "col" ? shiftKeys(sheet.colWidths) : sheet.colWidths,
    rowHeights: axis === "row" ? shiftKeys(sheet.rowHeights) : sheet.rowHeights,
    frozenRows: axis === "row" ? frozen(sheet.frozenRows) : sheet.frozenRows,
    frozenCols: axis === "col" ? frozen(sheet.frozenCols) : sheet.frozenCols,
    merges,
    conditionalRules,
    ...(sheet.filter && axis === "col" ? { filter: { ...sheet.filter, colFilters: shiftKeys(sheet.filter.colFilters) } } : {}),
  };
}

/**
 * A quoted string, or a cell reference or range with an optional sheet prefix.
 * Function names such as LOG10( and names glued to letters are left alone.
 */
const FORMULA_REF_RE = /("(?:[^"]|"")*")|((?:'[^']+'|[A-Za-z0-9_؀-ۿ]+)!)?(?<![A-Za-z0-9_$.])(\$?[A-Za-z]{1,3}\$?\d{1,5})(?::(\$?[A-Za-z]{1,3}\$?\d{1,5}))?(?![A-Za-z0-9_(])/g;

/**
 * Where the span lo..hi lands after inserting (delta 1) or deleting (delta -1)
 * the line at `index`, or null when every line of it was deleted. A range that
 * loses its first or last line shrinks, as in Excel.
 */
export function shiftSpan(lo: number, hi: number, index: number, delta: 1 | -1): [number, number] | null {
  if (delta === 1) return [lo >= index ? lo + 1 : lo, hi >= index ? hi + 1 : hi];
  if (lo === index && hi === index) return null;
  return [lo > index ? lo - 1 : lo, hi >= index ? hi - 1 : hi];
}

// ---------------------------------------------------------------------------
// Built-in Workbook Templates
// ---------------------------------------------------------------------------

export interface WorkbookTemplate {
  key: string;
  title: string;
  description: string;
  build: () => WorkbookData;
}

export const WORKBOOK_TEMPLATES: WorkbookTemplate[] = [
  {
    key: "budget_financial",
    title: "Budget and cash flow",
    description: "Monthly revenue, operating expenses, net profit margin, and variance analysis.",
    build: () => {
      const sh = newSheet("الميزانية Budget");
      sh.frozenRows = 1;
      sh.colWidths = { 0: 210, 1: 130, 2: 130, 3: 130, 4: 130 };
      const hdrStyle: CellStyle = { bold: true, bg: "#1e293b", color: "#ffffff", align: "center" };
      sh.cells["A1"] = { v: "البند / البند المالي", s: { ...hdrStyle, align: "left" } };
      sh.cells["B1"] = { v: "المخطط (Planned)", s: hdrStyle };
      sh.cells["C1"] = { v: "الفعلي (Actual)", s: hdrStyle };
      sh.cells["D1"] = { v: "الفارق (Variance)", s: hdrStyle };
      sh.cells["E1"] = { v: "نسبة الإنجاز %", s: hdrStyle };

      const rows: [string, number, number][] = [
        ["إيرادات المبيعات (Sales Revenue)", 85000, 92400],
        ["إيرادات الاشتراكات (Subscriptions)", 35000, 38200],
        ["الرواتب والأجور (Payroll)", -48000, -48000],
        ["البنية السحابية والتقنية (Cloud & SaaS)", -6500, -5900],
        ["التسويق والإعلانات (Marketing)", -14000, -15200],
        ["المصاريف الإدارية والتشغيلية (Ops)", -5500, -5100],
      ];

      rows.forEach(([label, plan, actual], i) => {
        const r = i + 2;
        sh.cells[`A${r}`] = { v: label, s: { bold: false } };
        sh.cells[`B${r}`] = { v: String(plan), s: { format: "currency_sar", decimals: 0, align: "right" } };
        sh.cells[`C${r}`] = { v: String(actual), s: { format: "currency_sar", decimals: 0, align: "right" } };
        sh.cells[`D${r}`] = { v: `=C${r}-B${r}`, s: { format: "currency_sar", decimals: 0, align: "right" } };
        sh.cells[`E${r}`] = { v: `=IFERROR(C${r}/B${r}, 0)`, s: { format: "percent", decimals: 1, align: "right" } };
      });

      const sumStyle: CellStyle = { bold: true, bg: "#dbeafe", color: "#1e3a8a", format: "currency_sar", decimals: 0, align: "right" };
      sh.cells["A8"] = { v: "صافي الربح (Net Profit)", s: { bold: true, bg: "#dbeafe", color: "#1e3a8a" } };
      sh.cells["B8"] = { v: "=SUM(B2:B7)", s: sumStyle };
      sh.cells["C8"] = { v: "=SUM(C2:C7)", s: sumStyle };
      sh.cells["D8"] = { v: "=C8-B8", s: sumStyle };
      sh.cells["E8"] = { v: "=IFERROR(C8/B8, 0)", s: { ...sumStyle, format: "percent", decimals: 1 } };

      sh.cells["A10"] = { v: "هامش الربح الصافي (Net Margin)", s: { bold: true } };
      sh.cells["C10"] = { v: "=C8/(C2+C3)", s: { bold: true, format: "percent", decimals: 1, bg: "#dcfce7", color: "#14532d" } };

      return { sheets: [sh], activeSheetId: sh.id };
    },
  },
  {
    key: "kpi_roadmap",
    title: "KPI and goal tracker",
    description: "Track quarterly objectives, baseline, target, current score, and automated status.",
    build: () => {
      const sh = newSheet("KPIs & OKRs");
      sh.frozenRows = 1;
      sh.colWidths = { 0: 230, 1: 120, 2: 110, 3: 110, 4: 120, 5: 130 };
      const hdr: CellStyle = { bold: true, bg: "#0f172a", color: "#ffffff", align: "center" };
      ["المؤشر (KPI)", "القسم (Team)", "الخط الأساسي", "المستهدف (Target)", "الحالي (Current)", "نسبة التحقيق"].forEach((t, c) => {
        sh.cells[cellKey(0, c)] = { v: t, s: hdr };
      });
      const items: [string, string, number, number, number][] = [
        ["معدل الاحتفاظ بالعملاء (Retention %)", "Product", 78, 92, 89],
        ["متوسط زمن الاستجابة (Response ms)", "Engineering", 420, 180, 210],
        ["الإيراد الشهري المتكرر (MRR kSAR)", "Growth", 110, 180, 165],
        ["رضا العملاء (NPS Score)", "Support", 42, 65, 61],
      ];
      items.forEach(([kpi, team, base, target, cur], idx) => {
        const r = idx + 2;
        sh.cells[`A${r}`] = { v: kpi, s: { bold: true } };
        sh.cells[`B${r}`] = { v: team, s: { align: "center" } };
        sh.cells[`C${r}`] = { v: String(base), s: { format: "number", decimals: 0, align: "right" } };
        sh.cells[`D${r}`] = { v: String(target), s: { format: "number", decimals: 0, align: "right" } };
        sh.cells[`E${r}`] = { v: String(cur), s: { format: "number", decimals: 0, align: "right" } };
        sh.cells[`F${r}`] = { v: `=IFERROR((E${r}-C${r})/(D${r}-C${r}), 0)`, s: { format: "percent", decimals: 1, bold: true } };
      });
      sh.cells["A7"] = { v: "متوسط الإنجاز العام", s: { bold: true, bg: "#f1f5f9" } };
      sh.cells["F7"] = { v: "=AVERAGE(F2:F5)", s: { bold: true, format: "percent", decimals: 1, bg: "#dcfce7", color: "#15803d" } };
      return { sheets: [sh], activeSheetId: sh.id };
    },
  },
  {
    key: "gradebook_gpa",
    title: "Weighted scoring matrix",
    description: "Automatic weighted totals, letter grades, rank, and statistical distribution.",
    build: () => {
      const sh = newSheet("التقييمات والاوزان");
      sh.frozenRows = 1;
      sh.colWidths = { 0: 190, 1: 110, 2: 110, 3: 110, 4: 120, 5: 110 };
      const hdr: CellStyle = { bold: true, bg: "#312e81", color: "#ffffff", align: "center" };
      ["العنصر / المقرر", "المرحلة 1 (25%)", "المرحلة 2 (25%)", "النهائي (50%)", "المجموع الموزون", "التقدير"].forEach((t, c) => {
        sh.cells[cellKey(0, c)] = { v: t, s: hdr };
      });
      const rows: [string, number, number, number][] = [
        ["تحليل النظم والخوارزميات", 92, 88, 95],
        ["إدارة المشاريع الهندسية", 85, 90, 89],
        ["الأمن السيبراني والشبكات", 78, 84, 86],
        ["الذكاء الاصطناعي التطبيقي", 96, 94, 98],
      ];
      rows.forEach(([name, p1, p2, fin], idx) => {
        const r = idx + 2;
        sh.cells[`A${r}`] = { v: name };
        sh.cells[`B${r}`] = { v: String(p1), s: { format: "number", decimals: 0 } };
        sh.cells[`C${r}`] = { v: String(p2), s: { format: "number", decimals: 0 } };
        sh.cells[`D${r}`] = { v: String(fin), s: { format: "number", decimals: 0 } };
        sh.cells[`E${r}`] = { v: `=B${r}*0.25+C${r}*0.25+D${r}*0.5`, s: { bold: true, format: "number", decimals: 1 } };
        sh.cells[`F${r}`] = {
          v: `=IFS(E${r}>=95,"A+",E${r}>=90,"A",E${r}>=85,"B+",E${r}>=80,"B",TRUE,"C")`,
          s: { bold: true, align: "center", bg: "#ede9fe", color: "#4c1d95" },
        };
      });
      sh.cells["A7"] = { v: "المتوسط العام (Average)", s: { bold: true } };
      sh.cells["E7"] = { v: "=AVERAGE(E2:E5)", s: { bold: true, format: "number", decimals: 2, bg: "#fef3c7" } };
      return { sheets: [sh], activeSheetId: sh.id };
    },
  },
];
