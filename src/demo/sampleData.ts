/**
 * What the sample workspace contains: a first year university student's
 * week, in Arabic first and English second. Pure data builders; nothing here
 * talks to the store (see ./sampleWorkspace.ts for that).
 *
 * Dates are relative to the day the sample is loaded, so the calendar, Today
 * and the study summary always have something current to show.
 */
import type { JSONContent } from "@tiptap/core";
import type { DataByKind, DataKind } from "../planning/model";
import { addDays, weekday } from "../planning/model";
import { newSlide, slideToBlock, STAGE_W, type Slide, type SlideElement } from "../resources/deck/model";
import { newSheet, type CellStyle, type WorkbookData } from "../spreadsheet/engine";
import { newLayer, newNode, type Change, type DrawingScene } from "../drawing/model";
import { sceneChanges } from "../drawing/operations";
import { bullets, callout, h, hr, localizeDeep, numbered, p, quote, table, tasks, withSampleLanguage, type SampleLanguage } from "./content";

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/** One resource to create. `parent` names another entry by its `key`. */
export interface SampleEntry {
  key: string;
  kind: "page" | "document" | "spreadsheet" | "drawing" | "presentation" | DataKind;
  title: string;
  /** Defaults to the kind's product icon. */
  icon?: string;
  parent?: string;
  blocks?: JSONContent[];
  metadata?: Record<string, unknown>;
  /** Pinned on Home, so the first screen shows the sample at a glance. */
  pin?: boolean;
}

const data = <K extends DataKind>(kind: K, value: DataByKind[K]) => ({ [kind]: value });

/** Every resource of the sample workspace, parents before children. */
/** The sample in one language: the interface's, so no line mixes two scripts. */
export function samplePlan(today: string, lang: SampleLanguage = "ar"): SampleEntry[] {
  return withSampleLanguage(lang, () => localizeDeep(bilingualPlan(today, lang), lang));
}

