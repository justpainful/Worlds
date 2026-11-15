import { describe, expect, it } from "vitest";
import { ARABIC_TEMPLATES } from "../templates/builtinArabic";
import { fromMarkdown, inlineMarkdown, toMarkdown, withBids, type JSONLike } from "./markdown";

// Expected values below are what src-tauri/src/content.rs produces for the same input.

const txt = (text: string, ...marks: JSONLike[]): JSONLike => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const p = (...content: JSONLike[]): JSONLike => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const bold = { type: "bold" };
const italic = { type: "italic" };
const code = { type: "code" };
const strike = { type: "strike" };
const highlight = { type: "highlight" };
const link = (href: string): JSONLike => ({ type: "link", attrs: { href } });
const li = (...content: JSONLike[]): JSONLike => ({ type: "listItem", content: [p(...content)] });
const task = (checked: boolean, ...content: JSONLike[]): JSONLike => ({ type: "taskItem", attrs: { checked }, content: [p(...content)] });
const ch = (code: number) => String.fromCharCode(code);

/** toMarkdown of every block, joined the way the desktop's export joins blocks. */
const roundTrip = (md: string) => fromMarkdown(md).map(toMarkdown).join("\n\n");

describe("headings", () => {
  it("parses levels 1 to 3", () => {
    expect(fromMarkdown("# One\n## Two\n### Three")).toEqual([
      { type: "heading", attrs: { level: 1 }, content: [txt("One")] },
      { type: "heading", attrs: { level: 2 }, content: [txt("Two")] },
      { type: "heading", attrs: { level: 3 }, content: [txt("Three")] },
    ]);
    expect(roundTrip("# One\n## Two\n### Three")).toBe("# One\n\n## Two\n\n### Three");
  });

  it("treats deeper or space-less hashes as text, and keeps inline marks", () => {
    expect(fromMarkdown("#### Four")).toEqual([p(txt("#### Four"))]);
    expect(fromMarkdown("#Tag")).toEqual([p(txt("#Tag"))]);
    expect(fromMarkdown("# ")).toEqual([p(txt("#"))]);
    expect(fromMarkdown("## A **b**")).toEqual([{ type: "heading", attrs: { level: 2 }, content: [txt("A "), txt("b", bold)] }]);
    expect(fromMarkdown("#  spaced")).toEqual([{ type: "heading", attrs: { level: 1 }, content: [txt(" spaced")] }]);
  });

  it("clamps the level when writing", () => {
    expect(toMarkdown({ type: "heading", attrs: { level: 5 }, content: [txt("x")] })).toBe("### x");
    expect(toMarkdown({ type: "heading", attrs: { level: 0 } })).toBe("# ");
    expect(toMarkdown({ type: "heading" })).toBe("# ");
  });
});

