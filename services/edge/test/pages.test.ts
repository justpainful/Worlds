import { describe, expect, it } from "vitest";
import { clean, plainText } from "../src/pages";

describe("published pages", () => {
  it("removes anything that could run or load", () => {
    const out = clean(`<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="https://x"></iframe><a href="javascript:alert(1)">l</a><img src="https://a/b.png">`);
    expect(out).not.toMatch(/script|iframe|onclick|javascript:/i);
    expect(out).toContain("<img");
  });
});

describe("inbound mail", () => {
  it("reads the plain text part of a multipart message", () => {
    const raw = [
      "Subject: test",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Hello =3D world",
      "--b1",
      "Content-Type: text/html",
      "",
      "<p>Hello</p>",
      "--b1--",
    ].join("\r\n");
    expect(plainText(raw)).toBe("Hello = world");
  });

  it("falls back to the HTML part without tags", () => {
    const raw = ["Content-Type: text/html; charset=utf-8", "", "<p>One</p><p>Two &amp; three</p>"].join("\r\n");
    expect(plainText(raw)).toBe("One\nTwo & three");
  });
});
