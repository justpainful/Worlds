/**
 * Formula properties: a small, safe expression language over a page's
 * properties. No JavaScript is evaluated; the parser builds a tree and the
 * evaluator walks it.
 *
 *   prop("Due")                 another property's value (also: Due, when the name has no spaces)
 *   days(prop("Due"))           days from today to a date (negative when it has passed)
 *   if(prop("Done"), "✓", "")   choose a value
 *   round(prop("Hours") * 1.5, 1)
 *   count(prop("Tasks"))        pages in a relation
 *   rollup(prop("Tasks"), "Hours", "sum")   sum, avg, min, max, count, done (percent with Status Done)
 *
 * Operators: + - * / %  == != < <= > >=  and or not  ( ).  Text joins with +.
 */
import type { PageMeta } from "../lib/types";
import { propsOf, type Property } from "./properties";

export type FValue = number | string | boolean | null | string[];

type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "name"; v: string }
  | { t: "call"; name: string; args: Node[] }
  | { t: "un"; op: string; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node };

type Tok = { k: "num" | "str" | "id" | "op" | "("  | ")" | ","; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j])) j++;
      out.push({ k: "num", v: src.slice(i, j).replace(/_/g, "") });
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "“" || c === "”") {
      const close = c === "“" ? "”" : c;
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== close && !(close === "”" && src[j] === '"')) {
        if (src[j] === "\\" && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new Error("A text value is missing its closing quote");
      out.push({ k: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_]/u.test(src[j])) j++;
      out.push({ k: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      out.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/%<>!=".includes(c)) {
      out.push({ k: "op", v: c === "=" ? "==" : c });
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === "," || c === "،") {
      out.push({ k: c === "،" ? "," : (c as "(" | ")" | ","), v: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...ops: string[]) => peek()?.k === "op" && ops.includes(peek().v);
  const isWord = (...w: string[]) => peek()?.k === "id" && w.includes(peek().v.toLowerCase());
  const expect = (k: Tok["k"]) => {
    const t = toks[p++];
    if (!t || t.k !== k) throw new Error(`Expected ${k === "," ? "a comma" : k === ")" ? "a closing bracket" : k}`);
    return t;
  };
  const or = (): Node => {
    let a = and();
    while (isOp("||") || isWord("or")) {
      p++;
      a = { t: "bin", op: "or", a, b: and() };
    }
    return a;
  };
  const and = (): Node => {
    let a = cmp();
    while (isOp("&&") || isWord("and")) {
      p++;
      a = { t: "bin", op: "and", a, b: cmp() };
    }
    return a;
  };
  const cmp = (): Node => {
    const a = add();
    if (isOp("==", "!=", "<", "<=", ">", ">=")) {
      const op = toks[p++].v;
      return { t: "bin", op, a, b: add() };
    }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (isOp("+", "-")) {
      const op = toks[p++].v;
      a = { t: "bin", op, a, b: mul() };
    }
    return a;
  };
  const mul = (): Node => {
    let a = unary();
    while (isOp("*", "/", "%")) {
      const op = toks[p++].v;
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp("-")) {
      p++;
      return { t: "un", op: "-", a: unary() };
    }
    if (isOp("!") || isWord("not")) {
      p++;
      return { t: "un", op: "not", a: unary() };
    }
    return primary();
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error("The formula ends too early");
    if (t.k === "num") {
      const v = Number(t.v);
      if (!Number.isFinite(v)) throw new Error(`"${t.v}" is not a number`);
      return { t: "num", v };
    }
    if (t.k === "str") return { t: "str", v: t.v };
    if (t.k === "(") {
      const e = or();
      expect(")");
      return e;
    }
    if (t.k === "id") {
      const low = t.v.toLowerCase();
      if (low === "true") return { t: "bool", v: true };
      if (low === "false") return { t: "bool", v: false };
      if (peek()?.k === "(") {
        p++;
        const args: Node[] = [];
        if (peek()?.k !== ")") {
          args.push(or());
          while (peek()?.k === ",") {
            p++;
            args.push(or());
          }
        }
        expect(")");
        return { t: "call", name: low, args };
      }
      return { t: "name", v: t.v };
    }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const tree = or();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return tree;
}

const cache = new Map<string, Node | Error>();
function compiled(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    try {
      n = parse(src);
    } catch (e) {
      n = e instanceof Error ? e : new Error(String(e));
    }
    if (cache.size > 500) cache.clear();
    cache.set(src, n);
  }
  if (n instanceof Error) throw n;
  return n;
}

/** Check a formula without running it: null when it parses, else the reason. */
export function formulaError(src: string): string | null {
  if (!src.trim()) return null;
  try {
    compiled(src);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const DAY = 86400000;
const toDate = (v: FValue): Date | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const num = (v: FValue): number => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : Array.isArray(v) ? v.length : 0);
const truthy = (v: FValue): boolean => (Array.isArray(v) ? v.length > 0 : Boolean(v));
const str = (v: FValue): string => (v === null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v));
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Ctx {
  page: PageMeta;
  pages: Record<string, PageMeta>;
  depth: number;
}

function propValue(ctx: Ctx, page: PageMeta, name: string): FValue {
  const p = propsOf(page).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) {
    const low = name.toLowerCase();
    if (low === "title" || low === "name") return page.title ?? "";
    if (low === "created") return iso(new Date(page.createdAt));
    if (low === "edited" || low === "updated") return iso(new Date(page.updatedAt));
    return null;
  }
  if (p.type === "formula") {
    if (ctx.depth > 6) throw new Error("Formulas refer to each other in a loop");
    return evaluateFormula(p.formula ?? "", page, ctx.pages, ctx.depth + 1);
  }
  return p.value as FValue;
}

function call(ctx: Ctx, name: string, args: Node[]): FValue {
  const v = (i: number) => ev(ctx, args[i]);
  const need = (n: number) => {
    if (args.length < n) throw new Error(`${name}() needs ${n} value${n > 1 ? "s" : ""}`);
  };
  switch (name) {
    case "prop":
      need(1);
      return propValue(ctx, ctx.page, str(v(0)));
    case "if":
      need(2);
      return truthy(v(0)) ? v(1) : args.length > 2 ? v(2) : null;
    case "now":
      return new Date().toISOString();
    case "today":
      return iso(new Date());
    case "days": {
      need(1);
      const d = toDate(v(0));
      return d ? Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / DAY) : null;
    }
    case "daysbetween": {
      need(2);
      const a = toDate(v(0));
      const b = toDate(v(1));
      return a && b ? Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY) : null;
    }
    case "adddays": {
      need(2);
      const d = toDate(v(0));
      return d ? iso(new Date(d.getTime() + num(v(1)) * DAY)) : null;
    }
    case "year":
      return toDate(v(0))?.getFullYear() ?? null;
    case "month":
      return (toDate(v(0))?.getMonth() ?? -1) + 1 || null;
    case "round": {
      need(1);
      const k = 10 ** (args.length > 1 ? num(v(1)) : 0);
      return Math.round(num(v(0)) * k) / k;
    }
    case "floor":
      return Math.floor(num(v(0)));
    case "ceil":
      return Math.ceil(num(v(0)));
    case "abs":
      return Math.abs(num(v(0)));
    case "min":
      return Math.min(...args.map((_, i) => num(v(i))));
    case "max":
      return Math.max(...args.map((_, i) => num(v(i))));
    case "length": {
      const x = v(0);
      return Array.isArray(x) ? x.length : str(x).length;
    }
    case "lower":
      return str(v(0)).toLowerCase();
    case "upper":
      return str(v(0)).toUpperCase();
    case "concat":
      return args.map((_, i) => str(v(i))).join("");
    case "contains":
      need(2);
      return Array.isArray(v(0)) ? (v(0) as string[]).includes(str(v(1))) : str(v(0)).toLowerCase().includes(str(v(1)).toLowerCase());
    case "empty": {
      const x = v(0);
      return x === null || x === "" || (Array.isArray(x) && !x.length);
    }
    case "text":
    case "format":
      return str(v(0));
    case "number":
      return num(v(0));
    case "count": {
      const x = v(0);
      return Array.isArray(x) ? x.filter((id) => ctx.pages[id] && !ctx.pages[id].deletedAt).length : x === null || x === "" ? 0 : 1;
    }
    case "rollup": {
      need(3);
      const ids = v(0);
      const field = str(v(1));
      const op = str(v(2)).toLowerCase();
      const linked = (Array.isArray(ids) ? ids : []).map((id) => ctx.pages[id]).filter((p): p is PageMeta => !!p && !p.deletedAt);
      if (op === "count") return linked.length;
      if (op === "done") {
        if (!linked.length) return 0;
        const done = linked.filter((p) => /^(done|منجز|مكتمل|تم)$/i.test(str(propValue(ctx, p, field || "Status")))).length;
        return Math.round((done / linked.length) * 100);
      }
      const nums = linked.map((p) => propValue(ctx, p, field)).filter((x) => x !== null && x !== "").map(num);
      if (!nums.length) return 0;
      if (op === "sum") return nums.reduce((s, x) => s + x, 0);
      if (op === "avg" || op === "average") return nums.reduce((s, x) => s + x, 0) / nums.length;
      if (op === "min") return Math.min(...nums);
      if (op === "max") return Math.max(...nums);
      throw new Error(`rollup() does not know "${op}"`);
    }
    default:
      throw new Error(`Unknown function ${name}()`);
  }
}

function ev(ctx: Ctx, n: Node): FValue {
  switch (n.t) {
    case "num":
      return n.v;
    case "str":
      return n.v;
    case "bool":
      return n.v;
    case "name":
      return propValue(ctx, ctx.page, n.v);
    case "call":
      return call(ctx, n.name, n.args);
    case "un": {
      const a = ev(ctx, n.a);
      return n.op === "-" ? -num(a) : !truthy(a);
    }
    case "bin": {
      if (n.op === "and") return truthy(ev(ctx, n.a)) && truthy(ev(ctx, n.b));
      if (n.op === "or") return truthy(ev(ctx, n.a)) || truthy(ev(ctx, n.b));
      const a = ev(ctx, n.a);
      const b = ev(ctx, n.b);
      switch (n.op) {
        case "+":
          return typeof a === "number" && typeof b === "number" ? a + b : typeof a === "string" || typeof b === "string" ? str(a) + str(b) : num(a) + num(b);
        case "-":
          return num(a) - num(b);
        case "*":
          return num(a) * num(b);
        case "/":
          return num(b) === 0 ? null : num(a) / num(b);
        case "%":
          return num(b) === 0 ? null : num(a) % num(b);
        case "==":
          return str(a) === str(b);
        case "!=":
          return str(a) !== str(b);
        case "<":
          return typeof a === "string" && typeof b === "string" ? a < b : num(a) < num(b);
        case "<=":
          return typeof a === "string" && typeof b === "string" ? a <= b : num(a) <= num(b);
        case ">":
          return typeof a === "string" && typeof b === "string" ? a > b : num(a) > num(b);
        case ">=":
          return typeof a === "string" && typeof b === "string" ? a >= b : num(a) >= num(b);
      }
    }
  }
  return null;
}

/** Run a formula for a page. Errors come back as a message prefixed with "⚠". */
export function evaluateFormula(src: string, page: PageMeta, pages: Record<string, PageMeta>, depth = 0): FValue {
  if (!src.trim()) return null;
  const v = ev({ page, pages, depth }, compiled(src));
  return typeof v === "number" ? (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null) : v;
}

/**
 * A page's properties with every formula worked out, for display. The
 * stored value of a formula property is ignored; errors show as text.
 */
export function computedProps(page: PageMeta, pages: Record<string, PageMeta>): Property[] {
  const props = propsOf(page);
  if (!props.some((p) => p.type === "formula")) return props;
  return props.map((p) => {
    if (p.type !== "formula") return p;
    try {
      const v = evaluateFormula(p.formula ?? "", page, pages);
      return { ...p, value: v as Property["value"] };
    } catch (e) {
      return { ...p, value: `⚠ ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}

/** The same page with formulas filled in, so collections can show, sort and group by them. */
export function withComputed(page: PageMeta, pages: Record<string, PageMeta>): PageMeta {
  const props = computedProps(page, pages);
  return props === propsOf(page) ? page : { ...page, properties: props as unknown as PageMeta["properties"] };
}
