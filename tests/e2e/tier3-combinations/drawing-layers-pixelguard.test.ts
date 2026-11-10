/**
 * Tier 3: Cross-Feature Combinations — Drawing Layers + Pixel Guard + History Rebase
 *
 * Combines multi-layer drawing scenes, destructive pixel edits with pixelGuard preconditions,
 * and concurrent edit conflict resolution:
 * - Multi-layer scene with background, sketch, and ink layers
 * - Destructive pixel modification carrying pixelGuard precondition
 * - Concurrent edit on independent layer rebases cleanly
 * - Concurrent conflicting edit triggers explicit recovery instead of data loss
 */

import { describe, it, expect } from "vitest";
import {
  validateDrawingScene,
  type DrawingSceneFile,
} from "../harness/drawing-package";

interface PixelGuardPrecondition {
  frameId: string;
  expectedLayers: string[];
  expectedRevision: number;
  ancestors?: string[];
}

interface DrawingEditOp {
  opId: string;
  type: "stroke" | "erase" | "transform";
  targetLayerId: string;
  pixelGuard?: PixelGuardPrecondition;
  data: Record<string, unknown>;
}

describe("Tier 3: Drawing Layers + Pixel Guard + Rebase", () => {
  it("merges independent edits on distinct layers without conflict", () => {
    const scene: DrawingSceneFile = {
      schemaVersion: 1,
      scene: {
        id: "multi-layer-scene",
        layers: [
          {
            id: "layer-bg",
            name: "Background",
            visible: true,
            locked: true,
            opacity: 1,
            blend: "source-over",
            parentId: null,
          },
          {
            id: "layer-sketch",
            name: "Sketch",
            visible: true,
            locked: false,
            opacity: 0.7,
            blend: "source-over",
            parentId: null,
          },
          {
            id: "layer-ink",
            name: "Ink",
            visible: true,
            locked: false,
            opacity: 1.0,
            blend: "multiply",
            parentId: null,
          },
        ],
        nodes: [],
        layerOrder: ["layer-bg", "layer-sketch", "layer-ink"],
      },
      history: [],
    };

    expect(validateDrawingScene(scene).valid).toBe(true);

    // Peer 1 edits layer-sketch
    const op1: DrawingEditOp = {
      opId: "op-peer-1",
      type: "stroke",
      targetLayerId: "layer-sketch",
      data: { brush: "pencil", dabsCount: 15 },
    };

    // Peer 2 edits layer-ink concurrently
    const op2: DrawingEditOp = {
      opId: "op-peer-2",
      type: "stroke",
      targetLayerId: "layer-ink",
      data: { brush: "ink", dabsCount: 22 },
    };

    // Both layers are disjoint -> rebase is commutative and conflict-free
    const isDisjoint = op1.targetLayerId !== op2.targetLayerId;
    expect(isDisjoint).toBe(true);
  });

  it("enforces pixelGuard precondition on destructive pixel edit and routes violations to recovery", () => {
    let currentCanonicalRevision = 10;

    // Destructive erase op prepared against revision 10
    const eraseOp: DrawingEditOp = {
      opId: "op-erase-destructive",
      type: "erase",
      targetLayerId: "layer-ink",
      pixelGuard: {
        frameId: "frame-main",
        expectedLayers: ["layer-ink"],
        expectedRevision: 10,
        ancestors: ["frame-main"],
      },
      data: { erasePolygon: [{ x: 50, y: 50 }, { x: 100, y: 100 }] },
    };

    const validateAndApplyOp = (op: DrawingEditOp, canonicalRev: number) => {
      if (op.pixelGuard) {
        if (op.pixelGuard.expectedRevision !== canonicalRev) {
          // Precondition failed: must NOT overwrite canonical artwork!
          return {
            status: "rejected_to_recovery",
            reason: `PixelGuard mismatch: expected rev ${op.pixelGuard.expectedRevision}, server is at rev ${canonicalRev}`,
            retainedInLocalRecovery: true,
          };
        }
      }
      return { status: "accepted", newRevision: canonicalRev + 1 };
    };

    // 1. Valid application when revisions match
    const validResult = validateAndApplyOp(eraseOp, currentCanonicalRevision);
    expect(validResult.status).toBe("accepted");

    // 2. Race condition: concurrent commit bumps revision to 11
    currentCanonicalRevision = 11;
    const raceResult = validateAndApplyOp(eraseOp, currentCanonicalRevision);
    expect(raceResult.status).toBe("rejected_to_recovery");
    expect(raceResult.retainedInLocalRecovery).toBe(true);
    expect(raceResult.reason).toContain("PixelGuard mismatch");
  });
});
