/**
 * The live page on enterworlds.space: a small Worlds page the visitor builds
 * on the front page. Its blocks run on the app's own code, bundled from src/:
 * the formula engine (src/spreadsheet/engine.ts), quick add
 * (src/planning/quickAdd.ts), the brush and shape recognition
 * (src/drawing/brush.ts, recognition.ts). Nothing leaves the browser; the
 * page is kept in localStorage and can be opened in Worlds on the web.
 *
 * Built by `node web/build-site.mjs` into web/site/live.js.
 */
import { cellKey, evaluateWorkbook, newWorkbook, type WorkbookData } from "../../src/spreadsheet/engine";
import { parseQuickAdd } from "../../src/planning/quickAdd";
import { recognizeShape, type RecognizedShape } from "../../src/drawing/recognition";
import { strokeDabs } from "../../src/drawing/brush";
import { DEFAULT_BRUSH, type Brush, type Sample } from "../../src/drawing/model";

type Kind = "text" | "table" | "tasks" | "drawing" | "slides";
interface Task { id: string; title: string; due: string | null; time: string | null; priority: number; done: boolean }
interface Stroke { color: string; pts: number[]; shape?: { kind: string; x: number; y: number; w: number; h: number; points?: number[] } }
interface Block { id: string; kind: Kind; text?: string; cells?: Record<string, string>; tasks?: Task[]; strokes?: Stroke[] }
interface PageState { v: 1; title: string; blocks: Block[] }

const AR = document.documentElement.lang === "ar";
const APP = "https://app.enterworlds.space";
const KEY = `worlds.site.livepage.${AR ? "ar" : "en"}`;
const still = matchMedia("(prefers-reduced-motion: reduce)");

const T = AR
  ? {
      title: "صفحتي الأولى",
      add: "اكتب / لإضافة كتلة، أو اكتب نصًا واضغط Enter",
      text: "نص", table: "جدول", tasks: "مهام", drawing: "رسم", slides: "عرض",
      textHint: "فقرة تكتبها", tableHint: "يحسب بمحرك الصيغ نفسه", tasksHint: "يفهم «بكرة 4م»", drawingHint: "يعدّل الأشكال المرسومة", slidesHint: "صفحتك شرائح",
      grip: "اسحب لتغيير الترتيب، أو استخدم الأسهم", remove: "احذف الكتلة",
      cells: [["المادة", "الدرجة"], ["الأحياء", "92"], ["الرياضيات", "87"], ["الكيمياء", "78"], ["", ""], ["المعدل", "=ROUND(AVERAGE(B2:B5),1)"]],
      tableTip: ["اختر خلية واكتب. جرّب درجة في B5، أو صيغة مثل", "=MAX(B2:B5)"],
      seeds: ["مراجعة الفصل الثالث اليوم 6م", "تسليم تقرير الطاقة المتجددة الخميس !!"],
      taskInput: "أضف مهمة… جرّب: اتصل بالبنك بكرة 4م",
      willAdd: "ستُضاف", today: "اليوم", tomorrow: "غدًا", high: "مهم",
      days: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
      draw: "ارسم هنا. ارسم دائرة أو مثلثًا أو مستطيلًا، ويعتدل بعد أن ترفع القلم.",
      straighten: "تعديل الأشكال", undo: "تراجع", clear: "مسح",
      colors: ["حبر", "طين", "أخضر"],
      slide: "شريحة", of: "من", prev: "السابقة", next: "التالية", full: "ملء الشاشة",
      emptyPage: "أضف كتلًا إلى صفحتك، وتظهر هنا شرائح.",
      open: "افتح صفحتك في Worlds", reset: "ابدأ من جديد", example: "املأها بمثال",
      exampleText: "خطة أسبوع الاختبارات: أراجع كل يوم مادة، وأحسب معدلي، وأرسم خريطة للفصل الصعب.",
      kept: "صفحتك محفوظة في هذا المتصفح فقط.",
      handOff: "يُنقل النص والمهام والجدول. الرسم يبقى هنا.",
      formula: "صيغة",
    }
  : {
      title: "My first page",
      add: "Type / to add a block, or type text and press Enter",
      text: "Text", table: "Table", tasks: "Tasks", drawing: "Drawing", slides: "Present",
      textHint: "A paragraph", tableHint: "The same formula engine", tasksHint: "Understands “tomorrow 4pm”", drawingHint: "Straightens drawn shapes", slidesHint: "Your page as slides",
      grip: "Drag to reorder, or use the arrow keys", remove: "Remove the block",
      cells: [["Subject", "Grade"], ["Biology", "92"], ["Maths", "87"], ["Chemistry", "78"], ["", ""], ["Average", "=ROUND(AVERAGE(B2:B5),1)"]],
      tableTip: ["Pick a cell and type. Try a grade in B5, or a formula such as", "=MAX(B2:B5)"],
      seeds: ["Review chapter 3 today 6pm", "Hand in the energy report thursday !!"],
      taskInput: "Add a task… try: call the bank tomorrow 4pm",
      willAdd: "Adds", today: "Today", tomorrow: "Tomorrow", high: "Important",
      days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      draw: "Draw here. Draw a circle, a triangle or a box, and it straightens when you lift the pen.",
      straighten: "Straighten shapes", undo: "Undo", clear: "Clear",
      colors: ["Ink", "Clay", "Green"],
      slide: "Slide", of: "of", prev: "Previous", next: "Next", full: "Full screen",
      emptyPage: "Add blocks to your page and they show here as slides.",
      open: "Open your page in Worlds", reset: "Start over", example: "Fill it with an example",
      exampleText: "Exam week plan: one subject a day, my average worked out, and a map of the hard chapter.",
      kept: "Your page is kept in this browser only.",
      handOff: "Text, tasks and the table go across. The drawing stays here.",
      formula: "Formula",
    };

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- DOM helpers
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== false && kid !== undefined) el.append(kid);
  return el;
}
const SVGNS = "http://www.w3.org/2000/svg";
const ICONS: Record<string, string> = {
  grip: "M9 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 18.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
  close: "M6.7 5.3 12 10.6l5.3-5.3 1.4 1.4-5.3 5.3 5.3 5.3-1.4 1.4-5.3-5.3-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3Z",
  text: "M5 5h14v2.4h-5.8V19h-2.4V7.4H5Z",
  table: "M4 5h16v14H4Zm2 2v3h5V7Zm7 0v3h5V7Zm-7 5v5h5v-5Zm7 0v5h5v-5Z",
  tasks: "M9.6 7.2 7 9.8 5.4 8.2l-1.1 1.1L7 12l3.7-3.7Zm2.4.8h8v2h-8Zm-2.4 6.2L7 16.8l-1.6-1.6-1.1 1.1L7 19l3.7-3.7Zm2.4.8h8v2h-8Z",
  drawing: "M16.9 3.6a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L9.2 18.3 4 20l1.7-5.2Zm-9.7 12-.6 1.8 1.8-.6 8-8-1.2-1.2Z",
  slides: "M3 5h18v11H3Zm2 2v7h14V7Zm5 10h4l1 3H9Z",
  chevron: "M9.3 6.3 15 12l-5.7 5.7-1.4-1.4L12.2 12 7.9 7.7Z",
  expand: "M4 4h6v2H6v4H4Zm10 0h6v6h-2V6h-4ZM4 14h2v4h4v2H4Zm14 0h2v6h-6v-2h4Z",
  undo: "M9 7V4L3.5 9 9 14v-3h4.5a3.5 3.5 0 0 1 0 7H11v2h2.5a5.5 5.5 0 0 0 0-11Z",
};
function icon(name: string, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ic");
  const p = document.createElementNS(SVGNS, "path");
  p.setAttribute("d", ICONS[name]);
  p.setAttribute("fill", "currentColor");
  svg.append(p);
  return svg;
}

