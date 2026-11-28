/**
 * Controls over the whole service (docs/admin/PLAN.md, phase 6): sign-ups,
 * maintenance, the oldest version allowed per platform, a pause on
 * publishing, an incident banner, feature flags and announcements. The app
 * and the web read them all from GET /config (routes/config.ts).
 */
import { ApiError } from "./http";
import { sha256Hex } from "./crypto";

export interface Settings {
  signups: { mode: "open" | "closed" | "invite" };
  maintenance: { on: boolean; readOnly: boolean; message: { ar: string; en: string } };
  minVersion: Record<string, { version: string; dismissible: boolean }>;
  publishing: { paused: boolean };
  incident: { on: boolean; title: { ar: string; en: string }; body: { ar: string; en: string }; startedAt: number | null; updates: { at: number; text: { ar: string; en: string } }[] };
  /** The download links (routes/downloads.ts): a release everyone gets instead of the newest, and files taken off. */
  downloads: { pinnedTag: string | null; pulled: { name: string; reason: string; at: number; by: string }[] };
  /** How long the security log and closed support requests are kept, in months (lib/retention.ts). */
  retention: { auditMonths: number; closedTicketMonths: number };
  /**
   * When the owner last replaced the session signing key (JWT_PRIVATE_JWK) and
   * the Resend key, as the owner set them. Only the dates; never the keys.
   */
  keys: { signingRotatedAt: number | null; resendRotatedAt: number | null };
}

export const DEFAULTS: Settings = {
  signups: { mode: "open" },
  maintenance: { on: false, readOnly: false, message: { ar: "", en: "" } },
  minVersion: {},
  publishing: { paused: false },
  incident: { on: false, title: { ar: "", en: "" }, body: { ar: "", en: "" }, startedAt: null, updates: [] },
  downloads: { pinnedTag: null, pulled: [] },
  retention: { auditMonths: 12, closedTicketMonths: 24 },
  keys: { signingRotatedAt: null, resendRotatedAt: null },
};

/** The longest a retention period may be set to, in months. */
export const MAX_RETENTION_MONTHS = 120;
/** Keys older than this get a reminder on the overview. */
export const KEY_ROTATION_MS = 182 * 86_400_000;

export type SettingKey = keyof Settings;
export const SETTING_KEYS = Object.keys(DEFAULTS) as SettingKey[];

export async function settings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM service_settings").all<{ key: string; value: string }>();
  const out: Settings = structuredClone(DEFAULTS);
  for (const r of results) {
    if (!(r.key in out)) continue;
    try {
      (out as unknown as Record<string, unknown>)[r.key] = { ...(DEFAULTS as unknown as Record<string, object>)[r.key], ...JSON.parse(r.value) };
    } catch {
      // A broken value falls back to the default.
    }
  }
  return out;
}

/** 1.10.0 > 1.9.2; missing parts count as 0; anything after "-" is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split("-")[0].split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split("-")[0].split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The same person always lands on the same side of a percentage roll-out. */
export async function inPercent(userId: string, key: string, percent: number): Promise<boolean> {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const h = await sha256Hex(`${key}:${userId}`);
  return parseInt(h.slice(0, 8), 16) % 100 < percent;
}

export async function emailBlocked(db: D1Database, email: string): Promise<boolean> {
  const domain = email.split("@")[1] ?? "";
  const row = await db.prepare("SELECT 1 FROM blocked_emails WHERE (kind = 'email' AND value = ?1) OR (kind = 'domain' AND (value = ?2 OR ?2 LIKE '%.' || value))").bind(email, domain).first();
  return !!row;
}

export async function assertPublishingOpen(db: D1Database): Promise<void> {
  if ((await settings(db)).publishing.paused) throw new ApiError(503, "publishing_paused", "Publishing is paused for now. Try again later.");
}