describe("paragraphs and inline marks", () => {
  it("parses bold, italic, code, strike, highlight, links and page mentions", () => {
    const md = "Hello **world**, *it* `c` ~~s~~ ==h== [label](https://x.y/z) @[Nova8](page:abc).";
    expect(fromMarkdown(md)).toEqual([
      p(
        txt("Hello "), txt("world", bold), txt(", "), txt("it", italic), txt(" "), txt("c", code), txt(" "), txt("s", strike), txt(" "),
        txt("h", highlight), txt(" "), txt("label", link("https://x.y/z")), txt(" "),
        { type: "pageMention", attrs: { id: "abc", label: "Nova8" } }, txt("."),
      ),
    ]);
    expect(roundTrip(md)).toBe(md);
  });

  it("nests marks inside marks, appending the outer mark last", () => {
    expect(fromMarkdown("**a *b* c**")).toEqual([p(txt("a ", bold), txt("b", italic, bold), txt(" c", bold))]);
    expect(roundTrip("**a *b* c**")).toBe("**a *****b***** c**");
    expect(fromMarkdown("**[x](u)**")).toEqual([p(txt("x", link("u"), bold))]);
    // The link is the first mark, so it ends up outermost and the bold moves into the label.
    expect(roundTrip("**[x](u)**")).toBe("[**x**](u)");
  });

  it("does not parse inside code", () => {
    expect(fromMarkdown("`**x**`")).toEqual([p(txt("**x**", code))]);
  });

  it("leaves unclosed or empty delimiters and bad links as text", () => {
    expect(fromMarkdown("**open")).toEqual([p(txt("**open"))]);
    expect(fromMarkdown("****")).toEqual([p(txt("****"))]);
    expect(fromMarkdown("a ** b")).toEqual([p(txt("a ** b"))]);
    expect(fromMarkdown("[a](b c)")).toEqual([p(txt("[a](b c)"))]);
    expect(fromMarkdown("[](x)")).toEqual([p(txt("[](x)"))]);
    expect(fromMarkdown("[Confirm Attendance]")).toEqual([p(txt("[Confirm Attendance]"))]);
    expect(fromMarkdown("@[open")).toEqual([p(txt("@[open"))]);
  });

  it("finds the first closing delimiter", () => {
    expect(fromMarkdown("**a***")).toEqual([p(txt("a", bold), txt("*"))]);
    expect(fromMarkdown("*a* and **b")).toEqual([p(txt("a", italic), txt(" and **b"))]);
  });

  it("joins consecutive lines with hard breaks and splits on blank lines", () => {
    expect(fromMarkdown("one\ntwo\n\nthree")).toEqual([p(txt("one"), { type: "hardBreak" }, txt("two")), p(txt("three"))]);
    expect(roundTrip("one\ntwo\n\nthree")).toBe("one\ntwo\n\nthree");
    expect(fromMarkdown("  padded  ")).toEqual([p(txt("padded"))]);
  });

  it("walks code points, so emoji and Arabic survive marks", () => {
    const s = "**" + String.fromCodePoint(0x1f600) + " " + "مرحبا" + "**";
    expect(fromMarkdown(s)).toEqual([p(txt(s.slice(2, -2), bold))]);
    expect(roundTrip(s)).toBe(s);
  });

  it("trims like Rust: a no-break space is whitespace, a byte order mark is not", () => {
    expect(fromMarkdown(ch(0xa0) + "# a")).toEqual([{ type: "heading", attrs: { level: 1 }, content: [txt("a")] }]);
    expect(fromMarkdown(ch(0x85) + "# a")).toEqual([{ type: "heading", attrs: { level: 1 }, content: [txt("a")] }]);
    expect(fromMarkdown(ch(0xfeff) + "# a")).toEqual([p(txt(ch(0xfeff) + "# a"))]);
  });

  it("reads CRLF like LF", () => {
    expect(fromMarkdown("# a\r\n- b\r\n")).toEqual(fromMarkdown("# a\n- b\n"));
  });

  it("returns nothing for empty input", () => {
    expect(fromMarkdown("")).toEqual([]);
    expect(fromMarkdown("\n \n\t\n")).toEqual([]);
  });
});

describe("lists", () => {
  it("parses bullet lists with either marker as one list", () => {
    expect(fromMarkdown("- a\n* b\n-")).toEqual([{ type: "bulletList", content: [li(txt("a")), li(txt("b")), { type: "listItem", content: [p()] }] }]);
    expect(roundTrip("- a\n* b\n-")).toBe("- a\n- b\n- ");
  });

  it("parses numbered lists and renumbers them when writing", () => {
    expect(fromMarkdown("1. a\n2. **b**\n10. c\n7.")).toEqual([
      { type: "orderedList", content: [li(txt("a")), li(txt("b", bold)), li(txt("c")), { type: "listItem", content: [p()] }] },
    ]);
    expect(roundTrip("3. x\n9. y")).toBe("1. x\n2. y");
    expect(fromMarkdown("1.x")).toEqual([p(txt("1.x"))]);
  });

  it("parses task lists, checked and unchecked, with empty items", () => {
    const md = "- [ ] one\n- [x] two\n- [X] three\n- [ ]\n- [ ] ";
    expect(fromMarkdown(md)).toEqual([
      {
        type: "taskList",
        content: [task(false, txt("one")), task(true, txt("two")), task(true, txt("three")), { type: "taskItem", attrs: { checked: false }, content: [p()] }, { type: "taskItem", attrs: { checked: false }, content: [p()] }],
      },
    ]);
    expect(roundTrip(md)).toBe("- [ ] one\n- [x] two\n- [x] three\n- [ ] \n- [ ] ");
  });

  it("starts a new list when the kind changes", () => {
    expect(fromMarkdown("- a\n- [ ] b\n1. c").map((b) => b.type)).toEqual(["bulletList", "taskList", "orderedList"]);
  });

  it("keeps trailing spaces inside items, like the Rust", () => {
    expect(fromMarkdown("- a  \n- b")).toEqual([{ type: "bulletList", content: [li(txt("a  ")), li(txt("b"))] }]);
  });

  it("flattens indented items when reading, and indents nested lists when writing", () => {
    expect(fromMarkdown("- a\n  - b")).toEqual([{ type: "bulletList", content: [li(txt("a")), li(txt("b"))] }]);
    const nested: JSONLike = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [p(txt("a")), { type: "orderedList", content: [li(txt("b")), li(txt("c"))] }] },
        { type: "listItem", content: [p(txt("d")), { type: "taskList", content: [task(true, txt("e"))] }] },
      ],
    };
    expect(toMarkdown(nested)).toBe("- a\n  1. b\n  2. c\n- d\n  - [x] e");
  });

  it("reads a marker followed only by a tab or a no-break space as an empty item (the Rust never returns here)", () => {
    expect(fromMarkdown("-\t")).toEqual([{ type: "bulletList", content: [{ type: "listItem", content: [p()] }] }]);
    expect(fromMarkdown("a\n- [ ]" + ch(0xa0) + "\nb")).toEqual([
      p(txt("a")),
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [p()] }] },
      p(txt("b")),
    ]);
  });
});