// ---------------------------------------------------------------- state
let state: PageState = load();
function load(): PageState {
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as PageState) : null;
    if (s?.v === 1 && Array.isArray(s.blocks)) return s;
  } catch {
    // a private window or a broken copy: start fresh
  }
  return { v: 1, title: T.title, blocks: [] };
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // storage full or blocked: the page still works for this visit
    }
  }, 250);
}
const blockOf = (id: string) => state.blocks.find((b) => b.id === id);

function newBlock(kind: Kind, text = ""): Block {
  const b: Block = { id: uid(), kind };
  if (kind === "text") b.text = text;
  if (kind === "table") {
    b.cells = {};
    T.cells.forEach((row, r) => row.forEach((v, c) => v && (b.cells![cellKey(r, c)] = v)));
  }
  if (kind === "tasks") b.tasks = T.seeds.map((s) => taskFrom(s)).filter((t): t is Task => !!t);
  if (kind === "drawing") b.strokes = [];
  return b;
}

/** Keeps a drag on its element; some pointers (and synthetic ones) cannot be captured, and the drag still works. */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    // not capturable
  }
}

/** Every kind of block, filled in: one click (or a link ending in #example) to see the whole page. */
function exampleBlocks(): Block[] {
  const drawing = newBlock("drawing");
  const wave: number[] = [];
  for (let i = 0; i <= 40; i++) wave.push(0.5 + i * 0.011, 0.62 + Math.sin(i / 4) * 0.12, 0.45 + 0.3 * Math.sin(i / 9));
  drawing.strokes = [
    { color: "--terra", pts: [], shape: { kind: "ellipse", x: 0.08, y: 0.18, w: 0.22, h: 0.62 } },
    { color: "--teal", pts: [], shape: { kind: "triangle", x: 0.34, y: 0.2, w: 0.12, h: 0.56, points: [0.4, 0.2, 0.46, 0.76, 0.34, 0.76] } },
    { color: "--ink", pts: wave },
  ];
  return [newBlock("text", T.exampleText), newBlock("tasks"), newBlock("table"), drawing, newBlock("slides")];
}

