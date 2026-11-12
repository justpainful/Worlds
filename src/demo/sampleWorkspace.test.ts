import { beforeEach, describe, expect, it } from "vitest";
import type { NewPage } from "../lib/api";
import type { PageMeta } from "../lib/types";
import type { DrawingDocument } from "../drawing/model";
import { validateScene } from "../drawing/model";
import { appendOperation, newDrawing } from "../drawing/operations";
import { evaluateWorkbook, normalizeWorkbook } from "../spreadsheet/engine";
import { inline, pickLanguage, plainText } from "./content";
import { gradesWorkbook, mirrorSlide, samplePlan } from "./sampleData";
import { newSlide, STAGE_W } from "../resources/deck/model";
import { isSampleLoaded, loadSampleWorkspace, removeSampleWorkspace, SAMPLE_KEY, sampleRecord, type SampleBackend, type SampleHost } from "./sampleWorkspace";

/** An in-memory stand-in for the store commands, with the backend's trash rules. */
function fakeWorkspace(opts: { failOnKind?: string; language?: "ar" | "en" } = {}) {
  const pages: Record<string, PageMeta> = {};
  const drawings: Record<string, DrawingDocument> = {};
  const settings: Record<string, unknown> = {};
  let seq = 0;
  const backend: SampleBackend = {
    async createPage(page: NewPage) {
      if (page.kind === opts.failOnKind) throw new Error("disk full");
      if (page.parentId && !pages[page.parentId]) throw new Error("parent not found");
      const id = `p${++seq}`;
      const kind = page.kind ?? "page";
      const md = (page.metadata ?? {}) as Record<string, unknown>;
      pages[id] = {
        id, title: page.title ?? "", icon: page.icon ?? null, cover: null, parentId: page.parentId ?? null, sortKey: seq, ownerId: "me", kind, templateCategory: null,
        pinned: false, pinOrder: null, favorite: false, archived: false, deletedAt: null, preview: "", createdAt: seq, updatedAt: seq, openedAt: null,
        properties: [], look: {}, ...(md[kind] !== undefined ? { data: md[kind] } : {}),
      } as unknown as PageMeta;
      return pages[id];
    },
    async drawingLoad(pageId) {
      return (drawings[pageId] ??= newDrawing());
    },
    async drawingApply(pageId, operation) {
      return (drawings[pageId] = appendOperation(drawings[pageId] ?? newDrawing(), operation));
    },
    async deletePage(id) {
      if (!pages[id]) throw new Error("page not found");
      const walk = (pid: string) => {
        if (!pages[pid].deletedAt) pages[pid] = { ...pages[pid], deletedAt: 1 };
        for (const c of Object.values(pages)) if (c.parentId === pid) walk(c.id);
      };
      walk(id);
    },
    async pinPage(id) {
      pages[id] = { ...pages[id], pinned: true };
    },
  };
  let study = false;
  const host: SampleHost = {
    settings: () => settings,
    pages: () => pages,
    setSetting: (k, v) => void (settings[k] = v),
    studyEnabled: () => study,
    setStudyEnabled: (on) => void (study = on),
    actor: () => "me",
    language: () => opts.language ?? "ar",
  };
  const live = () => Object.values(pages).filter((p) => !p.deletedAt);
  return { backend, host, pages, drawings, settings, live, study: () => study };
}

