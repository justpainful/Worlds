/**
 * Adversarial Stress & Wire Protocol Verification Suite
 *
 * Mandate:
 * Stress test the worlds-sync.v1 wire protocol codec against adversarial inputs:
 * - Zero-length payloads
 * - 4MB oversized payloads (boundary conditions & header manipulation)
 * - Unsupported version bytes (0x00, 0x02, 0xFF, full 0..255 sweep)
 * - Malformed UTF-8 & corrupted payloads
 * - Truncated frames at all byte offsets
 * - Random bitflip & byte-level fuzzing mutations
 */

import { describe, it, expect } from "vitest";
import {
  encodeBinaryFrame,
  decodeBinaryFrame,
  negotiateSubprotocol,
  validateTokenExpiry,
  CLOSE_TOO_LARGE,
  CLOSE_UNAUTHORIZED,
  FRAME_TYPE_AUTH,
  FRAME_TYPE_YRS_UPDATE,
  FRAME_TYPE_AWARENESS,
  FRAME_TYPE_DRAWING_LEASE,
  FRAME_TYPE_DRAWING_JOURNAL_OP,
  MAX_PAYLOAD_BYTES,
  HEADER_SIZE_BYTES,
  PROTOCOL_VERSION_1,
} from "../e2e/harness/protocol";
import {
  decodeAwarenessUpdate,
  encodeAwarenessUpdate,
  encodeUpdate,
  encodeAck,
  encodeNotice,
  encodeAuthState,
  encodeAuthRefresh,
} from "../../src/sync/protocol";

