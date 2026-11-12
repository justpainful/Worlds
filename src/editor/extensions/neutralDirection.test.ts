import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { firstStrong, neutralDirections } from "./neutralDirection";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", attrs: { dir: { default: null } } },
    codeBlock: { group: "block", content: "text*", code: true },
    text: {},
  },
});

const doc = (...lines: (string | [string, string])[]) =>
  schema.node(
    "doc",
    null,
    lines.map((l) =>
      Array.isArray(l)
        ? schema.node("paragraph", { dir: l[1] }, l[0] ? [schema.text(l[0])] : [])
        : schema.node("paragraph", null, l ? [schema.text(l)] : []),
    ),
  );

const dirs = (d: ReturnType<typeof doc>, fallback: "rtl" | "ltr" = "ltr") =>
  neutralDirections(d, fallback).map((x) => `${d.resolve(x.from).index()}:${x.dir}`);

describe("direction of lines without letters", () => {
  it("finds the first letter's direction", () => {
    expect(firstStrong("12 مهمة")).toBe("rtl");
    expect(firstStrong("/ Heading")).toBe("ltr");
    expect(firstStrong("/ 12 ...")).toBeNull();
    expect(firstStrong("")).toBeNull();
  });

  it("gives an empty or slash line the direction of the line before it", () => {
    expect(dirs(doc("خطة الأسبوع", "", "/"))).toEqual(["1:rtl", "2:rtl"]);
    expect(dirs(doc("Weekly plan", "/"), "rtl")).toEqual(["1:ltr"]);
  });

  it("leaves lines with letters to dir=auto", () => {
    expect(dirs(doc("خطة", "Plan", "ملاحظة"))).toEqual([]);
  });

  it("takes the first direction found for leading empty lines, and the interface's for a page with no letters", () => {
    expect(dirs(doc("", "ملاحظة"))).toEqual(["0:rtl"]);
    expect(dirs(doc("", "12"), "rtl")).toEqual(["0:rtl", "1:rtl"]);
    expect(dirs(doc(""), "ltr")).toEqual(["0:ltr"]);
  });

  it("follows a direction the writer set by hand", () => {
    expect(dirs(doc(["", "rtl"], ""))).toEqual(["1:rtl"]);
  });

  it("skips blocks that have no direction, such as code", () => {
    const d = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("عربي")]), schema.node("codeBlock", null, [schema.text("x = 1")]), schema.node("paragraph")]);
    expect(dirs(d)).toEqual(["2:rtl"]);
  });
});
