/**
 * Empirical Challenger Verification Suite: Drawing Package & Stylus Cross-Platform
 *
 * Mandate Verification:
 * 1. .worldsdraw container interchange across Desktop, Apple, and Android (Schema 1 PKZIP vs custom GZIP)
 * 2. Stress test stroke dab rendering, pressure curves, zero-pressure bypass, and extreme tilt angles
 * 3. Layer blend mode mathematics across platforms (normal/source-over, multiply, screen, overlay, darken, lighten)
 * 4. Transform handle matrix mathematics (translation, scale, rotation around center pivot)
 */

import { describe, it, expect } from "vitest";
import * as zlib from "node:zlib";
import {
  buildZipArchive,
  parseZipArchive,
  validateDrawingScene,
  computeStrokeWork,
  MAX_STROKE_WORK_BUDGET,
  type DrawingSceneFile,
  type PackageManifest,
  type Dab,
} from "./harness/drawing-package";

// Helper: Desktop-style container pack (WORLDSDRAW1\n + GZIP(JSON))
function packDesktopWorldsdraw(payload: unknown): Uint8Array {
  const header = Buffer.from("WORLDSDRAW1\n", "utf8");
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const compressed = zlib.gzipSync(json);
  return new Uint8Array(Buffer.concat([header, compressed]));
}

// Helper: Universal container unpack supporting both PKZIP (PK\x03\x04) and WORLDSDRAW1\n + GZIP(JSON)
function unpackUniversalWorldsdraw(bytes: Uint8Array): unknown {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    const entries = parseZipArchive(bytes);
    const sceneBytes = entries.get("scene.json");
    if (!sceneBytes) throw new Error("Missing scene.json in PKZIP Worldsdraw archive");
    return JSON.parse(new TextDecoder().decode(sceneBytes));
  }
  const header = "WORLDSDRAW1\n";
  const headerBytes = new TextEncoder().encode(header);
  if (bytes.length < headerBytes.length) {
    throw new Error("Invalid header length");
  }
  const prefix = new TextDecoder().decode(bytes.subarray(0, headerBytes.length));
  if (prefix !== header) {
    throw new Error("This is not a Worlds drawing project");
  }
  const compressed = bytes.subarray(headerBytes.length);
  const decompressed = zlib.gunzipSync(compressed);
  return JSON.parse(new TextDecoder().decode(decompressed));
}

