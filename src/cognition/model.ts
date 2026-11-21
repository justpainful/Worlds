/**
 * Cognition: tools for your own thinking, understanding and memory.
 *
 * Nothing here guesses. Cards follow a spaced repetition schedule, questions
 * stay open until you resolve them, sparks are links you make between two
 * ideas, and Jigsaw boards count the pieces a project still needs. This file
 * holds the rules only (no DOM, no store) so they can be tested in Node.
 */

export const DAY = 86_400_000;

/** Whole days since the epoch in local time: the unit every schedule uses. */
export function dayOf(t: number): number {
  const d = new Date(t);
  return Math.floor((t - d.getTimezoneOffset() * 60_000) / DAY);
}

/* ------------------------------------------------------------------ */
/* Memory cards                                                        */
/* ------------------------------------------------------------------ */

export type CardState = "new" | "learning" | "remembered" | "fading" | "outdated";
export type Grade = "again" | "hard" | "good" | "easy";

export interface Card {
  id: string;
  pageId: string | null;
  /** The text to remember. A cloze card hides each {{part}} in turn. */
  front: string;
  back: string;
  created: number;
  /** Day the card is due (see dayOf). */
  due: number;
  /** Days until the next review after a good answer. */
  interval: number;
  /** How easily it comes back (SM-2 ease, 1.3 to 3). */
  ease: number;
  reps: number;
  lapses: number;
  /** Set by hand: the fact no longer holds. Outdated cards are never shown. */
  outdated?: boolean;
  last?: number;
}

export function newCard(id: string, front: string, back: string, pageId: string | null, now: number): Card {
  return { id, pageId, front: front.trim(), back: back.trim(), created: now, due: dayOf(now), interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

/** Where a card stands today. */
export function cardState(c: Card, today: number): CardState {
  if (c.outdated) return "outdated";
  if (c.reps === 0) return "new";
  if (c.due < today - Math.max(2, Math.round(c.interval * 0.5))) return "fading";
  if (c.interval >= 21) return "remembered";
  return "learning";
}

/** SM-2 with four answers. Returns the card after this review. */
export function review(c: Card, grade: Grade, now: number): Card {
  const today = dayOf(now);
  const q = { again: 1, hard: 3, good: 4, easy: 5 }[grade];
  let { interval, ease, reps, lapses } = c;
  ease = Math.min(3, Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))));
  if (grade === "again") {
    lapses += 1;
    reps = 0;
    interval = 0;
  } else {
    reps += 1;
    if (reps === 1) interval = grade === "easy" ? 4 : grade === "hard" ? 1 : 1;
    else if (reps === 2) interval = grade === "easy" ? 8 : grade === "hard" ? 3 : 6;
    else interval = Math.max(interval + 1, Math.round(interval * (grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease)));
  }
  return { ...c, interval, ease, reps: grade === "again" ? 0 : reps, lapses, due: today + interval, last: now };
}

/** Cards to review today: due ones first (oldest due first), then up to `newPerDay` new ones. */
export function dueCards(cards: Card[], today: number, newPerDay = 10): Card[] {
  const live = cards.filter((c) => !c.outdated);
  const due = live.filter((c) => c.reps > 0 && c.due <= today).sort((a, b) => a.due - b.due);
  const fresh = live.filter((c) => c.reps === 0 && c.due <= today).sort((a, b) => a.created - b.created).slice(0, newPerDay);
  return [...due, ...fresh];
}

const CLOZE = /\{\{(.+?)\}\}/g;

/** The parts a cloze card hides, in order. */
export function clozeParts(text: string): string[] {
  return [...text.matchAll(CLOZE)].map((m) => m[1].trim());
}

/** The question side of a card: every {{part}} shown as a gap. */
export function cardQuestion(c: Pick<Card, "front">): string {
  return c.front.replace(CLOZE, "[ ... ]");
}

/** The answer side: a cloze card shows its text with the parts filled in, a plain card its back. */
export function cardAnswer(c: Pick<Card, "front" | "back">): string {
  return clozeParts(c.front).length ? c.front.replace(CLOZE, "$1") : c.back;
}

/**
 * Cards written in a block of text: "question :: answer" on one line, or a
 * sentence with {{hidden parts}}.
 */