describe("callouts, prompts and quotes", () => {
  it("parses a note callout", () => {
    expect(fromMarkdown("> [!note] careful")).toEqual([{ type: "callout", attrs: { tone: "note" }, content: [p(txt("careful"))] }]);
    expect(roundTrip("> [!note] careful")).toBe("> [!note] careful");
  });

  it("lowercases the tone and keeps later lines as paragraphs", () => {
    for (const tone of ["tip", "warning", "danger", "success", "info"]) {
      const md = `> [!${tone.toUpperCase()}] Be **bold**\n> second`;
      expect(fromMarkdown(md)).toEqual([{ type: "callout", attrs: { tone }, content: [p(txt("Be "), txt("bold", bold)), p(txt("second"))] }]);
      expect(roundTrip(md)).toBe(`> [!${tone}] Be **bold**\n> second`);
    }
  });

  it("gives an empty callout one empty paragraph", () => {
    expect(fromMarkdown("> [!tip]")).toEqual([{ type: "callout", attrs: { tone: "tip" }, content: [p()] }]);
    expect(roundTrip("> [!tip]")).toBe("> [!tip] ");
    expect(fromMarkdown(">[!note]x")).toEqual([{ type: "callout", attrs: { tone: "note" }, content: [p(txt("x"))] }]);
    expect(fromMarkdown("> [!] x")).toEqual([{ type: "callout", attrs: { tone: "" }, content: [p(txt("x"))] }]);
  });

  it("writes a callout without a tone as a note", () => {
    expect(toMarkdown({ type: "callout", content: [p(txt("x"))] })).toBe("> [!note] x");
  });

  it("parses prompts", () => {
    expect(fromMarkdown("> [!prompt] Ask *this*")).toEqual([{ type: "prompt", attrs: { label: "Prompt" }, content: [p(txt("Ask "), txt("this", italic))] }]);
    expect(roundTrip("> [!Prompt] Ask *this*")).toBe("> [!prompt] Ask *this*");
  });

  it("parses quotes, keeping empty lines as empty paragraphs", () => {
    expect(fromMarkdown("> a\n>\n>> b")).toEqual([{ type: "blockquote", content: [p(txt("a")), p(), p(txt("b"))] }]);
    expect(roundTrip("> a\n>\n> b")).toBe("> a\n> \n> b");
  });
});

