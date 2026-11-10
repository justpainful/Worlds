/**
 * Tier 2: Boundary & Corner Cases — Drawing Engine & Package Boundaries
 *
 * Exercises extreme conditions on the drawing engine and package container:
 * - Empty drawing scenes (0 layers, 0 nodes)
 * - Negative and extreme canvas coordinates
 * - Non-finite coordinates (NaN, Infinity) and invalid dab pressures
 * - Stroke work budget enforcement on 50,000 high-density dabs
 * - Malformed, truncated, or corrupt ZIP archives
 */

import { describe, it, expect } from "vitest";
import {
  computeStrokeWork,
  validateDrawingScene,
  buildZipArchive,
  parseZipArchive,
  MAX_STROKE_WORK_BUDGET,
  type DrawingSceneFile,
  type Dab,
} from "../harness/drawing-package";

describe("Tier 2: Drawing Engine & Package Boundaries", () => {
  it("validates empty scene structure with 0 layers and 0 nodes", () => {
    const emptyScene: DrawingSceneFile = {
      schemaVersion: 1,
      scene: {
        id: "empty-scene",
        layers: [],
        nodes: [],
        layerOrder: [],
      },
      history: [],
    };

    const result = validateDrawingScene(emptyScene);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects non-finite coordinates (NaN, Infinity) and out-of-bounds dab pressure", () => {
    const invalidDabsScene: DrawingSceneFile = {
      schemaVersion: 1,
      scene: {
        id: "invalid-dabs",
        layers: [
          {
            id: "l1",
            name: "L1",
            visible: true,
            locked: false,
            opacity: 1,
            blend: "source-over",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "n1",
            type: "stroke",
            layerId: "l1",
            dabs: [
              { x: NaN, y: 10, pressure: 0.5, tiltX: 0, tiltY: 0, timestamp: 0 },
              { x: 10, y: Infinity, pressure: 0.5, tiltX: 0, tiltY: 0, timestamp: 16 },
              { x: 20, y: 30, pressure: 1.5, tiltX: 0, tiltY: 0, timestamp: 32 }, // pressure > 1
              { x: 40, y: 50, pressure: -0.2, tiltX: 0, tiltY: 0, timestamp: 48 }, // pressure < 0
            ],
          },
        ],
        layerOrder: ["l1"],
      },
      history: [],
    };

    const result = validateDrawingScene(invalidDabsScene);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invalid dab coordinates"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Dab pressure out of range"))).toBe(true);
  });

  it("enforces stroke work budget calculation on 50,000 dense dabs", () => {
    // Generate 50,000 dabs
    const denseDabs: Dab[] = [];
    for (let i = 0; i < 50_000; i++) {
      denseDabs.push({
        x: i * 2,
        y: Math.sin(i * 0.1) * 50,
        pressure: 0.8,
        tiltX: 0,
        tiltY: 0,
        timestamp: i * 2,
      });
    }

    const work = computeStrokeWork(denseDabs, 32);
    // 50,000 dabs with step 2 and size 32 -> ~50000 * 2 * 32 * 0.8 = ~2,560,000
    expect(work).toBeGreaterThan(MAX_STROKE_WORK_BUDGET);

    const isExceeded = work > MAX_STROKE_WORK_BUDGET;
    expect(isExceeded).toBe(true);
  });

  it("detects corrupted ZIP headers and truncated archive data", () => {
    // 1. Completely random / non-ZIP bytes
    const randomBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);
    expect(() => parseZipArchive(randomBytes)).toThrowError(/too short for EOCD/i);

    // 2. Corrupt archive with invalid EOCD
    const fakeZip = new Uint8Array(50);
    fakeZip.fill(0);
    expect(() => parseZipArchive(fakeZip)).toThrowError(/EOCD signature not found/i);

    // 3. Valid archive that has been truncated mid-stream
    const validZip = buildZipArchive([
      { name: "test.txt", data: new TextEncoder().encode("Hello world content") },
    ]);
    const truncatedZip = validZip.subarray(0, validZip.length - 15); // cut off part of EOCD
    expect(() => parseZipArchive(truncatedZip)).toThrowError();
  });
});