// ---------------------------------------------------------------- dates
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dueLabel(due: string | null, time: string | null): string {
  const parts: string[] = [];
  if (due) {
    const now = new Date();
    const [y, m, d] = due.split("-").map(Number);
    const day = new Date(y, m - 1, d);
    const diff = Math.round((day.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
    if (diff === 0) parts.push(T.today);
    else if (diff === 1) parts.push(T.tomorrow);
    else if (diff > 1 && diff < 7) parts.push(T.days[day.getDay()]);
    else parts.push(AR ? `${d} ${MONTHS_AR[m - 1]}` : day.toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
  }
  if (time) {
    const [hh, mm] = time.split(":").map(Number);
    const h12 = hh % 12 || 12;
    parts.push(AR ? `${h12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "ص" : "م"}` : `${h12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`);
  }
  return parts.join(" · ");
}
function taskFrom(input: string): Task | null {
  const p = parseQuickAdd(input);
  if (!p.title.trim()) return null;
  return { id: uid(), title: p.title.trim(), due: p.due, time: p.time, priority: p.priority, done: false };
}

// ---------------------------------------------------------------- page

let blocksEl: HTMLElement;
let slideRefresh: (() => void)[] = [];

function mount(root: HTMLElement) {
  root.classList.add("is-live");
  const titleEl = root.querySelector<HTMLElement>(".live-title")!;
  titleEl.textContent = state.title;
  titleEl.contentEditable = "plaintext-only";
  titleEl.spellcheck = false;
  titleEl.addEventListener("input", () => {
    state.title = titleEl.textContent?.trim() || T.title;
    save();
    refreshSlides();
  });
  titleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.focus();
    }
  });
  blocksEl = root.querySelector<HTMLElement>(".live-blocks")!;
  for (const b of state.blocks) blocksEl.append(renderBlock(b));

  // The line that adds blocks: "/" opens the menu, plain text becomes a paragraph.
  const items: { kind: Kind; label: string; hint: string }[] = [
    { kind: "text", label: T.text, hint: T.textHint },
    { kind: "table", label: T.table, hint: T.tableHint },
    { kind: "tasks", label: T.tasks, hint: T.tasksHint },
    { kind: "drawing", label: T.drawing, hint: T.drawingHint },
    { kind: "slides", label: T.slides, hint: T.slidesHint },
  ];
  const addLine = root.querySelector<HTMLElement>(".live-add")!;
  const input = h("input", { class: "live-input", type: "text", placeholder: T.add, "aria-label": T.add, autocomplete: "off", role: "combobox", "aria-expanded": "false", "aria-controls": "live-menu" });
  const menu = h("div", { class: "live-menu", id: "live-menu", role: "listbox", hidden: true });
  let shown: typeof items = [];
  let active = 0;
  const paint = () => {
    menu.replaceChildren(
      ...shown.map((it, i) =>
        h(
          "button",
          { class: `live-menu-item${i === active ? " is-active" : ""}`, type: "button", role: "option", "aria-selected": String(i === active), onmousedown: (e: Event) => e.preventDefault(), onclick: () => insert(it.kind) },
          h("span", { class: "mi-ic" }, icon(it.kind, 18)),
          h("span", { class: "mi-text" }, h("strong", {}, it.label), h("small", {}, it.hint)),
        ),
      ),
    );
  };
  const openMenu = (q: string) => {
    const needle = q.toLowerCase();
    shown = items.filter((it) => !needle || it.label.toLowerCase().includes(needle) || it.kind.includes(needle));
    active = 0;
    menu.hidden = !shown.length;
    input.setAttribute("aria-expanded", String(!menu.hidden));
    paint();
  };
  const closeMenu = () => {
    menu.hidden = true;
    input.setAttribute("aria-expanded", "false");
  };
  const insert = (kind: Kind, text = "") => {
    const b = newBlock(kind, text);
    state.blocks.push(b);
    save();
    const el = renderBlock(b);
    blocksEl.append(el);
    if (!still.matches) el.classList.add("lb-enter");
    input.value = "";
    closeMenu();
    refreshSlides();
    (el.querySelector<HTMLElement>("[data-focus]") ?? input).focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", behavior: still.matches ? "auto" : "smooth" });
  };
  input.addEventListener("input", () => (input.value.startsWith("/") ? openMenu(input.value.slice(1)) : closeMenu()));
  input.addEventListener("keydown", (e) => {
    if (!menu.hidden) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
        paint();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        insert(shown[active].kind);
        return;
      }
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
    }
    if (e.key === "Enter" && input.value.trim() && !input.value.startsWith("/")) {
      e.preventDefault();
      insert("text", input.value.trim());
    }
  });
  input.addEventListener("blur", () => setTimeout(closeMenu, 120));
  const chips = h(
    "div",
    { class: "live-chips" },
    ...items.map((it) => h("button", { class: "live-chip", type: "button", onclick: () => insert(it.kind) }, icon(it.kind, 16), h("span", {}, it.label))),
  );
  addLine.replaceChildren(h("div", { class: "live-line" }, h("span", { class: "live-caret", "aria-hidden": "true" }, "/"), input, menu), chips);

  // Under the page: open it in Worlds, or start over.
  const foot = root.querySelector<HTMLElement>(".live-foot");
  if (foot) {
    foot.replaceChildren(
      h("p", { class: "live-kept" }, `${T.kept} ${T.handOff}`),
      h(
        "div",
        { class: "live-actions" },
        h("a", { class: "btn primary", href: APP, onclick: (e: Event) => openInWorlds(e) }, T.open),
        h("button", { class: "btn", type: "button", onclick: () => fillExample() }, T.example),
        h("button", { class: "btn", type: "button", onclick: () => reset() }, T.reset),
      ),
    );
  }

  function fillExample() {
    blocksEl.querySelectorAll(".lb[data-id]").forEach((n) => n.remove());
    slideRefresh = [];
    state.blocks = exampleBlocks();
    save();
    for (const b of state.blocks) {
      const el = renderBlock(b);
      blocksEl.append(el);
      if (!still.matches) el.classList.add("lb-enter");
    }
    refreshSlides();
  }
  if (location.hash === "#example") fillExample();

  function reset() {
    state = { v: 1, title: T.title, blocks: [] };
    save();
    titleEl.textContent = state.title;
    blocksEl.querySelectorAll(".lb[data-id]").forEach((n) => n.remove());
    slideRefresh = [];
  }
}

