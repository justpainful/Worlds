import { describe, expect, it } from "vitest";
import { normalizeUsername, usernameProblem } from "./usernames";

describe("usernames", () => {
  it("allows three characters and the safe set", () => {
    for (const ok of ["abc", "a_b", "a.b", "x9z", "a".repeat(20)]) expect(usernameProblem(ok)).toBeNull();
  });
  it("explains what is wrong", () => {
    expect(usernameProblem("ab")).toMatch(/3/);
    expect(usernameProblem("a".repeat(21))).toMatch(/20/);
    for (const bad of [".abc", "abc.", "a..b", "ab-c"]) expect(usernameProblem(bad)).not.toBeNull();
  });
  it("normalizes what people type", () => {
    expect(normalizeUsername(" @Sra ")).toBe("sra");
  });
});