export function cardsInText(text: string): { front: string; back: string }[] {
  const out: { front: string; back: string }[] = [];
  for (const line of text.split(/\n+/)) {
    const t = line.trim();
    if (!t) continue;
    const qa = t.split(/\s::\s/);
    if (qa.length === 2 && qa[0].trim() && qa[1].trim()) out.push({ front: qa[0].trim(), back: qa[1].trim() });
    else if (clozeParts(t).length) out.push({ front: t, back: "" });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Questions and Aha! moments                                          */
/* ------------------------------------------------------------------ */

export type QuestionState = "open" | "unsure" | "resolved";

export interface Question {
  id: string;
  pageId: string | null;
  text: string;
  state: QuestionState;
  created: number;
  /** Notes on each try, newest last. */
  attempts: { at: number; note: string }[];
  answer?: string;
  /** A page that holds the answer. */
  source?: string | null;
  resolved?: number;
}

export type AhaKind = "question" | "spark" | "card" | "jigsaw" | "note";

export interface Aha {
  id: string;
  at: number;
  kind: AhaKind;
  title: string;
  detail?: string;
  pageId?: string | null;
}

/** Days a question has waited, for the "needs a look" list. */
export function questionAge(q: Question, now: number): number {
  return Math.max(0, dayOf(now) - dayOf(q.created));
}

/** A decision to look at again on a date (from a Decision block). */
export interface Revisit {
  id: string;
  pageId: string | null;
  title: string;
  /** YYYY-MM-DD */
  date: string;
}

/* ------------------------------------------------------------------ */
/* Sparks                                                              */
/* ------------------------------------------------------------------ */

export interface SparkEnd {
  pageId: string;
  /** A block on that page, when the spark joins two passages. */
  blockId?: string | null;
  /** The words at that end, as they read when the spark was made. */
  text: string;
}

export interface Spark {
  id: string;
  a: SparkEnd;
  b: SparkEnd;
  /** What you saw when the two met. */
  note: string;
  at: number;
}

/**
 * Pages that mention a term but do not link to the page named after it.
 * `texts` maps page id to its plain text; `links` is [source, target] pairs.
 */
export function unlinkedMentions(term: string, ownId: string, texts: Record<string, string>, links: [string, string][]): string[] {
  const t = normalize(term);
  if (t.length < 3) return [];
  const linked = new Set(links.filter(([, to]) => to === ownId).map(([from]) => from));
  return Object.entries(texts)
    .filter(([id, text]) => id !== ownId && !linked.has(id) && normalize(text).includes(t))
    .map(([id]) => id);
}

/** Lower case, Arabic letter forms folded, so "مدرسة" finds "المدرسه". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

/* ------------------------------------------------------------------ */
/* Jigsaw boards                                                       */
/* ------------------------------------------------------------------ */

export type PieceKind = "page" | "task" | "event" | "question" | "source" | "note";

export interface Slot {
  id: string;
  label: string;
  kind: PieceKind;
  /** How many pieces fill the slot. */
  need: number;
}

export interface Piece {
  id: string;
  slot: string;
  kind: PieceKind;
  /** A page id, or a web address for a source. */
  ref?: string | null;
  label: string;
  done?: boolean;
}

export interface Jigsaw {
  id: string;
  title: string;
  template: string;
  pieces: Piece[];
  created: number;
}

export interface JigsawTemplate {
  id: string;
  label: string;
  slots: Slot[];
}

export const JIGSAW_TEMPLATES: JigsawTemplate[] = [
  {
    id: "research",
    label: "Research",
    slots: [
      { id: "question", label: "The question", kind: "question", need: 1 },
      { id: "sources", label: "Sources", kind: "source", need: 3 },
      { id: "outline", label: "Outline", kind: "page", need: 1 },
      { id: "draft", label: "Draft", kind: "page", need: 1 },
      { id: "deadline", label: "Deadline", kind: "event", need: 1 },
    ],
  },
  {
    id: "exam",
    label: "Exam",
    slots: [
      { id: "topics", label: "Topics", kind: "page", need: 3 },
      { id: "cards", label: "Memory cards", kind: "note", need: 1 },
      { id: "questions", label: "Open questions answered", kind: "question", need: 1 },
      { id: "sessions", label: "Study sessions", kind: "task", need: 3 },
      { id: "date", label: "Exam date", kind: "event", need: 1 },
    ],
  },
  {
    id: "project",
    label: "Project",
    slots: [
      { id: "goal", label: "Goal", kind: "note", need: 1 },
      { id: "plan", label: "Plan", kind: "page", need: 1 },
      { id: "tasks", label: "Tasks", kind: "task", need: 3 },
      { id: "people", label: "People", kind: "note", need: 1 },
      { id: "deadline", label: "Deadline", kind: "event", need: 1 },
    ],
  },
  {
    id: "decision",
    label: "Decision",
    slots: [
      { id: "question", label: "What to decide", kind: "question", need: 1 },
      { id: "options", label: "Options", kind: "note", need: 2 },
      { id: "evidence", label: "Evidence", kind: "source", need: 2 },
      { id: "decision", label: "The decision", kind: "page", need: 1 },
      { id: "review", label: "Revisit on", kind: "event", need: 1 },
    ],
  },
  {
    id: "free",
    label: "Free",
    slots: [{ id: "pieces", label: "Pieces", kind: "note", need: 6 }],
  },
];

export function templateOf(j: Pick<Jigsaw, "template">): JigsawTemplate {
  return JIGSAW_TEMPLATES.find((t) => t.id === j.template) ?? JIGSAW_TEMPLATES[JIGSAW_TEMPLATES.length - 1];
}

/** Filled and needed pieces per slot, and the board as a whole (0 to 1). */
export function completeness(j: Jigsaw): { slots: { slot: Slot; have: number; missing: number }[]; ratio: number } {
  const t = templateOf(j);
  const slots = t.slots.map((slot) => {
    const have = j.pieces.filter((p) => p.slot === slot.id && p.done !== false).length;
    return { slot, have, missing: Math.max(0, slot.need - have) };
  });
  const need = t.slots.reduce((n, s) => n + s.need, 0);
  const have = slots.reduce((n, s) => n + Math.min(s.have, s.slot.need), 0);
  return { slots, ratio: need ? have / need : 1 };
}

/* ------------------------------------------------------------------ */
/* Credit: where the words on a page came from                         */
/* ------------------------------------------------------------------ */

export type Origin = "yours" | "quoted" | "claude" | "imported";

interface DocNode {
  type?: string;
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
}

/** Characters on a page by where they came from, and the sources quoted. */
export function fingerprint(doc: DocNode | DocNode[]): { counts: Record<Origin, number>; total: number; sources: string[] } {
  const counts: Record<Origin, number> = { yours: 0, quoted: 0, claude: 0, imported: 0 };
  const sources = new Set<string>();
  const walk = (n: DocNode) => {
    if (typeof n.text === "string") {
      const mark = n.marks?.find((m) => m.type === "origin");
      const kind = (mark?.attrs?.kind as Origin | undefined) ?? "yours";
      counts[kind in counts ? kind : "yours"] += n.text.length;
      const src = mark?.attrs?.source;
      if (typeof src === "string" && src) sources.add(src);
    }
    n.content?.forEach(walk);
  };
  (Array.isArray(doc) ? doc : [doc]).forEach(walk);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total, sources: [...sources] };
}

/** Whole percentages that add up to 100 (largest remainder). */
export function percentages(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const keys = Object.keys(counts);
  if (!total) return Object.fromEntries(keys.map((k) => [k, 0]));
  const raw = keys.map((k) => ({ k, v: (counts[k] / total) * 100 }));
  const out = Object.fromEntries(raw.map(({ k, v }) => [k, Math.floor(v)]));
  let left = 100 - Object.values(out).reduce((a, b) => a + b, 0);
  for (const { k } of [...raw].sort((a, b) => (b.v % 1) - (a.v % 1))) {
    if (left-- <= 0) break;
    out[k] += 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Resurfacing: an old page a day                                      */
/* ------------------------------------------------------------------ */

/** One page you have not opened for a while, the same all day, different each day. */
export function resurface<T extends { id: string; updatedAt: number }>(pages: T[], now: number, minDays = 21): T | null {
  const today = dayOf(now);
  const old = pages.filter((p) => today - dayOf(p.updatedAt) >= minDays).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!old.length) return null;
  let h = today;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return old[Math.abs(h ^ (h >>> 16)) % old.length];
}