function bilingualPlan(today: string, lang: SampleLanguage): SampleEntry[] {
  const d = (n: number) => addDays(today, n);
  const termStart = d(-21);
  return [
    // A home for the documents, so they sit together in the sidebar.
    {
      key: "root",
      kind: "page",
      title: "مساحة طالب تجريبية · Sample student workspace",
      icon: "🎓",
      pin: true,
      blocks: rootBlocks(),
    },
    { key: "plan", kind: "page", title: "خطة الأسبوع · Weekly plan", parent: "root", blocks: weeklyPlanBlocks(), pin: true },
    { key: "report", kind: "document", title: "تقرير: الطاقة المتجددة · Report: Renewable energy", parent: "root", blocks: reportBlocks(), metadata: { doc: DOC_SETTINGS } },
    { key: "grades", kind: "spreadsheet", title: "درجات الفصل · Term grades", parent: "root", metadata: { sheet: gradesWorkbook() }, pin: true },
    { key: "cell", kind: "drawing", title: "رسم الخلية النباتية · Plant cell sketch", parent: "root" },
    { key: "deck", kind: "presentation", title: "دورة الماء · The water cycle", parent: "root", blocks: waterCycleSlides(lang), metadata: { deck: { aspect: "16:9", theme: "dark" } } },

    // Study pack: two subjects with their timetable, lessons and work.
    {
      key: "bio",
      kind: "subject",
      title: "الأحياء · Biology",
     
      metadata: data("subject", { teacher: "د. نورة السالم · Dr. Noura", room: "B12", code: "BIO 101", color: "green", term: "الفصل الأول · Term 1" }),
    },
    {
      key: "bio-class",
      kind: "event",
      title: "محاضرة الأحياء · Biology lecture",
     
      parent: "bio",
      metadata: data("event", { date: termStart, start: "08:00", end: "09:15", location: "B12", weekly: [weekday(today), weekday(d(2))] }),
    },
    {
      key: "bio-l1",
      kind: "lesson",
      title: "الخلية النباتية · The plant cell",
     
      parent: "bio",
      blocks: plantCellLesson(),
      metadata: data("lesson", { unit: "الوحدة 2 · Unit 2", number: 1, taughtOn: d(-5) }),
    },
    {
      key: "bio-l2",
      kind: "lesson",
      title: "البناء الضوئي · Photosynthesis",
     
      parent: "bio",
      blocks: photosynthesisLesson(),
      metadata: data("lesson", { unit: "الوحدة 2 · Unit 2", number: 2, taughtOn: d(-1) }),
    },
    {
      key: "bio-lab",
      kind: "assignment",
      title: "تقرير المختبر: أصباغ الورقة · Lab report: leaf pigments",
     
      parent: "bio",
      metadata: data("assignment", {
        due: d(3),
        time: "22:00",
        assigned: d(-4),
        teacher: "د. نورة السالم · Dr. Noura",
        points: 20,
        instructions: "اكتب الهدف والأدوات والنتائج مع صورة للكروماتوغرافيا. · Include the aim, materials, results and a photo of the chromatography strip.",
      }),
    },
    {
      key: "bio-exam",
      kind: "exam",
      title: "اختبار منتصف الفصل · Midterm exam",
     
      parent: "bio",
      metadata: data("exam", { date: d(9), time: "08:00", scope: "الوحدتان 1 و2 · Units 1 and 2", maxScore: 30, location: "القاعة 4 · Hall 4" }),
    },
    {
      key: "bio-bring",
      kind: "requirement",
      title: "معطف المختبر · Lab coat",
     
      parent: "bio",
      metadata: data("requirement", { due: d(2), action: "إحضار · Bring", ready: false }),
    },
    {
      key: "math",
      kind: "subject",
      title: "الرياضيات · Mathematics",
     
      metadata: data("subject", { teacher: "أ. خالد العمر · Mr. Khalid", room: "A3", code: "MATH 110", color: "blue", term: "الفصل الأول · Term 1" }),
    },
    {
      key: "math-class",
      kind: "event",
      title: "محاضرة الرياضيات · Math lecture",
     
      parent: "math",
      metadata: data("event", { date: termStart, start: "10:00", end: "11:15", location: "A3", weekly: [weekday(d(1)), weekday(d(3))] }),
    },
    {
      key: "math-l1",
      kind: "lesson",
      title: "المتتاليات الحسابية · Arithmetic sequences",
     
      parent: "math",
      blocks: sequencesLesson(),
      metadata: data("lesson", { unit: "الوحدة 3 · Unit 3", number: 1, taughtOn: d(-3) }),
    },
    {
      key: "math-hw",
      kind: "assignment",
      title: "الواجب 4 · Homework 4",
     
      parent: "math",
      metadata: data("assignment", { due: d(1), time: "20:00", assigned: d(-3), teacher: "أ. خالد العمر · Mr. Khalid", points: 10, instructions: "التمارين 1 إلى 12 صفحة 84. · Exercises 1 to 12 on page 84." }),
    },

    // Planning: tasks and an event for everyone.
    {
      key: "t-review",
      kind: "task",
      title: "مراجعة الفصل الثالث · Review chapter 3",
     
      metadata: data("task", {
        due: today,
        time: "19:00",
        priority: 2,
        steps: [
          { id: "s-read", text: "قراءة الملخص · Read the summary", done: true },
          { id: "s-cards", text: "بطاقات المراجعة · Flash cards", done: false },
          { id: "s-quiz", text: "اختبار قصير ذاتي · Self quiz", done: false },
        ],
      }),
    },
    {
      key: "t-print",
      kind: "task",
      title: "طباعة تقرير الطاقة · Print the energy report",
     
      metadata: data("task", { due: d(1), priority: 1, notes: "نسختان، وجهان · Two copies, double sided" }),
    },
    {
      key: "t-library",
      kind: "task",
      title: "إرجاع كتاب المكتبة · Return the library book",
     
      metadata: data("task", { due: d(-1), done: true, doneAt: Date.parse(`${d(-1)}T12:00:00`) || null }),
    },
    {
      key: "e-group",
      kind: "event",
      title: "مجموعة المذاكرة · Study group",
     
      metadata: data("event", { date: d(2), start: "16:00", end: "17:30", location: "مكتبة الكلية · College library", notes: "نراجع البناء الضوئي معًا. · We go over photosynthesis together." }),
    },
    // Quick captures waiting in the Inbox, to be turned into tasks or pages later.
    {
      key: "i-idea",
      kind: "inbox",
      title: "فكرة مشروع: سخان ماء شمسي صغير · Project idea: a small solar water heater",
      metadata: data("inbox", {}),
    },
    {
      key: "i-notebook",
      kind: "inbox",
      title: "شراء دفتر رسم بياني · Buy a graph paper notebook",
      metadata: data("inbox", {}),
    },
  ];
}

// ---------------------------------------------------------------------------
// Pages and documents
// ---------------------------------------------------------------------------