// ---------------------------------------------------------------- blocks
function renderBlock(b: Block): HTMLElement {
  const body = h("div", { class: "lb-body" });
  const grip = h("button", { class: "lb-grip", type: "button", "aria-label": T.grip, title: T.grip }, icon("grip", 18));
  const remove = h("button", { class: "lb-remove", type: "button", "aria-label": T.remove, title: T.remove }, icon("close", 16));
  const el = h("div", { class: `lb lb-${b.kind}`, "data-id": b.id }, grip, body, remove);
  remove.addEventListener("click", () => {
    state.blocks = state.blocks.filter((x) => x.id !== b.id);
    save();
    el.remove();
    refreshSlides();
  });
  dragToReorder(el, grip);
  if (b.kind === "text") body.append(textBlock(b));
  if (b.kind === "table") body.append(tableBlock(b));
  if (b.kind === "tasks") body.append(tasksBlock(b));
  if (b.kind === "drawing") body.append(drawingBlock(b));
  if (b.kind === "slides") body.append(slidesBlock(b));
  return el;
}

function textBlock(b: Block): HTMLElement {
  const p = h("p", { class: "lt-text", "data-focus": "" });
  p.contentEditable = "plaintext-only";
  p.textContent = b.text ?? "";
  p.addEventListener("input", () => {
    b.text = p.textContent ?? "";
    save();
    refreshSlides();
  });
  return p;
}

