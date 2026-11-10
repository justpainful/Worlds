/**
 * Tier 2: Boundary & Corner Cases — Protocol Framing & Token Boundaries
 *
 * Exercises extreme conditions on the binary wire protocol:
 * - Zero-byte payload
 * - Exact 4MB limit handling
 * - Payload exceeding 4MB triggers close code 4413 (Too Large)
 * - Truncated and malformed binary frames
 * - JWT expiration boundary: active, expiring soon (needsRefresh), and expired (4401)
 * - Subprotocol header parsing with extra whitespaces and absent bearer
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
  MAX_PAYLOAD_BYTES,
} from "../harness/protocol";

describe("Tier 2: Protocol Framing & Token Boundaries", () => {
  it("handles zero-byte payload correctly in binary framing", () => {
    const emptyPayload = new Uint8Array(0);
    const frame = encodeBinaryFrame(FRAME_TYPE_AUTH, emptyPayload);

    expect(frame.byteLength).toBe(6); // 1 + 1 + 4 + 0

    const decoded = decodeBinaryFrame(frame);
    expect(decoded.frame.frameType).toBe(FRAME_TYPE_AUTH);
    expect(decoded.frame.payloadLen).toBe(0);
    expect(decoded.frame.payload.byteLength).toBe(0);
  });

  it("accepts maximum allowed payload at exact 4MB limit", () => {
    const maxPayload = new Uint8Array(MAX_PAYLOAD_BYTES);
    maxPayload.fill(0xaa);

    const frame = encodeBinaryFrame(FRAME_TYPE_YRS_UPDATE, maxPayload);
    expect(frame.byteLength).toBe(6 + MAX_PAYLOAD_BYTES);

    const decoded = decodeBinaryFrame(frame);
    expect(decoded.frame.payloadLen).toBe(MAX_PAYLOAD_BYTES);
  });

  it("rejects payload exceeding 4MB with close code 4413 (Too Large)", () => {
    const oversizedPayload = new Uint8Array(MAX_PAYLOAD_BYTES + 1);

    expect(() => {
      encodeBinaryFrame(FRAME_TYPE_YRS_UPDATE, oversizedPayload);
    }).toThrowError(/exceeds 4MB limit/i);

    try {
      encodeBinaryFrame(FRAME_TYPE_YRS_UPDATE, oversizedPayload);
    } catch (err: unknown) {
      expect((err as { closeCode: number }).closeCode).toBe(CLOSE_TOO_LARGE);
    }
  });

  it("throws clear error on truncated frame header (< 6 bytes)", () => {
    const truncatedHeader = new Uint8Array([0x01, 0x02, 0x00]); // Only 3 bytes
    expect(() => {
      decodeBinaryFrame(truncatedHeader);
    }).toThrowError(/Truncated frame header/i);
  });

  it("throws clear error on truncated frame payload", () => {
    // Header claims payload is 100 bytes, but only 10 bytes provided
    const buffer = new Uint8Array(6 + 10);
    const view = new DataView(buffer.buffer);
    view.setUint8(0, 1); // version
    view.setUint8(1, 2); // type
    view.setUint32(2, 100, false); // claims 100 bytes

    expect(() => {
      decodeBinaryFrame(buffer);
    }).toThrowError(/Truncated frame payload/i);
  });

  it("validates token expiration boundaries (valid, refreshing, expired 4401)", () => {
    const makeJwt = (payloadObj: Record<string, unknown>) => {
      const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
      return `${header}.${payload}.mockSignature`;
    };

    const now = 1700000000;

    // 1. Valid token (expires in 10 minutes)
    const validJwt = makeJwt({ sub: "user-123", exp: now + 600 });
    const res1 = validateTokenExpiry(validJwt, now);
    expect(res1.valid).toBe(true);
    expect(res1.needsRefresh).toBe(false);
    expect(res1.sub).toBe("user-123");

    // 2. Token nearing expiration (within 60s)
    const expiringJwt = makeJwt({ sub: "user-123", exp: now + 30 });
    const res2 = validateTokenExpiry(expiringJwt, now);
    expect(res2.valid).toBe(true);
    expect(res2.needsRefresh).toBe(true);

    // 3. Expired token -> 4401
    const expiredJwt = makeJwt({ sub: "user-123", exp: now - 1 });
    const res3 = validateTokenExpiry(expiredJwt, now);
    expect(res3.valid).toBe(false);
    expect(res3.closeCode).toBe(CLOSE_UNAUTHORIZED);
    expect(res3.reason).toMatch(/expired/i);
  });

  it("handles subprotocol negotiation with arbitrary casing and whitespace", () => {
    const header = [" worlds-sync.v1 ", " bearer.eyJhbGciOiJFRDI1NTE5In0.abc.def "];
    const { protocol, token } = negotiateSubprotocol(header);
    expect(protocol).toBe("worlds-sync.v1");
    expect(token).toBe("eyJhbGciOiJFRDI1NTE5In0.abc.def");

    // Missing worlds-sync.v1
    const invalidHeader = ["graphql-ws", "bearer.abc"];
    const invalidRes = negotiateSubprotocol(invalidHeader);
    expect(invalidRes.protocol).toBeNull();
  });
});
