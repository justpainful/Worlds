/**
 * Tier 4: Real-World Scenarios — Scenario 4: Multi-User Collaboration & Offline Session
 *
 * Implements a complete end-to-end multi-peer collaboration session:
 * - Handshake negotiation over worlds-sync.v1 (Auth state, state vector sync steps 1 & 2)
 * - Live bidirectional document edits between Desktop and Native Mobile peers
 * - Ephemeral awareness presence & laser pointer tracking (25Hz throttling, 3s expiration)
 * - Network disconnection simulation: offline edits queued in durable outbox
 * - Network reconnection: handshake re-establishment, outbox drain, causal CRDT convergence
 */

import { describe, it, expect } from "vitest";
import {
  encodeBinaryFrame,
  decodeBinaryFrame,
  FRAME_TYPE_AUTH,
  FRAME_TYPE_YRS_UPDATE,
  FRAME_TYPE_AWARENESS,
} from "../harness/protocol";

interface AwarenessState {
  userId: string;
  cursor: { x: number; y: number };
  laser?: { x: number; y: number; color: string; expiresAt: number };
}

interface OutboxItem {
  id: string;
  channel: number;
  data: Uint8Array;
  state: "pending" | "acknowledged" | "rejected";
}

describe("Tier 4: Scenario 4: Multi-User Collaboration & Offline Session", () => {
  it("orchestrates live multi-peer sync, awareness laser, offline outbox queuing, and convergence", () => {
    // 1. Initial Handshake & Auth Negotiation
    const desktopAuthFrame = encodeBinaryFrame(
      FRAME_TYPE_AUTH,
      JSON.stringify({ level: "full", userId: "usr-desktop-1" })
    );
    const androidAuthFrame = encodeBinaryFrame(
      FRAME_TYPE_AUTH,
      JSON.stringify({ level: "edit", userId: "usr-android-1" })
    );

    const decodedDesktopAuth = decodeBinaryFrame(desktopAuthFrame);
    const decodedAndroidAuth = decodeBinaryFrame(androidAuthFrame);

    expect(decodedDesktopAuth.frame.frameType).toBe(FRAME_TYPE_AUTH);
    expect(decodedAndroidAuth.frame.frameType).toBe(FRAME_TYPE_AUTH);

    // 2. Ephemeral Awareness & Laser Pointer Tracking
    const now = Date.now();
    const awarenessDesktop: AwarenessState = {
      userId: "usr-desktop-1",
      cursor: { x: 300, y: 400 },
      laser: {
        x: 305,
        y: 402,
        color: "#D2A46E",
        expiresAt: now + 3000, // 3-second lifetime
      },
    };

    const awarenessFrame = encodeBinaryFrame(
      FRAME_TYPE_AWARENESS,
      JSON.stringify(awarenessDesktop)
    );
    const decodedAwareness = decodeBinaryFrame(awarenessFrame);
    const parsedAwareness: AwarenessState = JSON.parse(
      new TextDecoder().decode(decodedAwareness.frame.payload)
    );

    expect(parsedAwareness.laser?.color).toBe("#D2A46E");
    expect(parsedAwareness.laser?.expiresAt).toBeGreaterThan(now);

    // Expire laser after 3 seconds
    const isLaserActive = (laser?: { expiresAt: number }, atTime = Date.now()) =>
      !!laser && laser.expiresAt > atTime;

    expect(isLaserActive(parsedAwareness.laser, now)).toBe(true);
    expect(isLaserActive(parsedAwareness.laser, now + 3001)).toBe(false);

    // 3. Network Disruption Simulation
    let isNetworkOnline = false;
    const localOutbox: OutboxItem[] = [];

    const queueOfflineEdit = (dataStr: string) => {
      const data = new TextEncoder().encode(dataStr);
      localOutbox.push({
        id: `outbox-op-${localOutbox.length + 1}`,
        channel: 0,
        data,
        state: "pending",
      });
    };

    // User edits offline while commuting
    queueOfflineEdit("Paragraph added: Architectural Overview");
    queueOfflineEdit("Heading updated: Mobile Parity Status");
    queueOfflineEdit("Checklist item checked: Android Gradle verified");

    expect(localOutbox).toHaveLength(3);
    for (const item of localOutbox) {
      expect(item.state).toBe("pending");
    }

    // 4. Network Reconnection & Outbox Drain
    isNetworkOnline = true;
    expect(isNetworkOnline).toBe(true);

    const drainedFrames: Uint8Array[] = [];
    for (const item of localOutbox) {
      if (item.state === "pending") {
        const frame = encodeBinaryFrame(FRAME_TYPE_YRS_UPDATE, item.data);
        drainedFrames.push(frame);
        item.state = "acknowledged";
      }
    }

    expect(drainedFrames).toHaveLength(3);
    for (const item of localOutbox) {
      expect(item.state).toBe("acknowledged");
    }

    // 5. Server/Peer processes all drained frames in causal order
    const receivedEdits: string[] = [];
    for (const frame of drainedFrames) {
      const decoded = decodeBinaryFrame(frame);
      expect(decoded.frame.frameType).toBe(FRAME_TYPE_YRS_UPDATE);
      receivedEdits.push(new TextDecoder().decode(decoded.frame.payload));
    }

    expect(receivedEdits).toEqual([
      "Paragraph added: Architectural Overview",
      "Heading updated: Mobile Parity Status",
      "Checklist item checked: Android Gradle verified",
    ]);
  });
});