// Table: the cells are a real workbook, evaluated by Worlds' formula engine.
function tableBlock(b: Block): HTMLElement {
  const ROWS = 6, COLS = 2;
  const wb: WorkbookData = newWorkbook();
  const sheet = wb.sheets[0];
  let sel = { r: 4, c: 1 };
  const ref = h("span", { class: "tb-ref" });
  const fx = h("input", { class: "tb-input", type: "text", "aria-label": T.formula, spellcheck: "false", "data-focus": "" });
  const grid = h("table", { class: "tb-grid" });
  const tip = h("p", { class: "tb-tip" }, `${T.tableTip[0]} `, h("code", { dir: "ltr" }, T.tableTip[1]));
  let values: Record<string, { display: string; error: string | null; numeric: number | null; isFormula: boolean }> = {};
  const evaluate = () => {
    sheet.cells = {};
    for (const [k, v] of Object.entries(b.cells ?? {})) if (v) sheet.cells[k] = { v };
    values = evaluateWorkbook(wb)[sheet.id] ?? {};
  };
  const render = (flash: string[] = []) => {
    const head = h("tr", {}, h("th", { class: "tb-corner" }), ...Array.from({ length: COLS }, (_, c) => h("th", { scope: "col" }, String.fromCharCode(65 + c))));
    const rows = Array.from({ length: ROWS }, (_, r) =>
      h(
        "tr",
        {},
        h("th", { scope: "row" }, String(r + 1)),
        ...Array.from({ length: COLS }, (_, c) => {
          const k = cellKey(r, c), v = values[k];
          const td = h(
            "td",
            {
              class: [r === 0 ? "is-head" : "", v?.isFormula ? "is-formula" : "", v?.numeric !== null && v?.numeric !== undefined ? "is-num" : "", sel.r === r && sel.c === c ? "is-sel" : "", flash.includes(k) ? "is-flash" : ""].filter(Boolean).join(" "),
              tabindex: sel.r === r && sel.c === c ? 0 : -1,
              "data-r": r,
              "data-c": c,
            },
            v?.error ? h("span", { class: "tb-err" }, v.display || "#ERR") : v?.display ?? "",
          );
          return td;
        }),
      ),
    );
    grid.replaceChildren(h("thead", {}, head), h("tbody", {}, ...rows));
    ref.textContent = cellKey(sel.r, sel.c);
    if (document.activeElement !== fx) fx.value = b.cells?.[cellKey(sel.r, sel.c)] ?? "";
  };
  const commit = () => {
    const k = cellKey(sel.r, sel.c);
    const before = { ...values };
    const v = fx.value.trim();
    if (v) b.cells![k] = v;
    else delete b.cells![k];
    save();
    evaluate();
    const changed = Object.keys(values).filter((key) => values[key]?.display !== before[key]?.display);
    render(still.matches ? [] : changed);
    refreshSlides();
  };
  const select = (r: number, c: number, focusCell = true) => {
    sel = { r: Math.max(0, Math.min(ROWS - 1, r)), c: Math.max(0, Math.min(COLS - 1, c)) };
    fx.value = b.cells?.[cellKey(sel.r, sel.c)] ?? "";
    render();
    if (focusCell) grid.querySelector<HTMLElement>(".is-sel")?.focus();
  };
  grid.addEventListener("click", (e) => {
    const td = (e.target as HTMLElement).closest("td");
    if (td) select(Number(td.dataset.r), Number(td.dataset.c));
  });
  grid.addEventListener("dblclick", () => fx.focus());
  grid.addEventListener("keydown", (e) => {
    const rtl = AR ? -1 : 1;
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -rtl], ArrowRight: [0, rtl] };
    if (moves[e.key]) {
      e.preventDefault();
      select(sel.r + moves[e.key][0], sel.c + moves[e.key][1]);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      fx.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      fx.value = "";
      commit();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      // Typing on a cell starts editing it, as in the app.
      e.preventDefault();
      fx.value = e.key;
      fx.focus();
    }
  });
  fx.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      select(sel.r + 1, sel.c);
    } else if (e.key === "Escape") {
      fx.value = b.cells?.[cellKey(sel.r, sel.c)] ?? "";
      grid.querySelector<HTMLElement>(".is-sel")?.focus();
    }
  });
  fx.addEventListener("blur", () => {
    if ((b.cells?.[cellKey(sel.r, sel.c)] ?? "") !== fx.value.trim()) commit();
  });
  evaluate();
  render();
  return h("div", { class: "tb" }, h("div", { class: "tb-bar" }, ref, h("span", { class: "tb-fx", "aria-hidden": "true" }, "fx"), fx), h("div", { class: "tb-scroll" }, grid), tip);
}

// Tasks: quick add reads the date, the time and "!!" the way the app does, as you type.
function tasksBlock(b: Block): HTMLElement {
  const list = h("ul", { class: "tk-list" });
  const preview = h("p", { class: "tk-preview", "aria-live": "polite" });
  const input = h("input", { class: "tk-input", type: "text", placeholder: T.taskInput, "aria-label": T.taskInput, "data-focus": "" });
  const render = () => {
    list.replaceChildren(
      ...(b.tasks ?? []).map((t) => {
        const box = h("input", { type: "checkbox", id: `tk-${t.id}`, checked: t.done });
        box.addEventListener("change", () => {
          t.done = box.checked;
          li.classList.toggle("is-done", t.done);
          save();
          refreshSlides();
        });
        const meta = dueLabel(t.due, t.time);
        const li = h(
          "li",
          { class: `tk-item${t.done ? " is-done" : ""}` },
          box,
          h("label", { for: `tk-${t.id}` }, t.title),
          meta ? h("span", { class: `tk-chip${t.due === iso(new Date()) ? " is-today" : ""}` }, meta) : null,
          t.priority >= 2 ? h("span", { class: "tk-chip is-high" }, T.high) : null,
        );
        return li;
      }),
    );
  };
  const showPreview = () => {
    const v = input.value.trim();
    if (!v) {
      preview.textContent = "";
      return;
    }
    const p = parseQuickAdd(v);
    const meta = dueLabel(p.due, p.time);
    preview.replaceChildren(
      h("span", { class: "tk-will" }, `${T.willAdd}:`),
      h("strong", {}, p.title.trim() || v),
      meta ? h("span", { class: "tk-chip" }, meta) : null,
      p.priority >= 2 ? h("span", { class: "tk-chip is-high" }, T.high) : null,
    );
  };
  input.addEventListener("input", showPreview);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const t = taskFrom(input.value);
    if (!t) return;
    b.tasks!.push(t);
    save();
    input.value = "";
    showPreview();
    render();
    if (!still.matches) list.lastElementChild?.classList.add("tk-enter");
    refreshSlides();
  });
  render();
  return h("div", { class: "tk" }, list, h("div", { class: "tk-add" }, input), preview);
}