const DOC_SETTINGS = { size: "A4", orientation: "portrait", margins: { top: 25, right: 22, bottom: 25, left: 22 }, header: "", footer: "", font: "Default", fontSize: 12, lineHeight: 1.5 };

function rootBlocks(): JSONContent[] {
  return [
    h(1, "أهلًا بك في مساحة العمل التجريبية · Welcome to the sample workspace"),
    p("هذه مساحة **تجريبية** لطالبة في سنتها الجامعية الأولى. كل ما فيها حُفظ على جهازك فقط، ويمكنك تعديله أو حذفه متى شئت. · It shows a first year student's week. Everything is stored on this device only, and you can edit or remove it anytime."),
    h(2, "ماذا يوجد هنا · What is inside"),
    bullets([
      "**خطة الأسبوع** صفحة بجدول ومهام · **Weekly plan**, a page with a table and checklist",
      "**تقرير الطاقة المتجددة** مستند منسق للطباعة · **Renewable energy report**, a formatted document",
      "**درجات الفصل** جدول بيانات بمعادلات · **Term grades**, a spreadsheet with formulas",
      "**رسم الخلية النباتية** لوحة رسم · **Plant cell sketch**, a drawing",
      "**دورة الماء** عرض تقديمي قصير · **The water cycle**, a short presentation",
      "مادتا **الأحياء** و**الرياضيات** مع الدروس والواجبات والاختبار · **Biology** and **Mathematics** with lessons, assignments and an exam",
      "مهام ومواعيد في التقويم · Tasks and calendar events",
    ]),
    callout("note", "لحذف البيانات التجريبية: الإعدادات › التخزين › مساحة العمل التجريبية. · To remove the sample: Settings › Storage › Sample workspace."),
  ];
}

function weeklyPlanBlocks(): JSONContent[] {
  return [
    h(2, "تركيز الأسبوع · Focus this week"),
    table([
      ["اليوم · Day", "التركيز · Focus", "الوقت · Time"],
      ["الأحد · Sunday", "محاضرة الأحياء ثم المكتبة · Biology lecture, then library", "2 h"],
      ["الاثنين · Monday", "الواجب 4 في الرياضيات · Math homework 4", "1.5 h"],
      ["الثلاثاء · Tuesday", "مجموعة المذاكرة · Study group", "1.5 h"],
      ["الأربعاء · Wednesday", "تقرير المختبر · Lab report", "2 h"],
      ["الخميس · Thursday", "مراجعة للاختبار · Exam review", "3 h"],
    ]),
    h(2, "قائمة المهام · Checklist"),
    tasks([
      ["تجهيز ملخص الوحدة الثانية · Unit 2 summary", true],
      ["حل التمارين 1 إلى 12 · Exercises 1 to 12", false],
      ["تصوير شريط الكروماتوغرافيا · Photograph the chromatography strip", false],
      ["حجز غرفة المذاكرة · Book the study room", false],
    ]),
    callout("success", "==نصيحة:== قسّم المذاكرة إلى جلسات من 25 دقيقة. · ==Tip:== study in 25 minute sessions."),
  ];
}

function reportBlocks(): JSONContent[] {
  return [
    h(1, "الطاقة المتجددة في المملكة"),
    p("*تقرير قصير لمادة مهارات الكتابة* · *A short report for the writing skills course*"),
    h(2, "مقدمة"),
    p("تزداد أهمية **الطاقة المتجددة** مع نمو الطلب على الكهرباء. يتناول هذا التقرير مصدرين رئيسيين هما ==الطاقة الشمسية== و==طاقة الرياح==، ويقارن بينهما من حيث التكلفة والاستمرارية."),
    h(2, "المصادر الرئيسية"),
    numbered([
      "**الطاقة الشمسية:** إشعاع مرتفع معظم أيام السنة ومساحات واسعة مناسبة للمحطات.",
      "**طاقة الرياح:** سرعات رياح جيدة في بعض المناطق الساحلية والشمالية.",
      "**التخزين:** البطاريات تساعد على تغطية ساعات الليل وأوقات الذروة.",
    ]),
    h(2, "مقارنة سريعة"),
    table([
      ["المعيار", "الشمسية", "الرياح"],
      ["ساعات الإنتاج", "نهارًا", "ليلًا ونهارًا"],
      ["التكلفة التقديرية", "منخفضة", "متوسطة"],
      ["الصيانة", "تنظيف الألواح من الغبار", "صيانة دورية للتوربينات"],
    ]),
    quote("الهدف ليس استبدال المصادر كلها، بل المزج بينها بذكاء."),
    callout("warning", "الأرقام في هذا التقرير تقديرية لأغراض تعليمية فقط."),
    hr(),
    h(2, "English summary"),
    p("Renewable energy matters more as demand for electricity grows. This report compares **solar** and **wind** power by cost and availability, and notes that *storage* is what makes them dependable through the night."),
    bullets(["Solar: strong sunlight most of the year", "Wind: good speeds along parts of the coast", "Storage: batteries cover evenings and peak hours"]),
  ];
}

