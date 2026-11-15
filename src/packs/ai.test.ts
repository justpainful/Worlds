import { describe, expect, it } from "vitest";
import { packsForClaudeFrom } from "./ai";
import { PACKS_KEY } from "./registry";

describe("packs for Claude", () => {
  it("says nothing when no pack is on", () => {
    expect(packsForClaudeFrom({})).toBe("");
  });

  it("names each kind's stored kind and its fields, choices and links", () => {
    const text = packsForClaudeFrom({ [PACKS_KEY]: ["freelance", "study"] });
    expect(text).toContain("Freelance pack:");
    expect(text).toContain("kind freelance.invoice. Fields:");
    expect(text).toContain("status (stage: draft=Not sent, sent=Sent, paid=Paid, late=Late)");
    expect(text).toContain("client (link to a freelance.client id)");
    expect(text).toContain("total (money, SAR)");
    // Study keeps its own kinds and data keys.
    expect(text).toContain("kind assignment (fields under assignment)");
    expect(text).not.toContain("Teacher pack:");
  });
});
