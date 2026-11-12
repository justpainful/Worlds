import { describe, expect, it } from "vitest";
import { describeTrigger } from "./automationText";

describe("automation schedule text", () => {
  it("names common day sets, including the Sunday to Thursday week", () => {
    expect(describeTrigger({ kind: "weekly", days: [0, 1, 2, 3, 4], time: "09:00" })).toMatch(/^Sunday to Thursday at /);
    expect(describeTrigger({ kind: "weekly", days: [5, 6], time: "09:00" })).toMatch(/^Friday and Saturday at /);
    expect(describeTrigger({ kind: "weekly", days: [5, 4, 3, 2, 1], time: "09:00" })).toMatch(/^Weekdays at /);
    expect(describeTrigger({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" })).toMatch(/^Every day at /);
  });

  it("lists other days by their short names in the interface language", () => {
    const sample = new Date(2026, 10, 9).toLocaleDateString(undefined, { weekday: "short" });
    expect(describeTrigger({ kind: "weekly", days: [1, 3], time: "09:00" })).toMatch(new RegExp(`^On ${sample}, .+ at `));
  });
});