function plantCellLesson(): JSONContent[] {
  return [
    h(2, "أهم العضيات · Key organelles"),
    table([
      ["العضية · Organelle", "الوظيفة · Function"],
      ["الجدار الخلوي · Cell wall", "يعطي الخلية شكلها ويحميها · Gives shape and protection"],
      ["البلاستيدات الخضراء · Chloroplasts", "مكان البناء الضوئي · Where photosynthesis happens"],
      ["الفجوة العصارية · Vacuole", "تخزين الماء والأملاح · Stores water and salts"],
      ["النواة · Nucleus", "تتحكم في أنشطة الخلية · Controls the cell"],
    ]),
    callout("highlight", "الخلية النباتية فيها جدار خلوي وبلاستيدات، والحيوانية لا. · Plant cells have a wall and chloroplasts; animal cells do not."),
    h(3, "أسئلة للمراجعة · Review questions"),
    numbered(["لماذا تكون الفجوة كبيرة في الخلية النباتية؟ · Why is the vacuole large?", "ما الفرق بين الغشاء والجدار؟ · Membrane versus wall?"]),
  ];
}

function photosynthesisLesson(): JSONContent[] {
  return [
    h(2, "المعادلة العامة · The overall equation"),
    p("`6CO2 + 6H2O + light → C6H12O6 + 6O2`"),
    bullets([
      "**المتفاعلات:** ثاني أكسيد الكربون والماء · **Reactants:** carbon dioxide and water",
      "**النواتج:** الجلوكوز والأكسجين · **Products:** glucose and oxygen",
      "**المكان:** البلاستيدات الخضراء · **Where:** chloroplasts",
    ]),
    callout("note", "سيأتي سؤال عن العوامل المؤثرة في سرعة البناء الضوئي في الاختبار. · Expect a question on limiting factors in the exam."),
  ];
}

function sequencesLesson(): JSONContent[] {
  return [
    h(2, "التعريف · Definition"),
    p("المتتالية الحسابية يكون الفرق فيها ثابتًا بين كل حدين متتاليين. · An arithmetic sequence has a constant difference d between terms."),
    p("`a(n) = a(1) + (n - 1) d`"),
    h(3, "مثال · Example"),
    p("3، 7، 11، 15، ... الفرق **d = 4**، والحد العاشر = 3 + 9 * 4 = **39**. · 3, 7, 11, 15, ... the difference is **d = 4**, so the tenth term is 3 + 9 * 4 = **39**."),
    tasks([["حل تمارين الكتاب 1 إلى 12 · Book exercises 1 to 12", false]]),
  ];
}

// ---------------------------------------------------------------------------
// Spreadsheet
// ---------------------------------------------------------------------------

