/**
 * E2E Test Harness: worlds-sync.v1 Wire Protocol Codec & Framing
 *
 * Implements the authoritative binary framing specified in PROJECT.md § Interface Contracts
 * and docs/SYNC_PROTOCOL.md:
 * - Frame Format: [version: u8, frame_type: u8, payload_len: u32 (big-endian), payload: [u8]]
 * - Frame Types:
 *   0x01: Auth/Session
 *   0x02: Yrs Update (lib0 encoded)
 *   0x03: Awareness/Presence
 *   0x04: Drawing Lease Request/Grant
 *   0x05: Drawing Journal Op
 * - Close Codes: 4401 (Unauthorized), 4403 (Revoked), 4413 (Too Large), 4503 (Retry)
 */

export const PROTOCOL_VERSION_1 = 0x01;
export const PROTOCOL_NAME = "worlds-sync.v1";
export const BEARER_PREFIX = "bearer.";

export const FRAME_TYPE_AUTH = 0x01;
export const FRAME_TYPE_YRS_UPDATE = 0x02;
export const FRAME_TYPE_AWARENESS = 0x03;
export const FRAME_TYPE_DRAWING_LEASE = 0x04;
export const FRAME_TYPE_DRAWING_JOURNAL_OP = 0x05;

export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_REVOKED = 4403;
export const CLOSE_TOO_LARGE = 4413;
export const CLOSE_RETRY = 4503;

export const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024; // 4 MB limit
export const HEADER_SIZE_BYTES = 6; // 1 (ver) + 1 (type) + 4 (len)

export interface BinaryFrame {
  version: number;
  frameType: number;
  payloadLen: number;
  payload: Uint8Array;
}

export interface DrawingLeaseRequest {
  action: "acquire" | "renew" | "release";
  target: string;
  requestId?: string;
  token?: string;
  fence?: number;
}

export interface DrawingLeaseGrant {
  target: string;
  ownerId: string;
  deviceId: string;
  token: string;
  fence: number;
  expiresAt: number; // Unix epoch ms
}

export interface DrawingJournalOpPayload {
  opId: string;
  revision: number;
  authorId: string;
  generation: string;
  operations: Array<{
    type: string;
    targetId: string;
    params: Record<string, unknown>;
  }>;
  leaseProof?: {
    target: string;
    token: string;
    fence: number;
  };
  pixelGuard?: {
    frameId: string;
    layers: string[];
    sourceNodes?: string[];
    ancestors?: string[];
  };
}

/**
 * Encodes a binary frame matching [version: u8, frame_type: u8, payload_len: u32, payload: [u8]]
 */
export function encodeBinaryFrame(
  frameType: number,
  payload: Uint8Array | string,
  version: number = PROTOCOL_VERSION_1
): Uint8Array {
  const payloadBytes =
    typeof payload === "string" ? new TextEncoder().encode(payload) : payload;

  if (payloadBytes.byteLength > MAX_PAYLOAD_BYTES) {
    const error = new Error(`Payload size ${payloadBytes.byteLength} exceeds 4MB limit`);
    (error as unknown as { closeCode: number }).closeCode = CLOSE_TOO_LARGE;
    throw error;
  }

  const buffer = new Uint8Array(HEADER_SIZE_BYTES + payloadBytes.byteLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  view.setUint8(0, version);
  view.setUint8(1, frameType);
  view.setUint32(2, payloadBytes.byteLength, false); // Big-endian
  buffer.set(payloadBytes, HEADER_SIZE_BYTES);

  return buffer;
}

/**
 * Decodes a binary frame from a buffer.
 * Throws errors with appropriate close codes if malformed or too large.
 */
export function decodeBinaryFrame(data: Uint8Array): {
  frame: BinaryFrame;
  remaining: Uint8Array;
} {
  if (data.byteLength < HEADER_SIZE_BYTES) {
    throw new Error(
      `Truncated frame header: expected ${HEADER_SIZE_BYTES} bytes, got ${data.byteLength}`
    );
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint8(0);
  const frameType = view.getUint8(1);
  const payloadLen = view.getUint32(2, false);

  if (version !== PROTOCOL_VERSION_1) {
    throw new Error(`Unsupported protocol version: ${version}`);
  }

  if (payloadLen > MAX_PAYLOAD_BYTES) {
    const error = new Error(`Frame payload length ${payloadLen} exceeds 4MB limit`);
    (error as unknown as { closeCode: number }).closeCode = CLOSE_TOO_LARGE;
    throw error;
  }

  if (data.byteLength < HEADER_SIZE_BYTES + payloadLen) {
    throw new Error(
      `Truncated frame payload: expected ${payloadLen} bytes, got ${data.byteLength - HEADER_SIZE_BYTES}`
    );
  }

  const payload = data.subarray(HEADER_SIZE_BYTES, HEADER_SIZE_BYTES + payloadLen);
  const remaining = data.subarray(HEADER_SIZE_BYTES + payloadLen);

  return {
    frame: {
      version,
      frameType,
      payloadLen,
      payload,
    },
    remaining,
  };
}

/**
 * Validates WebSocket subprotocol negotiation for browsers & native clients
 */
export function negotiateSubprotocol(subprotocols: string[]): {
  protocol: string | null;
  token: string | null;
} {
  const hasWorldsSync = subprotocols.some(
    (p) => p.trim() === PROTOCOL_NAME
  );
  if (!hasWorldsSync) {
    return { protocol: null, token: null };
  }

  let token: string | null = null;
  for (const p of subprotocols) {
    const trimmed = p.trim();
    if (trimmed.startsWith(BEARER_PREFIX)) {
      token = trimmed.slice(BEARER_PREFIX.length);
    }
  }

  return { protocol: PROTOCOL_NAME, token };
}

/**
 * Validates EdDSA JWT expiration for sync protocol
 */
export function validateTokenExpiry(token: string, currentTimestampSec: number): {
  valid: boolean;
  closeCode?: number;
  reason?: string;
  sub?: string;
  needsRefresh?: boolean;
} {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false, closeCode: CLOSE_UNAUTHORIZED, reason: "Invalid JWT format" };
    }
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf-8");
    const payload = JSON.parse(payloadJson) as {
      sub?: string;
      exp?: number;
      iat?: number;
      dev?: string;
    };

    if (!payload.exp || typeof payload.exp !== "number") {
      return { valid: false, closeCode: CLOSE_UNAUTHORIZED, reason: "Missing exp claim" };
    }

    if (currentTimestampSec >= payload.exp) {
      return { valid: false, closeCode: CLOSE_UNAUTHORIZED, reason: "Token expired" };
    }

    // Refresh if within 60s of expiration
    const needsRefresh = payload.exp - currentTimestampSec <= 60;

    return {
      valid: true,
      sub: payload.sub,
      needsRefresh,
    };
  } catch (e) {
    return {
      valid: false,
      closeCode: CLOSE_UNAUTHORIZED,
      reason: `Malformed token: ${(e as Error).message}`,
    };
  }
}