// Drawing: the app's brush draws the ink; shape recognition straightens a drawn shape.
const INKS = ["--ink", "--terra", "--teal"];
function cssColor(v: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#2a2420";
}
function drawingBlock(b: Block): HTMLElement {
  const canvas = h("canvas", { class: "dr-canvas", "aria-label": T.draw, role: "img", "data-focus": "" });
  const hint = h("p", { class: "dr-hint" }, T.draw);
  let color = INKS[0];
  let straighten = true;
  const swatches = INKS.map((v, i) =>
    h("button", { class: `dr-swatch dr-${i}${i === 0 ? " is-on" : ""}`, type: "button", "aria-label": T.colors[i], "aria-pressed": String(i === 0), onclick: () => pick(i) }),
  );
  const pick = (i: number) => {
    color = INKS[i];
    swatches.forEach((s, j) => {
      s.classList.toggle("is-on", i === j);
      s.setAttribute("aria-pressed", String(i === j));
    });
  };
  const toggle = h("button", { class: "dr-tool is-on", type: "button", "aria-pressed": "true" }, T.straighten);
  toggle.addEventListener("click", () => {
    straighten = !straighten;
    toggle.classList.toggle("is-on", straighten);
    toggle.setAttribute("aria-pressed", String(straighten));
  });
  const undo = h("button", { class: "dr-tool", type: "button", "aria-label": T.undo, title: T.undo }, icon("undo", 16));
  undo.addEventListener("click", () => {
    b.strokes!.pop();
    save();
    paint();
    refreshSlides();
  });
  const clear = h("button", { class: "dr-tool", type: "button" }, T.clear);
  clear.addEventListener("click", () => {
    b.strokes = [];
    save();
    paint();
    refreshSlides();
  });
  const ctx = canvas.getContext("2d")!;
  let width = 0, height = 0;
  const brushFor = (c: string): Brush => ({ ...DEFAULT_BRUSH, kind: "ink", size: 5, smoothing: 0.35, taperStart: 0.12, taperEnd: 0.2, color: c });
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    width = r.width;
    height = r.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
  };
  const samplesOf = (pts: number[]): Sample[] => {
    const out: Sample[] = [];
    for (let i = 0; i < pts.length; i += 3) out.push({ x: pts[i] * width, y: pts[i + 1] * height, pressure: pts[i + 2], tiltX: 0, tiltY: 0, time: i });
    return out;
  };
  const drawStroke = (s: Stroke, alpha = 1) => {
    const c = cssColor(s.color);
    ctx.globalAlpha = alpha;
    if (s.shape) {
      drawShape(ctx, s.shape, c, width, height);
    } else {
      ctx.fillStyle = c;
      for (const d of strokeDabs(samplesOf(s.pts), brushFor(c))) {
        ctx.globalAlpha = alpha * d.opacity;
        ctx.beginPath();
        ctx.arc(d.x, d.y, Math.max(0.6, d.size / 2), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };
  const paint = (live?: Stroke) => {
    ctx.clearRect(0, 0, width, height);
    for (const s of b.strokes ?? []) drawStroke(s);
    if (live) drawStroke(live);
    hint.hidden = !!(b.strokes?.length || live);
  };
  let current: Stroke | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    // Measure now as well: the first stroke can come before the size observer has run.
    if (!width || !height) resize();
    capture(canvas, e.pointerId);
    current = { color, pts: [] };
    add(e);
  });
  const add = (e: PointerEvent) => {
    if (!current) return;
    const r = canvas.getBoundingClientRect();
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = ev.pointerType === "mouse" || !ev.pressure ? 0.55 : ev.pressure;
      current.pts.push((ev.clientX - r.left) / (r.width || 1), (ev.clientY - r.top) / (r.height || 1), p);
    }
    paint(current);
  };
  canvas.addEventListener("pointermove", (e) => current && add(e));
  const end = () => {
    if (!current) return;
    const s = current;
    current = null;
    if (s.pts.length < 6) return paint();
    let shape: RecognizedShape | null = null;
    if (straighten) {
      const pts = [];
      for (let i = 0; i < s.pts.length; i += 3) pts.push({ x: s.pts[i] * width, y: s.pts[i + 1] * height });
      shape = recognizeShape(pts);
    }
    if (!shape || shape.confidence < 0.6) {
      b.strokes!.push(s);
      save();
      paint();
      refreshSlides();
      return;
    }
    const clean: Stroke = {
      color: s.color,
      pts: s.pts,
      shape: { kind: shape.shape, x: shape.rect.x / width, y: shape.rect.y / height, w: shape.rect.w / width, h: shape.rect.h / height, points: shape.points?.flatMap((p) => [p.x / width, p.y / height]) },
    };
    b.strokes!.push(clean);
    save();
    refreshSlides();
    if (still.matches) return paint();
    // The hand-drawn line fades while the straight shape draws in.
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 320);
      ctx.clearRect(0, 0, width, height);
      for (const x of b.strokes!.slice(0, -1)) drawStroke(x);
      drawStroke({ color: s.color, pts: s.pts }, 1 - t);
      drawStroke(clean, t);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  new ResizeObserver(resize).observe(canvas);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => paint());
  return h(
    "div",
    { class: "dr" },
    h("div", { class: "dr-bar" }, h("div", { class: "dr-swatches", role: "group", "aria-label": T.drawing }, ...swatches), h("span", { class: "dr-space" }), toggle, undo, clear),
    h("div", { class: "dr-stage" }, canvas, hint),
  );
}