const NOW = new Date(2026, 10, 11, 9, 0);
// The long dashes and the multiplication sign, which the repository's hook rejects.
const BANNED = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0xd7)}]`);

describe("sample workspace", () => {
  let w: ReturnType<typeof fakeWorkspace>;
  beforeEach(() => {
    w = fakeWorkspace();
  });

  it("creates a student workspace in Arabic with every kind the demo shows", async () => {
    const { created, rootId } = await loadSampleWorkspace(w.backend, w.host, NOW);
    expect(created).toBe(true);
    const kinds = new Set(w.live().map((p) => p.kind));
    for (const k of ["page", "document", "spreadsheet", "drawing", "presentation", "subject", "lesson", "assignment", "exam", "task", "event", "inbox", "goal"]) expect(kinds).toContain(k);
    // One language per title: no line mixes two scripts.
    for (const p of w.live()) {
      expect(p.title).toMatch(/^[؀-ۿ]/);
      expect(p.title).not.toContain(" · ");
    }
    // Documents hang off the root page; study work sits under its subject.
    expect(w.pages[rootId].parentId).toBeNull();
    for (const k of ["document", "spreadsheet", "drawing", "presentation"]) expect(w.live().find((p) => p.kind === k)!.parentId).toBe(rootId);
    const bio = w.live().find((p) => p.kind === "subject" && p.title.includes("الأحياء"))!;
    const underBio = w.live().filter((p) => p.parentId === bio.id).map((p) => p.kind);
    expect(underBio).toEqual(expect.arrayContaining(["lesson", "lesson", "assignment", "exam", "event"]));
    // Dates follow the day it was loaded.
    const exam = w.live().find((p) => p.kind === "exam")!;
    expect((exam.data as { date: string }).date).toBe("2026-11-20");
    expect(w.study()).toBe(true);
    expect(sampleRecord(w.settings)?.ids).toHaveLength(w.live().length);
    // Home opens on the sample: the root, the weekly plan and the grades are pinned.
    expect(w.live().filter((p) => p.pinned).map((p) => p.kind).sort()).toEqual(["page", "page", "spreadsheet"]);
  });

  it("writes formatted text and never the characters the repository rejects", () => {
    for (const entry of samplePlan("2026-11-11")) {
      const text = [entry.title, entry.blocks ? plainText(entry.blocks) : "", JSON.stringify(entry.metadata ?? {})].join(" ");
      expect(text).not.toMatch(BANNED);
    }
    const report = samplePlan("2026-11-11").find((e) => e.kind === "document")!;
    const types = new Set(JSON.stringify(report.blocks).match(/"type":"[a-zA-Z]+"/g));
    for (const t of ["heading", "orderedList", "bulletList", "table", "callout", "blockquote", "bold", "italic", "highlight"]) expect(types).toContain(`"type":"${t}"`);
  });

  it("writes the whole sample in English when the interface is English", async () => {
    const en = fakeWorkspace({ language: "en" });
    await loadSampleWorkspace(en.backend, en.host, NOW);
    for (const p of en.live()) expect(p.title).not.toMatch(/[؀-ۿ]/);
    const root = en.live().find((p) => p.parentId === null && p.kind === "page")!;
    expect(root.title).toBe("Sample student workspace");
    const drawing = en.live().find((p) => p.kind === "drawing")!;
    const labels = Object.values(en.drawings[drawing.id].scene.nodes).filter((n) => n.kind === "text").map((n) => n.text);
    expect(labels).toContain("Nucleus");
    // Bold or italic text next to the separator must not drag the other language in.
    const plan = samplePlan("2026-11-11", "en");
    for (const key of ["root", "plan", "cell"]) {
      const entry = plan.find((e) => e.key === key);
      if (entry?.blocks) expect(plainText(entry.blocks)).not.toMatch(/[؀-ۿ]/);
    }
    const arabic = samplePlan("2026-11-11", "ar").find((e) => e.key === "root")!;
    expect(plainText(arabic.blocks!)).not.toMatch(/[A-Za-z]{4}/);
    // No mark is left half open by the split: no "*" or "==" stuck to a word.
    for (const lang of ["ar", "en"] as const)
      for (const entry of samplePlan("2026-11-11", lang))
        if (entry.blocks) expect(plainText(entry.blocks), `${lang} ${entry.key}`).not.toMatch(/[A-Za-z؀-ۿ]\*|\*[A-Za-z؀-ۿ]|==/);
  });

  it("picks one side of an Arabic and English pair, line by line and inside formulas", () => {
    expect(pickLanguage("الأحياء · Biology", "ar")).toBe("الأحياء");
    expect(pickLanguage("الأحياء · Biology", "en")).toBe("Biology");
    expect(pickLanguage("Spark · Glance", "ar")).toBe("Spark · Glance");
    expect(pickLanguage("1. التبخر · Evaporation\n2. الهطول · Precipitation", "en")).toBe("1. Evaporation\n2. Precipitation");
    expect(pickLanguage('=IF(B7>=C7,"نعم · Yes","ليس بعد · Not yet")', "en")).toBe('=IF(B7>=C7,"Yes","Not yet")');
    // A highlight mark at the start is not a formula.
    expect(pickLanguage("==نصيحة:== قسّم المذاكرة. · ==Tip:== study in sessions.", "en")).toBe("==Tip:== study in sessions.");
  });

  it("parses inline marks the same way the Markdown dialect does", () => {
    expect(inline("a **b** *c* ==d== `e`")).toEqual([
      { type: "text", text: "a " },
      { type: "text", text: "b", marks: [{ type: "bold" }] },
      { type: "text", text: " " },
      { type: "text", text: "c", marks: [{ type: "italic" }] },
      { type: "text", text: " " },
      { type: "text", text: "d", marks: [{ type: "highlight" }] },
      { type: "text", text: " " },
      { type: "text", text: "e", marks: [{ type: "code" }] },
    ]);
    expect(inline("3 * 4 = 12")).toEqual([{ type: "text", text: "3 * 4 = 12" }]);
  });

  it("builds a spreadsheet whose formulas all evaluate", () => {
    const wb = normalizeWorkbook(gradesWorkbook());
    const out = evaluateWorkbook(wb);
    const [grades, hours] = wb.sheets.map((s) => out[s.id]);
    for (const sheet of [grades, hours]) for (const cell of Object.values(sheet)) expect(cell.error).toBeNull();
    expect(grades.F2.value).toBe(87);
    expect(grades.G2.value).toBe("B");
    expect(grades.G5.value).toBe("A");
    expect(grades.G6.value).toBe("C");
    expect(grades.F7.value).toBeCloseTo(87.6);
    expect(grades.F9.value).toBe(97);
    expect(grades.F10.value).toBe(3);
    expect(hours.B7.value).toBe(10);
    expect(hours.B8.value).toBe("نعم · Yes");
  });

  it("draws the plant cell as one valid edit", async () => {
    await loadSampleWorkspace(w.backend, w.host, NOW);
    const drawing = w.live().find((p) => p.kind === "drawing")!;
    const doc = w.drawings[drawing.id];
    expect(doc.revision).toBe(1);
    validateScene(doc.scene);
    const nodes = Object.values(doc.scene.nodes);
    expect(nodes.filter((n) => n.kind === "shape")).toHaveLength(6);
    expect(nodes.filter((n) => n.kind === "text").map((n) => n.text)).toContain("النواة");
  });

  it("does not duplicate on a second click, even a double click", async () => {
    const [a, b] = await Promise.all([loadSampleWorkspace(w.backend, w.host, NOW), loadSampleWorkspace(w.backend, w.host, NOW)]);
    expect(a).toEqual(b);
    const count = w.live().length;
    const again = await loadSampleWorkspace(w.backend, w.host, NOW);
    expect(again).toEqual({ created: false, rootId: a.rootId });
    expect(w.live()).toHaveLength(count);
  });

  it("removes only the sample, puts it in Trash, and can be loaded again", async () => {
    const own = await w.backend.createPage({ kind: "page", title: "My notes" });
    await loadSampleWorkspace(w.backend, w.host, NOW);
    expect(isSampleLoaded(w.settings, w.pages)).toBe(true);
    const removed = await removeSampleWorkspace(w.backend, w.host);
    expect(removed).toBeGreaterThan(0);
    expect(w.live().map((p) => p.id)).toEqual([own.id]);
    // Trash, not gone: the rows are still there to restore.
    expect(Object.values(w.pages).filter((p) => p.deletedAt).length).toBeGreaterThan(10);
    expect(w.settings[SAMPLE_KEY]).toBeNull();
    expect(w.study()).toBe(false);
    expect(isSampleLoaded(w.settings, w.pages)).toBe(false);
    const next = await loadSampleWorkspace(w.backend, w.host, NOW);
    expect(next.created).toBe(true);
  });

  it("keeps the Study pack on when the person has subjects of their own", async () => {
    await loadSampleWorkspace(w.backend, w.host, NOW);
    await w.backend.createPage({ kind: "subject", title: "Chemistry", metadata: { subject: {} } });
    await removeSampleWorkspace(w.backend, w.host);
    expect(w.study()).toBe(true);
  });

  it("leaves nothing half made when a step fails", async () => {
    const broken = fakeWorkspace({ failOnKind: "exam" });
    await expect(loadSampleWorkspace(broken.backend, broken.host, NOW)).rejects.toThrow("disk full");
    expect(broken.live()).toHaveLength(0);
    expect(broken.settings[SAMPLE_KEY]).toBeUndefined();
    expect(broken.study()).toBe(false);
  });
});

describe("sample slides", () => {
  it("mirror for Arabic: elements move across and left alignment becomes right", () => {
    const slide = newSlide("section");
    const [title, bar] = slide.elements;
    const before = { titleX: title.x, barX: bar.x };
    mirrorSlide(slide);
    expect(title.style?.align).toBe("right");
    expect(title.x).toBe(STAGE_W - before.titleX - title.w);
    // The accent bar sits above the title's start, which is now on the right.
    expect(bar.x).toBe(STAGE_W - before.barX - bar.w);
    expect(bar.x).toBeGreaterThan(STAGE_W / 2);
  });

  it("keeps centred text centred", () => {
    const slide = newSlide("title");
    mirrorSlide(slide);
    expect(slide.elements.every((e) => e.style?.align === "center")).toBe(true);
  });
});
