import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** A client error with a stable machine-readable code. */
export class ApiError extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    public code: string,
    message?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(status, { message: message ?? code });
  }
}

export const bad = (code: string, message?: string) => new ApiError(400, code, message);
export const unauthorized = (code = "unauthorized", message?: string) => new ApiError(401, code, message);
export const forbidden = (code = "forbidden", message?: string) => new ApiError(403, code, message);
export const notFound = (code = "not_found", message?: string) => new ApiError(404, code, message);
export const conflict = (code: string, message?: string) => new ApiError(409, code, message);
export const tooMany = (retryAfterSeconds: number) => new ApiError(429, "rate_limited", "Too many attempts. Try again later.", { retryAfter: retryAfterSeconds });

export function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string" || !v.trim()) throw bad("invalid_request", `${field} is required`);
  const t = v.trim();
  if (t.length > max) throw bad("invalid_request", `${field} is too long`);
  return t;
}

export function optStr(v: unknown, field: string, max = 200): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return str(v, field, max);
}

export function normalizeEmail(v: unknown): string {
  const e = str(v, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad("invalid_email", "Enter a valid email address");
  return e;
}

export async function body<T = Record<string, unknown>>(req: { json: () => Promise<unknown> }): Promise<T> {
  try {
    const v = await req.json();
    if (!v || typeof v !== "object") throw new Error();
    return v as T;
  } catch {
    throw bad("invalid_json", "Request body must be a JSON object");
  }
}