function drawShape(ctx: CanvasRenderingContext2D, s: NonNullable<Stroke["shape"]>, color: string, width: number, height: number) {
  const x = s.x * width, y = s.y * height, w = s.w * width, hgt = s.h * height;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  if (s.kind === "ellipse") ctx.ellipse(x + w / 2, y + hgt / 2, Math.max(1, w / 2), Math.max(1, hgt / 2), 0, 0, Math.PI * 2);
  else if (s.kind === "rect" || s.kind === "roundrect") ctx.roundRect(x, y, w, hgt, s.kind === "roundrect" ? 14 : 4);
  else if (s.points && s.points.length >= 4) {
    ctx.moveTo(s.points[0] * width, s.points[1] * height);
    for (let i = 2; i < s.points.length; i += 2) ctx.lineTo(s.points[i] * width, s.points[i + 1] * height);
    if (s.kind !== "line") ctx.closePath();
  } else if (s.kind === "triangle") {
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + hgt);
    ctx.lineTo(x, y + hgt);
    ctx.closePath();
  } else if (s.kind === "right-triangle") {
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + hgt);
    ctx.lineTo(x + w, y + hgt);
    ctx.closePath();
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + hgt);
  }
  ctx.stroke();
}

// Slides: the page itself, one slide per block.
function slidesBlock(_b: Block): HTMLElement {
  let index = 0;
  const stage = h("div", { class: "sl-stage", tabindex: 0, "aria-roledescription": T.slides });
  const counter = h("span", { class: "sl-count" });
  const prev = h("button", { class: "sl-btn sl-prev", type: "button", "aria-label": T.prev }, icon("chevron", 18));
  const next = h("button", { class: "sl-btn sl-next", type: "button", "aria-label": T.next }, icon("chevron", 18));
  const full = h("button", { class: "sl-btn", type: "button", "aria-label": T.full, title: T.full }, icon("expand", 16));
  const slides = (): HTMLElement[] => {
    const list: HTMLElement[] = [h("div", { class: "sl-slide sl-cover" }, h("p", { class: "sl-kicker" }, "Worlds"), h("h3", {}, state.title))];
    for (const b of state.blocks) {
      if (b.kind === "text" && b.text) list.push(h("div", { class: "sl-slide" }, h("p", { class: "sl-text" }, b.text)));
      if (b.kind === "tasks" && b.tasks?.length)
        list.push(h("div", { class: "sl-slide" }, h("h3", {}, T.tasks), h("ul", { class: "sl-tasks" }, ...b.tasks.map((t) => h("li", { class: t.done ? "is-done" : "" }, t.title, t.due || t.time ? h("small", {}, dueLabel(t.due, t.time)) : null)))));
      if (b.kind === "table" && b.cells) {
        const wb = newWorkbook();
        for (const [k, v] of Object.entries(b.cells)) wb.sheets[0].cells[k] = { v };
        const vals = evaluateWorkbook(wb)[wb.sheets[0].id] ?? {};
        const rows = Array.from({ length: 6 }, (_, r) => [0, 1].map((c) => vals[cellKey(r, c)]?.display ?? "")).filter((row) => row.some(Boolean));
        list.push(h("div", { class: "sl-slide" }, h("h3", {}, T.table), h("table", { class: "sl-table" }, ...rows.map((row, i) => h("tr", {}, ...row.map((v) => h(i === 0 ? "th" : "td", {}, v)))))));
      }
      if (b.kind === "drawing" && b.strokes?.length) {
        const c = document.querySelector<HTMLCanvasElement>(`[data-id="${b.id}"] canvas`);
        if (c) {
          const copy = h("canvas", { class: "sl-drawing" });
          copy.width = c.width;
          copy.height = c.height;
          copy.getContext("2d")!.drawImage(c, 0, 0);
          list.push(h("div", { class: "sl-slide" }, copy));
        }
      }
    }
    return list;
  };
  const show = () => {
    const all = slides();
    index = Math.max(0, Math.min(all.length - 1, index));
    const s = all[index];
    if (all.length === 1 && !state.blocks.some((b) => b.kind !== "slides")) s.append(h("p", { class: "sl-empty" }, T.emptyPage));
    stage.replaceChildren(s);
    counter.textContent = `${T.slide} ${index + 1} ${T.of} ${all.length}`;
    prev.disabled = index === 0;
    next.disabled = index === all.length - 1;
  };
  prev.addEventListener("click", () => {
    index--;
    show();
  });
  next.addEventListener("click", () => {
    index++;
    show();
  });
  stage.addEventListener("keydown", (e) => {
    const fwd = AR ? "ArrowLeft" : "ArrowRight", back = AR ? "ArrowRight" : "ArrowLeft";
    if (e.key === fwd || e.key === " " || e.key === "PageDown") {
      e.preventDefault();
      index++;
      show();
    } else if (e.key === back || e.key === "PageUp") {
      e.preventDefault();
      index--;
      show();
    }
  });
  const box = h("div", { class: "sl" }, stage, h("div", { class: "sl-bar" }, prev, counter, next, h("span", { class: "dr-space" }), full));
  full.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.requestFullscreen?.().then(() => stage.focus());
  });
  slideRefresh.push(show);
  show();
  return box;
}

