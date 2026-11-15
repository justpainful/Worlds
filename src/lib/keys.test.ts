import { describe, expect, it } from "vitest";
import { shortcutKey } from "./keys";

describe("shortcut keys", () => {
  it("reads the physical letter when an Arabic layout is active", () => {
    expect(shortcutKey({ key: "ن", code: "KeyK" })).toBe("k");
    expect(shortcutKey({ key: "ى", code: "KeyN" })).toBe("n");
    expect(shortcutKey({ key: "و", code: "Comma" })).toBe(",");
  });

  it("keeps the letter a Latin layout types", () => {
    expect(shortcutKey({ key: "K", code: "KeyK" })).toBe("k");
    // AZERTY: the key labelled A sits where QWERTY has Q.
    expect(shortcutKey({ key: "a", code: "KeyQ" })).toBe("a");
  });

  it("leaves other keys alone", () => {
    expect(shortcutKey({ key: "Enter", code: "Enter" })).toBe("Enter");
    expect(shortcutKey({ key: "\\", code: "Backslash" })).toBe("\\");
    expect(shortcutKey({ key: "/" })).toBe("/");
  });
});