/** Grades per subject with totals, letter grades and averages, plus study hours. */
export function gradesWorkbook(): WorkbookData {
  const grades = newSheet("الدرجات · Grades", 40, 12);
  grades.id = "sh_grades";
  grades.frozenRows = 1;
  grades.colWidths = { 0: 190, 1: 96, 2: 96, 3: 110, 4: 110, 5: 100, 6: 96 };
  const head: CellStyle = { bold: true, bg: "#1d3557", color: "#ffffff", align: "center" };
  const num: CellStyle = { align: "center", format: "number", decimals: 0 };
  const headers = ["المادة · Subject", "اختبار 1 · Quiz 1 (10)", "اختبار 2 · Quiz 2 (10)", "منتصف · Midterm (30)", "نهائي · Final (50)", "المجموع · Total", "التقدير · Grade"];
  headers.forEach((v, c) => (grades.cells[`${"ABCDEFG"[c]}1`] = { v, s: c === 0 ? { ...head, align: "left" } : head }));
  const rows: [string, number, number, number, number][] = [
    ["الأحياء · Biology", 9, 8, 26, 44],
    ["الرياضيات · Mathematics", 10, 9, 28, 47],
    ["اللغة الإنجليزية · English", 8, 9, 25, 42],
    ["اللغة العربية · Arabic", 10, 10, 29, 48],
    ["الفيزياء · Physics", 7, 8, 22, 39],
  ];
  rows.forEach(([name, q1, q2, mid, fin], i) => {
    const r = i + 2;
    grades.cells[`A${r}`] = { v: name };
    grades.cells[`B${r}`] = { v: String(q1), s: num };
    grades.cells[`C${r}`] = { v: String(q2), s: num };
    grades.cells[`D${r}`] = { v: String(mid), s: num };
    grades.cells[`E${r}`] = { v: String(fin), s: num };
    grades.cells[`F${r}`] = { v: `=SUM(B${r}:E${r})`, s: { ...num, bold: true } };
    grades.cells[`G${r}`] = { v: `=IF(F${r}>=90,"A",IF(F${r}>=80,"B",IF(F${r}>=70,"C","D")))`, s: { align: "center", bold: true } };
  });
  const sum: CellStyle = { bold: true, bg: "#3b5b8c", color: "#ffffff", align: "center", format: "number", decimals: 1 };
  grades.cells["A7"] = { v: "المعدل · Average", s: { bold: true, bg: "#3b5b8c", color: "#ffffff" } };
  for (const c of "BCDEF") grades.cells[`${c}7`] = { v: `=AVERAGE(${c}2:${c}6)`, s: sum };
  grades.cells["A9"] = { v: "أعلى مجموع · Highest total", s: { bold: true } };
  grades.cells["F9"] = { v: "=MAX(F2:F6)", s: { ...num, bold: true } };
  grades.cells["A10"] = { v: "مواد فوق 85 · Subjects above 85", s: { bold: true } };
  grades.cells["F10"] = { v: '=COUNTIF(F2:F6,">85")', s: { ...num, bold: true } };
  grades.cells["A11"] = { v: "النسبة العامة · Overall percent", s: { bold: true } };
  grades.cells["F11"] = { v: "=ROUND(F7/100,3)", s: { bold: true, align: "center", format: "percent", decimals: 1 } };
  grades.conditionalRules = [{ id: "cr_top", range: "F2:F6", op: "gt", value: "90", bg: "#2f855a", color: "#ffffff" }];

  const hours = newSheet("ساعات المذاكرة · Study hours", 30, 8);
  hours.id = "sh_hours";
  hours.frozenRows = 1;
  hours.colWidths = { 0: 150, 1: 110, 2: 110 };
  hours.cells["A1"] = { v: "اليوم · Day", s: { ...head, align: "left" } };
  hours.cells["B1"] = { v: "الساعات · Hours", s: head };
  hours.cells["C1"] = { v: "الهدف · Goal", s: head };
  const days: [string, number][] = [
    ["الأحد · Sun", 2],
    ["الاثنين · Mon", 1.5],
    ["الثلاثاء · Tue", 1.5],
    ["الأربعاء · Wed", 2],
    ["الخميس · Thu", 3],
  ];
  days.forEach(([day, n], i) => {
    const r = i + 2;
    hours.cells[`A${r}`] = { v: day };
    hours.cells[`B${r}`] = { v: String(n), s: { align: "center", format: "number", decimals: 1 } };
    hours.cells[`C${r}`] = { v: "2", s: { align: "center", format: "number", decimals: 0 } };
  });
  hours.cells["A7"] = { v: "المجموع · Total", s: { bold: true } };
  hours.cells["B7"] = { v: "=SUM(B2:B6)", s: { bold: true, align: "center", format: "number", decimals: 1 } };
  hours.cells["C7"] = { v: "=SUM(C2:C6)", s: { bold: true, align: "center", format: "number", decimals: 0 } };
  hours.cells["A8"] = { v: "تحقيق الهدف · Goal met", s: { bold: true } };
  hours.cells["B8"] = { v: '=IF(B7>=C7,"نعم · Yes","ليس بعد · Not yet")', s: { bold: true, align: "center" } };

  return { sheets: [grades, hours], activeSheetId: grades.id };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Turn a drawing's current (empty) scene into the plant cell sketch, as the
 * list of changes one edit operation carries. Uses the drawing's own frame
 * and first layer, so it applies like an edit made in the editor.
 */
export function plantCellChanges(scene: DrawingScene): Change[] {
  const after = structuredClone(scene);
  const frame = after.frames[after.defaultFrameId];
  Object.assign(frame, { name: "الخلية النباتية · Plant cell", w: 1280, h: 720, background: "#f7f5ef" });
  const base = after.layers[after.layerOrder[0]];
  base.name = "الرسم · Sketch";
  const labels = newLayer("التسميات · Labels");
  after.layers[labels.id] = labels;
  after.layerOrder.push(labels.id);
  const add = (node: ReturnType<typeof newNode>) => {
    after.nodes[node.id] = node;
    after.nodeOrder.push(node.id);
    return node;
  };
  const shape = (kind: "roundrect" | "ellipse", x: number, y: number, w: number, h: number, fill: string, stroke: string, name: string) => {
    const n = add(newNode("shape", base.id, frame.id, { x, y, w, h }));
    n.shape = kind;
    n.name = name;
    n.paint = { ...n.paint, fill, stroke, strokeWidth: 4, radius: kind === "roundrect" ? 60 : n.paint.radius };
    return n;
  };
  const label = (text: string, x: number, y: number, w: number, size: number, color = "#24352d", weight = 500) => {
    const n = add(newNode("text", labels.id, frame.id, { x, y, w, h: size * 2 }));
    n.text = text;
    n.name = text;
    n.textStyle = { ...n.textStyle, size, weight, color, align: "center", direction: "auto" };
    return n;
  };
  shape("roundrect", 330, 130, 620, 500, "#e6f2dc", "#4d7c46", "الجدار الخلوي · Cell wall");
  shape("ellipse", 520, 260, 260, 210, "#cfe6f5", "#4b7fa3", "الفجوة · Vacuole");
  shape("ellipse", 380, 190, 120, 110, "#e9c9a3", "#8a5a2b", "النواة · Nucleus");
  for (const [x, y] of [[810, 200], [830, 460], [400, 480]] as const) shape("ellipse", x, y, 90, 50, "#7fb069", "#3f6d34", "بلاستيدة · Chloroplast");
  label("الخلية النباتية · The plant cell", 240, 40, 800, 40, "#1f3b2d", 700);
  label("النواة · Nucleus", 70, 220, 280, 24);
  label("الفجوة · Vacuole", 530, 480, 240, 24);
  label("بلاستيدات · Chloroplasts", 960, 300, 300, 24);
  label("الجدار الخلوي · Cell wall", 960, 560, 300, 24);
  return sceneChanges(scene, after);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function setText(slide: Slide, role: SlideElement["role"], text: string, index = 0) {
  const el = slide.elements.filter((e) => e.role === role)[index];
  if (el) el.text = text;
}

function waterCycleSlides(lang: SampleLanguage): JSONContent[] {
  const cover = newSlide("title");
  setText(cover, "title", "دورة الماء · The water cycle");
  setText(cover, "subtitle", "عرض لمادة العلوم · A science class presentation");

  const stages = newSlide("title-body");
  setText(stages, "title", "المراحل الأربع · Four stages");
  setText(stages, "body", "1. التبخر · Evaporation\n2. التكاثف · Condensation\n3. الهطول · Precipitation\n4. الجريان · Collection");

  const compare = newSlide("two-columns");
  compare.background = { color: "#0f172a" };
  setText(compare, "title", "لماذا تهمنا؟ · Why it matters");
  setText(compare, "body", "توزع الماء العذب · Spreads fresh water\nتنظم درجة الحرارة · Regulates temperature\nتغذي الزراعة · Feeds farming", 0);
  setText(compare, "body", "تكوّن الأنهار والبحيرات · Forms rivers and lakes\nتنقل الحرارة حول الأرض · Moves heat around the Earth\nتجدد المياه الجوفية · Refills groundwater", 1);
  const end = newSlide("section");
  setText(end, "title", "أسئلة؟ · Questions?");

  const deck = [cover, stages, compare, end];
  // The layouts are drawn left to right; an Arabic deck reads from the right.
  if (lang === "ar") deck.forEach(mirrorSlide);
  return deck.map((s) => slideToBlock(s).content);
}

/** Flip a slide for right-to-left text: each element moves to the opposite side and left and right alignment swap. */
export function mirrorSlide(slide: Slide): void {
  for (const el of slide.elements) {
    el.x = STAGE_W - el.x - el.w;
    if (el.style?.align === "left") el.style = { ...el.style, align: "right" };
    else if (el.style?.align === "right") el.style = { ...el.style, align: "left" };
  }
}