function refreshSlides() {
  for (const f of slideRefresh) {
    try {
      f();
    } catch {
      // a slides block that was removed
    }
  }
}

// ---------------------------------------------------------------- reorder
function dragToReorder(el: HTMLElement, grip: HTMLElement) {
  grip.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const sib = e.key === "ArrowUp" ? el.previousElementSibling : el.nextElementSibling;
    if (!sib || !(sib as HTMLElement).dataset.id) return;
    flip(() => (e.key === "ArrowUp" ? sib.before(el) : sib.after(el)));
    commitOrder();
    grip.focus();
  });
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    capture(grip, e.pointerId);
    const startY = e.clientY;
    // How far the block's own place in the list moved while dragging, so it stays under the pointer.
    let shifted = 0;
    el.classList.add("is-dragging");
    const move = (ev: PointerEvent) => {
      el.style.setProperty("--drag-y", `${ev.clientY - startY - shifted}px`);
      const r = el.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const others = [...blocksEl.querySelectorAll<HTMLElement>(".lb[data-id]")].filter((x) => x !== el);
      const target = others.find((o) => {
        const q = o.getBoundingClientRect();
        return mid < q.top + q.height / 2;
      }) ?? null;
      const already = target ? el.nextElementSibling === target : el === blocksEl.lastElementChild;
      if (already) return;
      const top = el.offsetTop;
      flip(() => (target ? target.before(el) : blocksEl.append(el)), el);
      shifted += el.offsetTop - top;
      el.style.setProperty("--drag-y", `${ev.clientY - startY - shifted}px`);
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      el.classList.remove("is-dragging");
      el.style.removeProperty("--drag-y");
      commitOrder();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  });
}

/** Moves the other blocks smoothly to their new places (first, last, invert, play). */
function flip(change: () => void, skip?: HTMLElement) {
  const items = [...blocksEl.querySelectorAll<HTMLElement>(".lb[data-id]")].filter((x) => x !== skip);
  const before = new Map(items.map((x) => [x, x.getBoundingClientRect().top]));
  change();
  if (still.matches) return;
  for (const x of items) {
    const dy = (before.get(x) ?? 0) - x.getBoundingClientRect().top;
    if (!dy) continue;
    x.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 220, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
  }
}

function commitOrder() {
  const ids = [...blocksEl.querySelectorAll<HTMLElement>(".lb[data-id]")].map((x) => x.dataset.id!);
  state.blocks = ids.map((id) => blockOf(id)).filter((b): b is Block => !!b);
  save();
  refreshSlides();
}

// ---------------------------------------------------------------- hand-off
/** The page as Markdown, in the dialect Worlds reads (src/web/markdown.ts). */
function pageMarkdown(): string {
  const out: string[] = [];
  for (const b of state.blocks) {
    if (b.kind === "text" && b.text?.trim()) out.push(b.text.trim());
    if (b.kind === "tasks" && b.tasks?.length) out.push(b.tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.title}${t.due || t.time ? ` (${dueLabel(t.due, t.time)})` : ""}`).join("\n"));
    if (b.kind === "table" && b.cells) {
      const wb = newWorkbook();
      for (const [k, v] of Object.entries(b.cells)) wb.sheets[0].cells[k] = { v };
      const vals = evaluateWorkbook(wb)[wb.sheets[0].id] ?? {};
      const rows = Array.from({ length: 6 }, (_, r) => [0, 1].map((c) => (vals[cellKey(r, c)]?.display ?? "").replace(/\|/g, "/"))).filter((row) => row.some(Boolean));
      if (rows.length) out.push([`| ${rows[0].join(" | ")} |`, "|---|---|", ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n"));
    }
  }
  return out.join("\n\n");
}

function openInWorlds(e: Event) {
  const payload = JSON.stringify({ title: state.title, markdown: pageMarkdown() });
  const bytes = new TextEncoder().encode(payload);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const data = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  // In the fragment, so the page never reaches a server: Worlds on the web reads it in the browser.
  (e.currentTarget as HTMLAnchorElement).href = `${APP}/#page=${data}`;
}

// Started last, once every constant above exists.
const liveRoot = document.querySelector<HTMLElement>("[data-live]");
if (liveRoot) mount(liveRoot);
