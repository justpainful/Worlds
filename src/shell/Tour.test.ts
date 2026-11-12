import { describe, expect, it } from "vitest";
import dictionary from "../i18n/ar.json";
import { placeCard, TOUR_STEPS } from "./tourModel";

const view = { width: 1280, height: 800 };
const card = { width: 340, height: 200 };

describe("guided tour", () => {
  it("puts the card beside a part on the side with more room", () => {
    // A sidebar on the right (Arabic): the card goes to its left.
    expect(placeCard({ top: 88, left: 1016, width: 262, height: 300 }, card, view)).toEqual({ top: 88, left: 662 });
    // A sidebar on the left (English): the card goes to its right.
    expect(placeCard({ top: 88, left: 2, width: 262, height: 300 }, card, view)).toEqual({ top: 88, left: 278 });
  });

  it("keeps the card on screen near the bottom edge and centres it with nothing to point at", () => {
    expect(placeCard({ top: 736, left: 1016, width: 262, height: 60 }, card, view).top).toBe(588);
    expect(placeCard(null, card, view)).toEqual({ top: 300, left: 470 });
  });

  it("goes below or above a part that spans the width", () => {
    expect(placeCard({ top: 40, left: 0, width: 1280, height: 100 }, card, view)).toEqual({ top: 154, left: 12 });
    expect(placeCard({ top: 560, left: 0, width: 1280, height: 230 }, card, view)).toEqual({ top: 346, left: 12 });
  });

  it("has Arabic for every step", () => {
    const ar = dictionary as Record<string, string>;
    for (const s of TOUR_STEPS) {
      expect(ar[s.title], s.title).toBeTruthy();
      expect(ar[s.body], s.body).toBeTruthy();
    }
  });
});
