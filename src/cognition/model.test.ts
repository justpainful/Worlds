import { describe, expect, it } from "vitest";
import {
  DAY,
  cardAnswer,
  cardQuestion,
  cardState,
  cardsInText,
  completeness,
  dayOf,
  dueCards,
  fingerprint,
  newCard,
  normalize,
  percentages,
  resurface,
  review,
  unlinkedMentions,
} from "./model";

const NOW = Date.UTC(2026, 10, 21, 12);

describe("memory cards", () => {
  it("reads question :: answer lines and {{cloze}} sentences", () => {
    const cards = cardsInText("Capital of Saudi Arabia :: Riyadh\nPlants make food by {{photosynthesis}}.\nPlain line");
    expect(cards).toEqual([
      { front: "Capital of Saudi Arabia", back: "Riyadh" },
      { front: "Plants make food by {{photosynthesis}}.", back: "" },
    ]);
  });

  it("shows gaps on the question and fills them on the answer", () => {
    const c = { front: "Water boils at {{100}} degrees", back: "" };
    expect(cardQuestion(c)).toBe("Water boils at [ ... ] degrees");
    expect(cardAnswer(c)).toBe("Water boils at 100 degrees");
  });

  it("spaces reviews out and resets on a miss", () => {
    let c = newCard("a", "q", "a", null, NOW);
    expect(cardState(c, dayOf(NOW))).toBe("new");
    c = review(c, "good", NOW);
    expect(c.interval).toBe(1);
    c = review(c, "good", NOW + DAY);
    expect(c.interval).toBe(6);
    c = review(c, "good", NOW + 7 * DAY);
    expect(c.interval).toBeGreaterThan(12);
    const missed = review(c, "again", NOW + 30 * DAY);
    expect(missed.interval).toBe(0);
    expect(missed.lapses).toBe(1);
  });

  it("marks long overdue cards as fading and keeps outdated ones out", () => {
    let c = newCard("a", "q", "a", null, NOW);
    c = review(review(c, "good", NOW), "good", NOW + DAY);
    expect(cardState(c, dayOf(NOW) + 30)).toBe("fading");
    const old = { ...c, outdated: true };
    expect(dueCards([old], dayOf(NOW) + 30)).toEqual([]);
  });

  it("puts due cards before new ones and caps the new ones", () => {
    const fresh = Array.from({ length: 5 }, (_, i) => newCard(`n${i}`, "q", "a", null, NOW + i));
    const due = { ...review(newCard("d", "q", "a", null, NOW - 5 * DAY), "good", NOW - 5 * DAY) };
    const list = dueCards([...fresh, due], dayOf(NOW), 2);
    expect(list.map((c) => c.id)).toEqual(["d", "n0", "n1"]);
  });
});

describe("sparks", () => {
  it("finds pages that mention a title without linking to it", () => {
    const texts = { p1: "We studied photosynthesis today", p2: "Photosynthesis needs light", p3: "Nothing here", self: "Photosynthesis" };
    expect(unlinkedMentions("Photosynthesis", "self", texts, [["p2", "self"]])).toEqual(["p1"]);
  });

  it("folds Arabic letter forms", () => {
    expect(normalize("المدرسة")).toBe(normalize("المدرسه"));
    expect(normalize("أحمد")).toBe(normalize("احمد"));
  });
});

describe("jigsaw boards", () => {
  it("counts filled slots against what the template needs", () => {
    const j = {
      id: "j",
      title: "Essay",
      template: "research",
      created: NOW,
      pieces: [
        { id: "1", slot: "question", kind: "question" as const, label: "Why?" },
        { id: "2", slot: "sources", kind: "source" as const, label: "A" },
        { id: "3", slot: "sources", kind: "source" as const, label: "B" },
      ],
    };
    const c = completeness(j);
    expect(c.ratio).toBeCloseTo(3 / 7);
    expect(c.slots.find((s) => s.slot.id === "sources")?.missing).toBe(1);
  });
});

describe("credit", () => {
  it("counts characters by origin and lists sources", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "abcdef" }, { type: "text", text: "1234", marks: [{ type: "origin", attrs: { kind: "quoted", source: "https://a.example" } }] }] },
      ],
    };
    const f = fingerprint(doc);
    expect(f.counts.yours).toBe(6);
    expect(f.counts.quoted).toBe(4);
    expect(f.sources).toEqual(["https://a.example"]);
    expect(percentages(f.counts)).toEqual({ yours: 60, quoted: 40, claude: 0, imported: 0 });
  });

  it("rounds percentages to a total of 100", () => {
    const p = percentages({ a: 1, b: 1, c: 1 });
    expect(p.a + p.b + p.c).toBe(100);
  });
});

describe("resurfacing", () => {
  it("picks the same old page all day and skips recent ones", () => {
    const pages = [
      { id: "a", updatedAt: NOW - 40 * DAY },
      { id: "b", updatedAt: NOW - 60 * DAY },
      { id: "c", updatedAt: NOW - DAY },
    ];
    const one = resurface(pages, NOW);
    expect(one && one.id !== "c").toBe(true);
    expect(resurface(pages, NOW + 3_600_000)?.id).toBe(one?.id);
    expect(resurface([pages[2]], NOW)).toBeNull();
  });
});
