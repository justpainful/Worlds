/** The server clock and a durable increasing fence decide ownership. Client
 * timestamps never extend a lease. Tokens stay private to the acquiring device. */
export interface DrawingLease { target: string; userId: string; deviceId: string; requestId: string; token: string; fence: number; expiresAt: number }
export interface DrawingLeaseInput { action: "acquire" | "renew" | "release"; target: string; requestId?: string; token?: string; fence?: number }
export const DRAWING_LEASE_MS = 15000;
export type LeaseResult = { ok: true; lease: DrawingLease | null } | { ok: false; status: 400 | 403 | 409 | 503; error: string };
export function validLeaseInput(value: unknown): value is DrawingLeaseInput {
  const v = value as DrawingLeaseInput;
  return !!v && ["acquire", "renew", "release"].includes(v.action) && typeof v.target === "string" && /^(node|layer|frame|mask|step|asset|drawing|order):[^\u0000-\u001f]{1,160}$/.test(v.target) && (v.action === "acquire" ? typeof v.requestId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(v.requestId) : typeof v.token === "string" && v.token.length <= 128 && Number.isSafeInteger(v.fence) && v.fence! > 0);
}
export function ownsDrawingLease(lease: DrawingLease | null, proof: Pick<DrawingLeaseInput, "target" | "fence" | "token">, userId: string, deviceId: string, now: number): boolean {
  return !!lease && lease.target === proof.target && lease.userId === userId && lease.deviceId === deviceId && lease.expiresAt > now && lease.fence === proof.fence && lease.token === proof.token;
}
export function decideDrawingLease(old: DrawingLease | null, input: DrawingLeaseInput, userId: string, deviceId: string, fence: number, now: number): LeaseResult {
  if (!validLeaseInput(input)) return { ok: false, status: 400, error: "Invalid drawing lease request" };
  if (input.action === "acquire") {
    if (old && old.expiresAt > now) {
      if (old.userId === userId && old.deviceId === deviceId && old.requestId === input.requestId) return { ok: true, lease: old };
      return { ok: false, status: 409, error: "This drawing element is being edited elsewhere" };
    }
    return { ok: true, lease: { target: input.target, userId, deviceId, requestId: input.requestId!, token: crypto.randomUUID(), fence, expiresAt: now + DRAWING_LEASE_MS } };
  }
  if (!ownsDrawingLease(old, input, userId, deviceId, now)) return { ok: false, status: 409, error: "The drawing lease expired or was replaced" };
  return { ok: true, lease: input.action === "release" ? null : { ...old!, expiresAt: now + DRAWING_LEASE_MS } };
}
