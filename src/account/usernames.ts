/**
 * The account service's username rule, so the app can explain a problem
 * before asking the server: 3 to 20 of a-z 0-9 "_" ".", starting and ending
 * with a letter or digit, never "..". The server also keeps a reserved list.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Lowercase, no spaces, no leading "@". */
export function normalizeUsername(v: string): string {
  return v.replace(/\s+/g, "").replace(/^@+/, "").toLowerCase();
}

export function usernameProblem(name: string): string | null {
  if (name.length < USERNAME_MIN) return `At least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `At most ${USERNAME_MAX} characters.`;
  if (!/^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/.test(name) || name.includes("..")) return "Letters, numbers, dots and underscores, starting and ending with a letter or number.";
  return null;
}
