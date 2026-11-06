import { expect, it } from "vitest";
import { LaserOverlay } from "./laser";
it("laser trails expire and never enter the persistent drawing model", () => {
  const overlay = new LaserOverlay();
  const trail = { id: "one", actor: "a", width: 6, color: "#ff0000", points: [{ x: 10, y: 20 }], releasedAt: 1000, lifetime: 1000 };
  overlay.update(trail);
  expect(overlay.opacity(trail, 1500)).toBe(0.5);
  overlay.prune(2000); expect(overlay.strokes.size).toBe(0);
  overlay.update({ ...trail, releasedAt: null }); overlay.removeActor("a"); expect(overlay.strokes.size).toBe(0);
});
