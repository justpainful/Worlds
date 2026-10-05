/**
 * Worlds sync wire protocol (see docs/SYNC_PROTOCOL.md).
 *
 * Every WebSocket frame is binary: a varUint message type followed by its
 * payload, encoded with lib0. The desktop client keeps a copy of this file in
 * src/sync/protocol.ts; the two must stay identical in the constants below.
 */
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

export const PROTOCOL = "worlds-sync.v1";
/** Subprotocol prefix that carries the access token from browsers. */
export const BEARER_PREFIX = "bearer.";

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
export const MSG_QUERY_AWARENESS = 2;
export const MSG_AUTH_STATE = 3;
export const MSG_UPDATE = 4;
export const MSG_ACK = 5;
export const MSG_NOTICE = 6;

/** Sub-documents multiplexed on one connection. */
export const CH_CONTENT = 0;
export const CH_COMMENTS = 1;
export type Channel = typeof CH_CONTENT | typeof CH_COMMENTS;

export const ACK_OK = 0;
export const ACK_DENIED = 1;
export const ACK_INVALID = 2;

/** WebSocket close codes. */
export const CLOSE_UNAUTHORIZED = 4401; // token missing, invalid or expired: refresh and reconnect
export const CLOSE_REVOKED = 4403; // access removed: do not reconnect
export const CLOSE_TOO_LARGE = 4413;
export const CLOSE_RETRY = 4503; // identity service unavailable: reconnect later

export type AccessLevel = "full" | "edit" | "comment" | "view" | "none";

export const canWrite = (level: AccessLevel, channel: number): boolean => {
  if (level === "full" || level === "edit") return channel === CH_CONTENT || channel === CH_COMMENTS;
  if (level === "comment") return channel === CH_COMMENTS;
  return false;
};

export function encodeAuthState(level: AccessLevel, userId: string): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_AUTH_STATE);
  encoding.writeVarString(e, level);
  encoding.writeVarString(e, userId);
  return encoding.toUint8Array(e);
}

export function encodeUpdate(batchId: number, channel: number, update: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_UPDATE);
  encoding.writeVarUint(e, batchId);
  encoding.writeVarUint(e, channel);
  encoding.writeVarUint8Array(e, update);
  return encoding.toUint8Array(e);
}

export function encodeAck(batchId: number, status: number, reason = ""): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_ACK);
  encoding.writeVarUint(e, batchId);
  encoding.writeVarUint(e, status);
  encoding.writeVarString(e, reason);
  return encoding.toUint8Array(e);
}

export function encodeNotice(code: string, message: string): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_NOTICE);
  encoding.writeVarString(e, code);
  encoding.writeVarString(e, message);
  return encoding.toUint8Array(e);
}

export function encodeAwareness(update: Uint8Array): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MSG_AWARENESS);
  encoding.writeVarUint8Array(e, update);
  return encoding.toUint8Array(e);
}

/** One entry of a y-protocols awareness update. */
export interface AwarenessEntry {
  clientID: number;
  clock: number;
  state: string; // JSON text, "null" when the client left
}

export function decodeAwarenessUpdate(update: Uint8Array): AwarenessEntry[] {
  const d = decoding.createDecoder(update);
  const n = decoding.readVarUint(d);
  const out: AwarenessEntry[] = [];
  for (let i = 0; i < n; i++) {
    const clientID = decoding.readVarUint(d);
    const clock = decoding.readVarUint(d);
    const state = decoding.readVarString(d);
    out.push({ clientID, clock, state });
  }
  return out;
}

export function encodeAwarenessUpdate(entries: AwarenessEntry[]): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, entries.length);
  for (const en of entries) {
    encoding.writeVarUint(e, en.clientID);
    encoding.writeVarUint(e, en.clock);
    encoding.writeVarString(e, en.state);
  }
  return encoding.toUint8Array(e);
}