describe("dividers, code and tables", () => {
  it("parses dividers", () => {
    expect(fromMarkdown("a\n---\n***\nb")).toEqual([p(txt("a")), { type: "horizontalRule" }, { type: "horizontalRule" }, p(txt("b"))]);
    expect(roundTrip("***")).toBe("---");
    expect(fromMarkdown("- - -")).toEqual([{ type: "bulletList", content: [li(txt("- -"))] }]);
  });

  it("parses code fences, keeping lines verbatim", () => {
    const md = "```js\nconst a = **1**;\n  indented\n```\nafter";
    expect(fromMarkdown(md)).toEqual([{ type: "codeBlock", attrs: { language: "js" }, content: [txt("const a = **1**;\n  indented")] }, p(txt("after"))]);
    expect(roundTrip(md)).toBe("```js\nconst a = **1**;\n  indented\n```\n\nafter");
  });

  it("handles empty, unclosed and mermaid fences", () => {
    expect(fromMarkdown("```\n```")).toEqual([{ type: "codeBlock", attrs: { language: "" } }]);
    expect(roundTrip("```\n```")).toBe("```\n\n```");
    expect(fromMarkdown("``` py \nx\n\ny")).toEqual([{ type: "codeBlock", attrs: { language: "py" }, content: [txt("x\n\ny")] }]);
    expect(fromMarkdown("```Mermaid\ngraph TD\n```")).toEqual([{ type: "mermaid", attrs: { code: "graph TD" } }]);
    expect(roundTrip("```mermaid\ngraph TD\n```")).toBe("```mermaid\ngraph TD\n```");
  });

  it("loses leading indentation of code when writing, since the Rust writes trimmed plain text", () => {
    expect(roundTrip("```\n  x\n```")).toBe("```\nx\n```");
  });

  it("parses tables with a header row and drops the separator", () => {
    const md = "| a | b |\n|---|:-:|\n| 1 | **2** |";
    expect(fromMarkdown(md)).toEqual([
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [p(txt("a"))] }, { type: "tableHeader", content: [p(txt("b"))] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [p(txt("1"))] }, { type: "tableCell", content: [p(txt("2", bold))] }] },
        ],
      },
    ]);
    expect(roundTrip(md)).toBe("| a | b |\n|---|---|\n| 1 | 2 |");
  });

  it("keeps empty cells and escapes pipes when writing", () => {
    expect(fromMarkdown("| a || c |")[0].content?.[0].content?.map((c) => c.content?.[0])).toEqual([p(txt("a")), p(), p(txt("c"))]);
    const t: JSONLike = { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p(txt("a|b"))] }] }] };
    expect(toMarkdown(t)).toBe("| a\\|b |\n|---|");
  });
});

describe("other blocks when writing", () => {
  it("matches the Rust for media, links and containers", () => {
    expect(toMarkdown({ type: "image", attrs: { caption: "Sky", name: "s.png" } })).toBe("[image: Sky]");
    expect(toMarkdown({ type: "image", attrs: { name: "s.png" } })).toBe("[image: s.png]");
    expect(toMarkdown({ type: "file", attrs: { name: "a.pdf" } })).toBe("[file: a.pdf]");
    expect(toMarkdown({ type: "pageLink", attrs: { title: "P", pageId: "id1" } })).toBe("[subpage: @[P](page:id1)]");
    expect(toMarkdown({ type: "embed", attrs: { url: "https://e" } })).toBe("[embed: https://e]");
    expect(toMarkdown({ type: "toc" })).toBe("[table of contents]");
    expect(toMarkdown({ type: "mathBlock", attrs: { latex: "x" } })).toBe("$$\nx\n$$");
    expect(toMarkdown({ type: "chart", attrs: { title: "" } })).toBe("[chart: from a table]");
    expect(toMarkdown({ type: "gallery", attrs: { images: [1, 2, 3] } })).toBe("[gallery: 3 pictures]");
    expect(toMarkdown({ type: "collection", attrs: {} })).toBe("[collection: pages (children, table view)]");
    expect(toMarkdown({ type: "columns", content: [{ type: "column", content: [p(), p(txt("x")), p(txt("y"))] }] })).toBe("x\n\ny");
    expect(toMarkdown({ type: "toggle", content: [p(txt("h")), p(txt("a")), p(txt("b"))] })).toBe("> [!toggle] h\n> a\n> b");
    expect(toMarkdown({ type: "toggle" })).toBe("> [!toggle] ");
    expect(toMarkdown({ type: "tabs", content: [{ type: "tab", attrs: { title: "One" }, content: [p(txt("x"))] }, { type: "tab" }] })).toBe("### One\n\nx\n\n### Tab\n\n");
    expect(toMarkdown({ type: "unknownBlock", content: [p(txt(" a ")), { type: "image", attrs: { caption: "c", name: "n" } }] })).toBe("a \nc n");
  });
});

