/**
 * Usernames: 3 to 20 characters of a-z, 0-9, "_" and ".", lowercase,
 * starting and ending with a letter or digit, never two dots in a row.
 * Three-character names are allowed. Unique across the service.
 */
import { ApiError, bad } from "./http";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

const SHAPE = /^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/;

/** Names that would mislead people or collide with the service. */
const RESERVED = new Set([
  "admin", "administrator", "root", "system", "support", "help", "official", "staff", "mod", "moderator", "owner",
  "worlds", "claude", "anthropic", "api", "www", "app", "mail", "security", "billing", "null", "undefined", "me", "you",
  "everyone", "here", "guest", "member", "team", "workspace", "user", "users", "account", "settings", "login", "signin",
]);

export type UsernameProblem = "too_short" | "too_long" | "invalid_characters" | "reserved";

/** Lowercase and trim; strips a leading "@". */
export function normalizeUsername(v: string): string {
  return v.trim().replace(/^@+/, "").toLowerCase();
}

export function usernameProblem(name: string): UsernameProblem | null {
  if (name.length < USERNAME_MIN) return "too_short";
  if (name.length > USERNAME_MAX) return "too_long";
  if (!SHAPE.test(name) || name.includes("..")) return "invalid_characters";
  if (RESERVED.has(name)) return "reserved";
  return null;
}

const MESSAGES: Record<UsernameProblem, string> = {
  too_short: `Usernames have at least ${USERNAME_MIN} characters.`,
  too_long: `Usernames have at most ${USERNAME_MAX} characters.`,
  invalid_characters: "Use letters, numbers, dots and underscores, starting and ending with a letter or number.",
  reserved: "That username is reserved.",
};

/** A valid, normalized username, or a 400 that says what to change. */
export function checkUsername(v: unknown): string {
  if (typeof v !== "string") throw bad("invalid_username", "A username is required.");
  const name = normalizeUsername(v);
  const problem = usernameProblem(name);
  if (problem) throw new ApiError(400, "invalid_username", MESSAGES[problem], { reason: problem });
  return name;
}

export function usernameMessage(p: UsernameProblem): string {
  return MESSAGES[p];
}

export async function usernameTaken(db: D1Database, name: string, exceptUserId?: string): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM users WHERE username = ?1").bind(name).first<{ id: string }>();
  return !!row && row.id !== exceptUserId;
}

/** Turn any text into username material: ASCII letters and digits only. */
function material(seed: string): string {
  return seed
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, USERNAME_MAX - 4);
}

/** A free username built from the seeds (name, email), else "user" and digits. */
export async function suggestUsername(db: D1Database, seeds: string[]): Promise<string> {
  const digits = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => String(b % 10)).join("");
  for (const seed of seeds) {
    const base = material(seed);
    if (base.length < USERNAME_MIN) continue;
    if (!usernameProblem(base) && !(await usernameTaken(db, base))) return base;
    for (let i = 0; i < 6; i++) {
      const name = `${base}${digits(i < 3 ? 2 : 4)}`.slice(0, USERNAME_MAX);
      if (!usernameProblem(name) && !(await usernameTaken(db, name))) return name;
    }
  }
  for (;;) {
    const name = `user${digits(8)}`;
    if (!(await usernameTaken(db, name))) return name;
  }
}