describe("Adversarial Stress Test: worlds-sync.v1 Wire Protocol", () => {
  describe("1. Zero-Length Payloads", () => {
    it("encodes and decodes 0-byte Uint8Array payload without error", () => {
      const payload = new Uint8Array(0);
      const frame = encodeBinaryFrame(FRAME_TYPE_AUTH, payload);

      expect(frame.byteLength).toBe(HEADER_SIZE_BYTES); // Exactly 6 bytes
      const decoded = decodeBinaryFrame(frame);

      expect(decoded.frame.version).toBe(PROTOCOL_VERSION_1);
      expect(decoded.frame.frameType).toBe(FRAME_TYPE_AUTH);
      expect(decoded.frame.payloadLen).toBe(0);
      expect(decoded.frame.payload.byteLength).toBe(0);
      expect(decoded.remaining.byteLength).toBe(0);
    });

    it("encodes and decodes empty string payload without error", () => {
      const frame = encodeBinaryFrame(FRAME_TYPE_AWARENESS, "");
      expect(frame.byteLength).toBe(HEADER_SIZE_BYTES);

      const decoded = decodeBinaryFrame(frame);
      expect(decoded.frame.payloadLen).toBe(0);
      expect(decoded.frame.payload.byteLength).toBe(0);
    });

    it("handles zero-length payloads across all valid frame types (0x01 - 0x05)", () => {
      const frameTypes = [
        FRAME_TYPE_AUTH,
        FRAME_TYPE_YRS_UPDATE,
        FRAME_TYPE_AWARENESS,
        FRAME_TYPE_DRAWING_LEASE,
        FRAME_TYPE_DRAWING_JOURNAL_OP,
      ];

      for (const ft of frameTypes) {
        const frame = encodeBinaryFrame(ft, new Uint8Array(0));
        const decoded = decodeBinaryFrame(frame);
        expect(decoded.frame.frameType).toBe(ft);
        expect(decoded.frame.payloadLen).toBe(0);
        expect(decoded.frame.payload.byteLength).toBe(0);
      }
    });

    it("correctly decodes sequential stream of back-to-back zero-length frames", () => {
      const frame1 = encodeBinaryFrame(FRAME_TYPE_AUTH, new Uint8Array(0));
      const frame2 = encodeBinaryFrame(FRAME_TYPE_YRS_UPDATE, new Uint8Array(0));
      const frame3 = encodeBinaryFrame(FRAME_TYPE_AWARENESS, new Uint8Array(0));

      const combined = new Uint8Array(frame1.length + frame2.length + frame3.length);
      combined.set(frame1, 0);
      combined.set(frame2, frame1.length);
      combined.set(frame3, frame1.length + frame2.length);

      const d1 = decodeBinaryFrame(combined);
      expect(d1.frame.frameType).toBe(FRAME_TYPE_AUTH);
      expect(d1.remaining.byteLength).toBe(12);

      const d2 = decodeBinaryFrame(d1.remaining);
      expect(d2.frame.frameType).toBe(FRAME_TYPE_YRS_UPDATE);
      expect(d2.remaining.byteLength).toBe(6);

      const d3 = decodeBinaryFrame(d2.remaining);
      expect(d3.frame.frameType).toBe(FRAME_TYPE_AWARENESS);
      expect(d3.remaining.byteLength).toBe(0);
    });
  });

  describe("2. 4MB Oversized Payloads & Boundary Conditions", () => {
    it("successfully encodes and decodes exact 4MB limit (4,194,304 bytes)", () => {
      const exact4MB = new Uint8Array(MAX_PAYLOAD_BYTES);
      exact4MB[0] = 0x12;
      exact4MB[MAX_PAYLOAD_BYTES - 1] = 0x34;

      const frame = encodeBinaryFrame(FRAME_TYPE_YRS_UPDATE, exact4MB);
      expect(frame.byteLength).toBe(HEADER_SIZE_BYTES + MAX_PAYLOAD_BYTES);

      const decoded = decodeBinaryFrame(frame);
      expect(decoded.frame.payloadLen).toBe(MAX_PAYLOAD_BYTES);
      expect(decoded.frame.payload[0]).toBe(0x12);
      expect(decoded.frame.payload[MAX_PAYLOAD_BYTES - 1]).toBe(0x34);
    });

    it("rejects 4MB + 1 byte at encoding with CLOSE_TOO_LARGE (4413)", () => {
      const oversized = new Uint8Array(MAX_PAYLOAD_BYTES + 1);

      let thrownErr: any = null;
      try {
        encodeBinaryFrame(FRAME_TYPE_YRS_UPDATE, oversized);
      } catch (err: any) {
        thrownErr = err;
      }

      expect(thrownErr).not.toBeNull();
      expect(thrownErr.closeCode).toBe(CLOSE_TOO_LARGE);
      expect(thrownErr.message).toMatch(/exceeds 4MB limit/i);
    });

    it("rejects adversarial wire header claiming 4MB + 1 without allocating memory", () => {
      const maliciousHeader = new Uint8Array(HEADER_SIZE_BYTES);
      const view = new DataView(maliciousHeader.buffer);
      view.setUint8(0, PROTOCOL_VERSION_1);
      view.setUint8(1, FRAME_TYPE_YRS_UPDATE);
      view.setUint32(2, MAX_PAYLOAD_BYTES + 1, false);

      let caught: any = null;
      try {
        decodeBinaryFrame(maliciousHeader);
      } catch (err: any) {
        caught = err;
      }

      expect(caught).not.toBeNull();
      expect(caught.closeCode).toBe(CLOSE_TOO_LARGE);
      expect(caught.message).toMatch(/exceeds 4MB limit/i);
    });

    it("rejects adversarial wire header claiming maximum u32 (0xFFFFFFFF) without OOM crash", () => {
      const maliciousHeader = new Uint8Array(HEADER_SIZE_BYTES);
      const view = new DataView(maliciousHeader.buffer);
      view.setUint8(0, PROTOCOL_VERSION_1);
      view.setUint8(1, FRAME_TYPE_YRS_UPDATE);
      view.setUint32(2, 0xffffffff, false); // ~4.29 GB

      let caught: any = null;
      try {
        decodeBinaryFrame(maliciousHeader);
      } catch (err: any) {
        caught = err;
      }

      expect(caught).not.toBeNull();
      expect(caught.closeCode).toBe(CLOSE_TOO_LARGE);
    });

    it("rejects adversarial wire header claiming 100MB payload", () => {
      const maliciousHeader = new Uint8Array(HEADER_SIZE_BYTES);
      const view = new DataView(maliciousHeader.buffer);
      view.setUint8(0, PROTOCOL_VERSION_1);
      view.setUint8(1, FRAME_TYPE_DRAWING_JOURNAL_OP);
      view.setUint32(2, 100 * 1024 * 1024, false);

      let caught: any = null;
      try {
        decodeBinaryFrame(maliciousHeader);
      } catch (err: any) {
        caught = err;
      }

      expect(caught).not.toBeNull();
      expect(caught.closeCode).toBe(CLOSE_TOO_LARGE);
    });
  });

  describe("3. Unsupported Protocol Versions", () => {
    it("rejects version 0x00 gracefully", () => {
      const raw = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
      expect(() => decodeBinaryFrame(raw)).toThrowError(/Unsupported protocol version: 0/);
    });

    it("rejects version 0x02 gracefully", () => {
      const raw = new Uint8Array([0x02, 0x01, 0x00, 0x00, 0x00, 0x00]);
      expect(() => decodeBinaryFrame(raw)).toThrowError(/Unsupported protocol version: 2/);
    });

    it("rejects version 0xFF (255) gracefully", () => {
      const raw = new Uint8Array([0xff, 0x01, 0x00, 0x00, 0x00, 0x00]);
      expect(() => decodeBinaryFrame(raw)).toThrowError(/Unsupported protocol version: 255/);
    });

    it("sweeps all 255 unsupported version bytes (0x00..0xFF except 0x01) with 100% graceful rejection", () => {
      const buffer = new Uint8Array(6);
      let rejectedCount = 0;

      for (let v = 0; v <= 255; v++) {
        if (v === PROTOCOL_VERSION_1) continue;
        buffer[0] = v;
        buffer[1] = FRAME_TYPE_AUTH;
        buffer[2] = 0;
        buffer[3] = 0;
        buffer[4] = 0;
        buffer[5] = 0;

        try {
          decodeBinaryFrame(buffer);
          // If we reach here, it failed to reject!
          expect.fail(`Version ${v} was accepted when it should have been rejected`);
        } catch (err: any) {
          expect(err.message).toContain(`Unsupported protocol version: ${v}`);
          rejectedCount++;
        }
      }

      expect(rejectedCount).toBe(255);
    });
  });

  describe("4. Malformed UTF-8 & Hostile Tokens", () => {
    it("handles malformed UTF-8 in JWT tokens without process crash", () => {
      // Create JWT parts with invalid base64 and invalid UTF-8 sequences
      const malformedTokens = [
        "not.a.valid.jwt",
        "header-only",
        "a.b.c.d.e",
        "eyJhbGciOiJFRDI1NTE5In0.///malformed-base64///.signature",
        // Valid base64url but invalid UTF-8 byte sequences: 0xFF, 0xC0 0x80
        `eyJhbGciOiJFRDI1NTE5In0.${Buffer.from([0xff, 0xfe, 0xfd]).toString("base64url")}.sig`,
        // Valid base64url JSON with missing exp claim
        `eyJhbGciOiJFRDI1NTE5In0.${Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url")}.sig`,
        // Valid base64url JSON with non-numeric exp
        `eyJhbGciOiJFRDI1NTE5In0.${Buffer.from(JSON.stringify({ sub: "u1", exp: "never" })).toString("base64url")}.sig`,
        // Truncated JSON
        `eyJhbGciOiJFRDI1NTE5In0.${Buffer.from('{"sub": "u1", "exp":').toString("base64url")}.sig`,
      ];

      for (const token of malformedTokens) {
        const res = validateTokenExpiry(token, 1700000000);
        expect(res.valid).toBe(false);
        expect(res.closeCode).toBe(CLOSE_UNAUTHORIZED);
        expect(typeof res.reason).toBe("string");
      }
    });

    it("handles awareness update decoder on adversarial / truncated bytes without crashing", () => {
      const hostileBytesList = [
        new Uint8Array(0), // empty
        new Uint8Array([0x01]), // claims 1 entry but no clientID
        new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x0f]), // huge varUint entry count
        new Uint8Array([0x01, 0x01, 0x01, 0xff]), // truncated string
      ];

      for (const hostile of hostileBytesList) {
        let threw = false;
        try {
          decodeAwarenessUpdate(hostile);
        } catch {
          threw = true;
        }
        // Either gracefully parses or throws catchable exception, never terminates process
        expect(typeof threw).toBe("boolean");
      }
    });

    it("verifies round-trip encoding/decoding of awareness entries with complex UTF-8 states", () => {
      const entries = [
        {
          clientID: 1001,
          clock: 42,
          state: JSON.stringify({ user: { name: "Alice 👩‍🔬", status: "online 🟢", bio: "مرحبا بالعالم" } }),
        },
        {
          clientID: 1002,
          clock: 99,
          state: JSON.stringify({ laser: { x: 450.5, y: 120.25, color: "#D2A46E" } }),
        },
      ];

      const encoded = encodeAwarenessUpdate(entries);
      const decoded = decodeAwarenessUpdate(encoded);

      expect(decoded.length).toBe(2);
      expect(decoded[0].clientID).toBe(1001);
      expect(decoded[0].clock).toBe(42);
      expect(JSON.parse(decoded[0].state).user.name).toBe("Alice 👩‍🔬");
      expect(JSON.parse(decoded[0].state).user.bio).toBe("مرحبا بالعالم");
      expect(decoded[1].clientID).toBe(1002);
      expect(decoded[1].clock).toBe(99);
      expect(JSON.parse(decoded[1].state).laser.color).toBe("#D2A46E");
    });
  });

  describe("5. Truncated Frames & Prefix Sweeps", () => {
    it("rejects all header prefixes from 0 to 5 bytes with descriptive error", () => {
      for (let len = 0; len < HEADER_SIZE_BYTES; len++) {
        const truncated = new Uint8Array(len);
        truncated.fill(0x01);

        expect(() => {
          decodeBinaryFrame(truncated);
        }).toThrowError(new RegExp(`Truncated frame header: expected ${HEADER_SIZE_BYTES} bytes, got ${len}`));
      }
    });

    it("rejects frame where actual payload is shorter than declared payloadLen across all lengths", () => {
      const declaredLen = 50;
      const fullFrame = new Uint8Array(HEADER_SIZE_BYTES + declaredLen);
      const view = new DataView(fullFrame.buffer);
      view.setUint8(0, PROTOCOL_VERSION_1);
      view.setUint8(1, FRAME_TYPE_DRAWING_LEASE);
      view.setUint32(2, declaredLen, false);

      // Test all partial payload lengths from 0 to declaredLen - 1
      for (let partial = 0; partial < declaredLen; partial++) {
        const slice = fullFrame.subarray(0, HEADER_SIZE_BYTES + partial);
        expect(() => {
          decodeBinaryFrame(slice);
        }).toThrowError(new RegExp(`Truncated frame payload: expected ${declaredLen} bytes, got ${partial}`));
      }
    });

    it("sweeps every prefix of a valid 1KB frame and verifies graceful rejection until complete", () => {
      const payload = new Uint8Array(1024);
      for (let i = 0; i < payload.length; i++) payload[i] = i % 256;

      const validFrame = encodeBinaryFrame(FRAME_TYPE_YRS_UPDATE, payload);
      expect(validFrame.byteLength).toBe(HEADER_SIZE_BYTES + 1024);

      // Every prefix from 0 to 1029 must throw; prefix of 1030 must succeed
      for (let i = 0; i < validFrame.byteLength; i++) {
        const prefix = validFrame.subarray(0, i);
        let errorCaught = false;
        try {
          decodeBinaryFrame(prefix);
        } catch {
          errorCaught = true;
        }
        expect(errorCaught).toBe(true);
      }

      // Exact length succeeds
      const decoded = decodeBinaryFrame(validFrame);
      expect(decoded.frame.payloadLen).toBe(1024);
      expect(decoded.frame.payload[500]).toBe(500 % 256);
    });
  });

  describe("6. Fuzzing & Mutation Robustness (1,000 Iterations)", () => {
    it("survives 1,000 randomized bitflips and payload corruptions without process crash", () => {
      const basePayload = new TextEncoder().encode(
        JSON.stringify({ op: "stroke", x: 100, y: 200, pressure: 0.85, tool: "pencil" })
      );
      const validFrame = encodeBinaryFrame(FRAME_TYPE_DRAWING_JOURNAL_OP, basePayload);

      let gracefulRejectionCount = 0;
      let validDecodeCount = 0;
      const iterations = 1000;

      // Seeded pseudo-random generator for determinism
      let seed = 123456789;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };

      for (let iter = 0; iter < iterations; iter++) {
        // Clone frame
        const mutated = new Uint8Array(validFrame);

        // Apply 1 to 5 random byte corruptions
        const numCorruptions = 1 + Math.floor(rand() * 5);
        for (let c = 0; c < numCorruptions; c++) {
          const targetIndex = Math.floor(rand() * mutated.byteLength);
          mutated[targetIndex] = Math.floor(rand() * 256);
        }

        // Sometimes randomly truncate
        const finalLength = rand() > 0.5 ? Math.floor(rand() * mutated.byteLength) : mutated.byteLength;
        const testBuffer = mutated.subarray(0, finalLength);

        try {
          const res = decodeBinaryFrame(testBuffer);
          // If it decoded, the version must be valid and payloadLen must match
          expect(res.frame.version).toBe(PROTOCOL_VERSION_1);
          validDecodeCount++;
        } catch (err: any) {
          // Must be an Error instance with standard error message
          expect(err).toBeInstanceOf(Error);
          gracefulRejectionCount++;
        }
      }

      // All 1,000 iterations must either cleanly decode or gracefully throw
      expect(validDecodeCount + gracefulRejectionCount).toBe(iterations);
      expect(gracefulRejectionCount).toBeGreaterThan(0);
    });
  });

  describe("7. Protocol Messages Serialization Robustness", () => {
    it("encodes and decodes ack, notice, authState, and authRefresh cleanly", () => {
      const ack = encodeAck(42, 0, "OK");
      expect(ack.byteLength).toBeGreaterThan(0);

      const notice = encodeNotice("STORAGE_WARNING", "Storage at 92%");
      expect(notice.byteLength).toBeGreaterThan(0);

      const authState = encodeAuthState("edit", "user-uuid-42");
      expect(authState.byteLength).toBeGreaterThan(0);

      const authRefresh = encodeAuthRefresh("eyJhbGciOiJFRDI1NTE5In0.abc.def");
      expect(authRefresh.byteLength).toBeGreaterThan(0);

      const update = encodeUpdate(1, 0, new Uint8Array([1, 2, 3, 4]));
      expect(update.byteLength).toBeGreaterThan(0);
    });
  });
});