describe("inlineMarkdown", () => {
  it("wraps marks from the last one outward and renders inline nodes", () => {
    expect(
      inlineMarkdown([
        txt("a", bold, italic),
        { type: "hardBreak" },
        { type: "pageMention", attrs: { id: "i", label: "L" } },
        { type: "mathInline", attrs: { latex: "x^2" } },
        txt("u", { type: "underline" }, { type: "link", attrs: {} }),
      ]),
    ).toBe("***a***\n@[L](page:i)$x^2$[u]()");
  });
});

describe("ported Rust tests", () => {
  it("roundtrip_basics (content.rs)", () => {
    const md = "# Title\n\nHello **world** and @[Nova8](page:abc).\n\n- [ ] one\n- [x] two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> [!note] careful";
    const blocks = fromMarkdown(md);
    expect(blocks).toHaveLength(5);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[1].content).toContainEqual({ type: "pageMention", attrs: { id: "abc", label: "Nova8" } });
    expect(toMarkdown(blocks[2])).toBe("- [ ] one\n- [x] two");
    expect(blocks[4].type).toBe("callout");
    expect(roundTrip(md)).toBe(md);
  });

  it("meeting_page blocks (discord/render.rs)", () => {
    const md = "# Administrative Meeting\n\nTime\n8:00 PM\n\n## Topics\n\n- Store\n- Server\n- Staff\n\n[Confirm Attendance]";
    expect(fromMarkdown(md)).toEqual([
      { type: "heading", attrs: { level: 1 }, content: [txt("Administrative Meeting")] },
      p(txt("Time"), { type: "hardBreak" }, txt("8:00 PM")),
      { type: "heading", attrs: { level: 2 }, content: [txt("Topics")] },
      { type: "bulletList", content: [li(txt("Store")), li(txt("Server")), li(txt("Staff"))] },
      p(txt("[Confirm Attendance]")),
    ]);
    expect(roundTrip(md)).toBe(md);
  });
});

describe("withBids", () => {
  it("leaves fromMarkdown id-free, like the Rust, and adds fresh ids on request", () => {
    const blocks = fromMarkdown("# a\n\nb\n\n---");
    expect(blocks.every((b) => b.attrs?.bid === undefined)).toBe(true);
    const withIds = withBids(blocks);
    const ids = withIds.map((b) => b.attrs?.bid);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]+$/);
    expect(new Set(ids).size).toBe(3);
    expect(withIds[0].attrs?.level).toBe(1);
    expect(blocks[0].attrs?.bid).toBeUndefined();
  });

  it("keeps unique ids and replaces empty or repeated ones", () => {
    let n = 0;
    const out = withBids([{ type: "paragraph", attrs: { bid: "x" } }, { type: "paragraph", attrs: { bid: "x" } }, { type: "paragraph", attrs: { bid: "" } }], () => `n${n++}`);
    expect(out.map((b) => b.attrs?.bid)).toEqual(["x", "n0", "n1"]);
  });
});

describe("built-in templates", () => {
  const files = import.meta.glob("../../src-tauri/src/templates.rs", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  // rustc reads sources with LF line endings.
  const rust = Object.values(files)[0].replace(/\r\n/g, "\n");
  const english = [...rust.matchAll(/markdown: r#"([\s\S]*?)"#/g)].map((m) => m[1]);

  it("finds every desktop template", () => {
    expect(english.length).toBe([...rust.matchAll(/ key: "/g)].length);
    expect(english.length).toBeGreaterThan(10);
  });

  it("parses every English and Arabic template into blocks that write back", () => {
    const all = [...english, ...ARABIC_TEMPLATES.map((t) => t.markdown)].filter((md) => md.trim() !== "");
    for (const md of all) {
      let blocks: JSONLike[] = [];
      expect(() => (blocks = fromMarkdown(md))).not.toThrow();
      expect(blocks.length).toBeGreaterThan(0);
      const back = blocks.map(toMarkdown).join("\n\n");
      expect(back.trim()).not.toBe("");
      // Writing and reading again is stable.
      expect(fromMarkdown(back).map(toMarkdown).join("\n\n")).toBe(back);
    }
  });
});