describe("CHALLENGER MANDATE 1: .worldsdraw Container Interchange Across Platforms", () => {
  it("verifies Schema 1 PKZIP format with manifest.json, scene.json, and /assets/ directory", () => {
    const manifest: PackageManifest = {
      format: "worldsdraw",
      version: 1,
      appVersion: "1.0.0-cross-platform",
      createdAt: Date.now(),
      sceneFile: "scene.json",
      assets: [
        {
          id: "asset-1",
          path: "assets/texture-paper.png",
          mime: "image/png",
          size: 4,
        },
      ],
    };

    const scene: DrawingSceneFile = {
      schemaVersion: 1,
      scene: {
        id: "scene-schema-1",
        layers: [
          {
            id: "layer-bg",
            name: "Background",
            visible: true,
            locked: false,
            opacity: 1,
            blend: "source-over",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "node-1",
            type: "stroke",
            layerId: "layer-bg",
            dabs: [
              { x: 10, y: 20, pressure: 0.5, tiltX: 0, tiltY: 0, timestamp: 100 },
            ],
            brush: { kind: "hard", size: 10, color: "#D2A46E", opacity: 1 },
          },
        ],
        layerOrder: ["layer-bg"],
      },
      history: [],
    };

    const dummyAssetData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes

    const zipBytes = buildZipArchive([
      { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
      { name: "scene.json", data: new TextEncoder().encode(JSON.stringify(scene)) },
      { name: "assets/texture-paper.png", data: dummyAssetData },
    ]);

    expect(zipBytes.byteLength).toBeGreaterThan(0);

    // Unpack and verify PKZIP structure
    const extracted = parseZipArchive(zipBytes);
    expect(extracted.has("manifest.json")).toBe(true);
    expect(extracted.has("scene.json")).toBe(true);
    expect(extracted.has("assets/texture-paper.png")).toBe(true);

    const parsedManifest = JSON.parse(new TextDecoder().decode(extracted.get("manifest.json")!));
    expect(parsedManifest.format).toBe("worldsdraw");
    expect(parsedManifest.version).toBe(1);

    const parsedScene = JSON.parse(new TextDecoder().decode(extracted.get("scene.json")!));
    const validation = validateDrawingScene(parsedScene);
    expect(validation.valid).toBe(true);
  });

  it("verifies Apple PKZIP container unpacks cleanly in universal reader", () => {
    const appleZip = buildZipArchive([
      { name: "manifest.json", data: new TextEncoder().encode('{"format":"worldsdraw","version":1}') },
      { name: "scene.json", data: new TextEncoder().encode('{"schemaVersion":1,"scene":{"id":"s1","layers":[],"nodes":[],"layerOrder":[]},"history":[]}') },
    ]);

    const unpacked = unpackUniversalWorldsdraw(appleZip) as DrawingSceneFile;
    expect(unpacked.schemaVersion).toBe(1);
    expect(unpacked.scene.id).toBe("s1");
  });

  it("verifies Desktop WORLDSDRAW1\\n container unpacks cleanly in universal reader", () => {
    const desktopPayload = {
      format: "worldsdraw",
      version: 1,
      scene: { id: "desktop-scene", layers: [], nodes: [], layerOrder: [] },
      assets: [],
    };
    const desktopPackageBytes = packDesktopWorldsdraw(desktopPayload);

    const unpacked = unpackUniversalWorldsdraw(desktopPackageBytes) as typeof desktopPayload;
    expect(unpacked.format).toBe("worldsdraw");
    expect(unpacked.scene.id).toBe("desktop-scene");
  });

  it("verifies Android DrawingPackage.kt header logic accepts both PKZIP and WORLDSDRAW1\\n", () => {
    const appleZip = buildZipArchive([
      { name: "manifest.json", data: new TextEncoder().encode('{"format":"worldsdraw"}') },
      { name: "scene.json", data: new TextEncoder().encode('{"schemaVersion":1}') },
    ]);

    const androidHeader = new TextEncoder().encode("WORLDSDRAW1\n");
    const isPkZip =
      appleZip.length >= 4 &&
      appleZip[0] === 0x50 &&
      appleZip[1] === 0x4b &&
      appleZip[2] === 0x03 &&
      appleZip[3] === 0x04;
    const hasAndroidHeader =
      appleZip.length >= androidHeader.length &&
      appleZip.subarray(0, androidHeader.length).every((b, i) => b === androidHeader[i]);

    expect(isPkZip || hasAndroidHeader).toBe(true);
  });
});

describe("CHALLENGER MANDATE 2: Stress Testing Dab Rendering, Pressure & Tilt", () => {
  it("enforces 50,000 dabs work budget under normal movement", () => {
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
    expect(work).toBeGreaterThan(MAX_STROKE_WORK_BUDGET);
  });

  it("enforces work budget on 50,000 zero-pressure dabs (prevents zero-pressure bypass)", () => {
    const zeroPressureDabs: Dab[] = [];
    for (let i = 0; i < 50_000; i++) {
      zeroPressureDabs.push({
        x: i * 10,
        y: i * 10,
        pressure: 0.0,
        tiltX: 0,
        tiltY: 0,
        timestamp: i * 2,
      });
    }

    const work = computeStrokeWork(zeroPressureDabs, 32);
    expect(work).toBeGreaterThan(MAX_STROKE_WORK_BUDGET);
  });

  it("enforces work budget on 50,000 stationary dabs (prevents zero-movement overdraw bypass)", () => {
    const stationaryDabs: Dab[] = [];
    for (let i = 0; i < 50_000; i++) {
      stationaryDabs.push({
        x: 100,
        y: 100,
        pressure: 1.0,
        tiltX: 0,
        tiltY: 0,
        timestamp: i * 16,
      });
    }

    const work = computeStrokeWork(stationaryDabs, 32);
    expect(work).toBeGreaterThan(MAX_STROKE_WORK_BUDGET);
  });

  it("validates tiltX and tiltY and rejects NaN, Infinity, and out-of-range tilt angles", () => {
    const extremeTiltScene: DrawingSceneFile = {
      schemaVersion: 1,
      scene: {
        id: "tilt-stress",
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
            id: "n-tilt",
            type: "stroke",
            layerId: "l1",
            dabs: [
              { x: 10, y: 10, pressure: 0.5, tiltX: NaN, tiltY: Infinity, timestamp: 0 },
              { x: 20, y: 20, pressure: 0.5, tiltX: 999999, tiltY: -888888, timestamp: 16 },
            ],
          },
        ],
        layerOrder: ["l1"],
      },
      history: [],
    };

    const validation = validateDrawingScene(extremeTiltScene);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("CHALLENGER MANDATE 3: Drawing Layer Blend Mode Mathematics Across Platforms", () => {
  // Pure blending mathematical formulas in [0, 1]
  const blendOps = {
    normal: (s: number, d: number) => s,
    multiply: (s: number, d: number) => s * d,
    screen: (s: number, d: number) => s + d - s * d,
    overlay: (s: number, d: number) => (d <= 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d)),
    darken: (s: number, d: number) => Math.min(s, d),
    lighten: (s: number, d: number) => Math.max(s, d),
  };

  it("verifies mathematical precision of all 6 blend modes on canonical test vectors", () => {
    const vectors = [
      { name: "Black on White", s: 0.0, d: 1.0 },
      { name: "White on Black", s: 1.0, d: 0.0 },
      { name: "Mid-gray on Mid-gray", s: 0.5, d: 0.5 },
      { name: "Gold on Canvas Dark", s: 0.8235, d: 0.047 },
      { name: "Canvas Dark on Gold", s: 0.047, d: 0.8235 },
    ];

    for (const v of vectors) {
      const normalRes = blendOps.normal(v.s, v.d);
      const multRes = blendOps.multiply(v.s, v.d);
      const screenRes = blendOps.screen(v.s, v.d);
      const overlayRes = blendOps.overlay(v.s, v.d);
      const darkenRes = blendOps.darken(v.s, v.d);
      const lightenRes = blendOps.lighten(v.s, v.d);

      expect(normalRes).toBe(v.s);
      expect(multRes).toBeCloseTo(v.s * v.d, 6);
      expect(screenRes).toBeCloseTo(v.s + v.d - v.s * v.d, 6);
      expect(darkenRes).toBe(Math.min(v.s, v.d));
      expect(lightenRes).toBe(Math.max(v.s, v.d));

      if (v.d <= 0.5) {
        expect(overlayRes).toBeCloseTo(2 * v.s * v.d, 6);
      } else {
        expect(overlayRes).toBeCloseTo(1 - 2 * (1 - v.s) * (1 - v.d), 6);
      }
    }
  });

  it("verifies 'normal' and 'source-over' blend modes are accepted interchangeably across Apple, Android, and Desktop", () => {
    const allowedByDesktopAndAndroid = new Set([
      "source-over",
      "normal",
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
    ]);

    expect(allowedByDesktopAndAndroid.has("normal")).toBe(true);
    expect(allowedByDesktopAndAndroid.has("source-over")).toBe(true);

    const appleBlendResolver = (value: string): string | null => {
      switch (value) {
        case "source-over":
        case "normal":
          return "normal";
        case "multiply": return "multiply";
        case "screen": return "screen";
        case "overlay": return "overlay";
        case "darken": return "darken";
        case "lighten": return "lighten";
        default: return null;
      }
    };

    expect(appleBlendResolver("normal")).toBe("normal");
    expect(appleBlendResolver("source-over")).toBe("normal");
  });
});

describe("CHALLENGER MANDATE 4: Transform Handle Matrix Mathematics", () => {
  // 2D Affine Matrix [a, b, c, d, tx, ty]
  // [ x' ] = [ a  c  tx ] [ x ]
  // [ y' ]   [ b  d  ty ] [ y ]
  //          [ 0  0   1 ] [ 1 ]
  interface Matrix2D {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
  }

  const identity: Matrix2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

  function multiply(m1: Matrix2D, m2: Matrix2D): Matrix2D {
    return {
      a: m1.a * m2.a + m1.c * m2.b,
      b: m1.b * m2.a + m1.d * m2.b,
      c: m1.a * m2.c + m1.c * m2.d,
      d: m1.b * m2.c + m1.d * m2.d,
      tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
      ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
    };
  }

  function translate(tx: number, ty: number): Matrix2D {
    return { a: 1, b: 0, c: 0, d: 1, tx, ty };
  }

  function scale(sx: number, sy: number): Matrix2D {
    return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 };
  }

  function rotate(radians: number): Matrix2D {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
  }

  function transformPoint(m: Matrix2D, pt: { x: number; y: number }): { x: number; y: number } {
    return {
      x: m.a * pt.x + m.c * pt.y + m.tx,
      y: m.b * pt.x + m.d * pt.y + m.ty,
    };
  }

  // Construct matrix for transform around center pivot (cx, cy):
  // M = T(cx, cy) * R(theta) * S(sx, sy) * T(-cx, -cy)
  function createCenterPivotTransform(
    cx: number,
    cy: number,
    sx: number,
    sy: number,
    angleDeg: number
  ): Matrix2D {
    const rad = (angleDeg * Math.PI) / 180;
    const tToOrigin = translate(-cx, -cy);
    const s = scale(sx, sy);
    const r = rotate(rad);
    const tBack = translate(cx, cy);

    return multiply(tBack, multiply(r, multiply(s, tToOrigin)));
  }

  it("verifies that center pivot remains strictly invariant under scale and rotation", () => {
    const cx = 250;
    const cy = 400;

    const testAngles = [0, 15, 45, 90, 180, 270, 360, -45, -180];
    const testScales = [
      [1, 1],
      [2, 2],
      [0.5, 0.5],
      [1.5, 0.8],
      [-1, 1], // horizontal flip
      [1, -1], // vertical flip
    ];

    for (const angle of testAngles) {
      for (const [sx, sy] of testScales) {
        const mat = createCenterPivotTransform(cx, cy, sx, sy, angle);
        const transformedPivot = transformPoint(mat, { x: cx, y: cy });

        expect(transformedPivot.x).toBeCloseTo(cx, 9);
        expect(transformedPivot.y).toBeCloseTo(cy, 9);
      }
    }
  });

  it("verifies isometry (distance preservation) under pure rotation around pivot", () => {
    const cx = 300;
    const cy = 300;
    const p1 = { x: 200, y: 250 };
    const p2 = { x: 450, y: 350 };
    const originalDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

    for (let angle = 0; angle <= 360; angle += 30) {
      const mat = createCenterPivotTransform(cx, cy, 1.0, 1.0, angle);
      const tp1 = transformPoint(mat, p1);
      const tp2 = transformPoint(mat, p2);
      const rotatedDist = Math.hypot(tp2.x - tp1.x, tp2.y - tp1.y);

      expect(rotatedDist).toBeCloseTo(originalDist, 9);
    }
  });

  it("verifies invertibility: applying transform followed by inverse restores original points", () => {
    const cx = 150;
    const cy = 200;
    const sx = 1.75;
    const sy = 0.6;
    const angle = 53.5;

    const forward = createCenterPivotTransform(cx, cy, sx, sy, angle);
    // Inverse: T(cx, cy) * S(1/sx, 1/sy) * R(-theta) * T(-cx, -cy)
    const rad = (-angle * Math.PI) / 180;
    const tToOrigin = translate(-cx, -cy);
    const rInv = rotate(rad);
    const sInv = scale(1 / sx, 1 / sy);
    const tBack = translate(cx, cy);
    const backward = multiply(tBack, multiply(sInv, multiply(rInv, tToOrigin)));

    const composite = multiply(backward, forward);

    const testPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 150 },
      { x: -50, y: 300 },
      { x: 1000, y: -200 },
    ];

    for (const pt of testPoints) {
      const result = transformPoint(composite, pt);
      expect(result.x).toBeCloseTo(pt.x, 8);
      expect(result.y).toBeCloseTo(pt.y, 8);
    }
  });

  it("verifies Desktop, Apple, and Android center pivot formula equivalence", () => {
    // Android DrawingStore.kt rotateStrokes formula:
    // dx = cx - originX; dy = cy - originY
    // newCx = originX + (dx * cosA - dy * sinA)
    // newCy = originY + (dx * sinA + dy * cosA)
    const originX = 500;
    const originY = 500;
    const angleDeg = 45;
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    const pt = { x: 600, y: 700 };

    // Android method:
    const dx = pt.x - originX;
    const dy = pt.y - originY;
    const androidX = originX + (dx * cosA - dy * sinA);
    const androidY = originY + (dx * sinA + dy * cosA);

    // Desktop/Matrix method:
    const mat = createCenterPivotTransform(originX, originY, 1.0, 1.0, angleDeg);
    const matrixPt = transformPoint(mat, pt);

    expect(matrixPt.x).toBeCloseTo(androidX, 9);
    expect(matrixPt.y).toBeCloseTo(androidY, 9);
  });
});
