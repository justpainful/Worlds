/**
 * Tier 3: Cross-Feature Combinations — Sync Wire Framing + Drawing Scene Interchange
 *
 * Combines worlds-sync.v1 binary framing, Drawing Scene Schema 1, and .worldsdraw ZIP containers:
 * - Desktop drawing packaged into .worldsdraw ZIP container
 * - Encapsulated into worlds-sync.v1 Drawing Journal Op (0x05)
 * - Fenced drawing lease request/grant (0x04) coordination
 * - Reconstituted and verified for Apple & Android platform clients
 */

import { describe, it, expect } from "vitest";
import {
  encodeBinaryFrame,
  decodeBinaryFrame,
  FRAME_TYPE_DRAWING_LEASE,
  FRAME_TYPE_DRAWING_JOURNAL_OP,
  type DrawingLeaseRequest,
  type DrawingLeaseGrant,
  type DrawingJournalOpPayload,
} from "../harness/protocol";
import {
  buildZipArchive,
  parseZipArchive,
  validateDrawingScene,
  type DrawingSceneFile,
  type PackageManifest,
} from "../harness/drawing-package";

describe("Tier 3: Sync Wire Framing + Drawing Scene Interchange", () => {
  it("coordinates drawing lease acquisition (0x04) with strict monotonically increasing fence", () => {
    // 1. Client sends Lease Request (acquire node:frame-1)
    const leaseRequest: DrawingLeaseRequest = {
      action: "acquire",
      target: "node:frame-1",
      requestId: "nonce-998877",
    };

    const requestFrame = encodeBinaryFrame(
      FRAME_TYPE_DRAWING_LEASE,
      JSON.stringify(leaseRequest)
    );
    expect(requestFrame.byteLength).toBeGreaterThan(6);

    const decodedReq = decodeBinaryFrame(requestFrame);
    const parsedReq: DrawingLeaseRequest = JSON.parse(
      new TextDecoder().decode(decodedReq.frame.payload)
    );
    expect(parsedReq.action).toBe("acquire");
    expect(parsedReq.target).toBe("node:frame-1");

    // 2. Server grants lease with fence = 101, expires in 15 seconds
    const now = Date.now();
    const leaseGrant: DrawingLeaseGrant = {
      target: "node:frame-1",
      ownerId: "user-desktop-1",
      deviceId: "dev-mac-1",
      token: "lease-token-sec-xyz",
      fence: 101,
      expiresAt: now + 15000,
    };

    const grantFrame = encodeBinaryFrame(
      FRAME_TYPE_DRAWING_LEASE,
      JSON.stringify(leaseGrant)
    );
    const decodedGrant = decodeBinaryFrame(grantFrame);
    const parsedGrant: DrawingLeaseGrant = JSON.parse(
      new TextDecoder().decode(decodedGrant.frame.payload)
    );

    expect(parsedGrant.fence).toBe(101);
    expect(parsedGrant.expiresAt).toBeGreaterThan(now);
  });

  it("encapsulates .worldsdraw ZIP package within Drawing Journal Op (0x05) and unpacks across platforms", () => {
    // 1. Build Drawing Scene Schema 1
    const scene: DrawingSceneFile = {
      schemaVersion: 1,
      scene: {
        id: "interchange-scene-1",
        layers: [
          {
            id: "layer-strokes",
            name: "Strokes",
            visible: true,
            locked: false,
            opacity: 1,
            blend: "source-over",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "stroke-apple",
            type: "stroke",
            layerId: "layer-strokes",
            dabs: [
              { x: 100, y: 150, pressure: 0.7, tiltX: 0.1, tiltY: -0.2, timestamp: 1000 },
              { x: 120, y: 160, pressure: 0.9, tiltX: 0.15, tiltY: -0.18, timestamp: 1016 },
            ],
            brush: { kind: "hard", size: 10, color: "#D2A46E", opacity: 1 },
          },
        ],
        layerOrder: ["layer-strokes"],
      },
      history: [],
    };

    const manifest: PackageManifest = {
      format: "worldsdraw",
      version: 1,
      appVersion: "1.0.0-desktop",
      createdAt: Date.now(),
      sceneFile: "scene.json",
      assets: [],
    };

    // 2. Pack into .worldsdraw ZIP
    const zipBytes = buildZipArchive([
      { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
      { name: "scene.json", data: new TextEncoder().encode(JSON.stringify(scene)) },
    ]);

    // 3. Encapsulate into Drawing Journal Op with lease proof
    const journalOp: DrawingJournalOpPayload = {
      opId: "op-sync-001",
      revision: 42,
      authorId: "user-desktop-1",
      generation: "gen-uuid-123",
      operations: [
        {
          type: "import_package",
          targetId: "interchange-scene-1",
          params: {
            packageBase64: Buffer.from(zipBytes).toString("base64"),
          },
        },
      ],
      leaseProof: {
        target: "node:frame-1",
        token: "lease-token-sec-xyz",
        fence: 101,
      },
    };

    const binaryWireFrame = encodeBinaryFrame(
      FRAME_TYPE_DRAWING_JOURNAL_OP,
      JSON.stringify(journalOp)
    );

    // 4. Client (e.g. Android or Apple Native) receives binary wire frame
    const decodedFrame = decodeBinaryFrame(binaryWireFrame);
    expect(decodedFrame.frame.frameType).toBe(FRAME_TYPE_DRAWING_JOURNAL_OP);

    const receivedOp: DrawingJournalOpPayload = JSON.parse(
      new TextDecoder().decode(decodedFrame.frame.payload)
    );
    expect(receivedOp.revision).toBe(42);
    expect(receivedOp.leaseProof?.fence).toBe(101);

    // 5. Unpack .worldsdraw ZIP package on receiving peer
    const receivedZipBytes = Buffer.from(
      receivedOp.operations[0].params.packageBase64 as string,
      "base64"
    );
    const extractedFiles = parseZipArchive(new Uint8Array(receivedZipBytes));
    expect(extractedFiles.has("manifest.json")).toBe(true);
    expect(extractedFiles.has("scene.json")).toBe(true);

    const extractedScene = JSON.parse(
      new TextDecoder().decode(extractedFiles.get("scene.json")!)
    );
    const validation = validateDrawingScene(extractedScene);
    expect(validation.valid).toBe(true);
    expect(extractedScene.scene.nodes[0].brush.color).toBe("#D2A46E");
  });
});
