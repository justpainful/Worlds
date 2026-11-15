import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { neutralDirections } from "./neutralDirection";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", attrs: { dir: { default: null } } },
    text: {},
  },
});

describe("neutral direction on a long page", () => {
  it("handles 5,000 paragraphs quickly enough to run on every keystroke", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => (i % 7 === 0 ? "" : i % 2 ? `فقرة رقم ${i} فيها نص عربي متوسط الطول` : `Paragraph ${i} with some English text`));
    const doc = schema.node("doc", null, lines.map((l) => schema.node("paragraph", null, l ? [schema.text(l)] : [])));
    neutralDirections(doc, "rtl");
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) neutralDirections(doc, "rtl");
    const each = (performance.now() - t0) / runs;
    console.log(`neutralDirections on 5,000 paragraphs: ${each.toFixed(2)} ms`);
    expect(each).toBeLessThan(16);
  });
});
