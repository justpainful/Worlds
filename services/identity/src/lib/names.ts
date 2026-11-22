/**
 * Names the team keeps out (docs/admin/PLAN.md, phase 3): usernames reserved
 * from the dashboard, and words not allowed in usernames, display names and
 * public profiles. Both lists live in D1 and are read on each check.
 */

/** Lowercase, without accents or Arabic short vowels, with the alef, taa marbuta and alef maqsura forms folded. */
export function foldName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A");
}

/** Spacing, dots and underscores removed too, so "b.a d" still matches "bad". */
const squash = (s: string) => foldName(s).replace(/[\s._\-]+/g, "");

export async function reservedName(db: D1Database, name: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 FROM reserved_names WHERE name = ?1").bind(name.toLowerCase()).first());
}

/** The banned word the text contains, if any. */
export async function bannedWordIn(db: D1Database, text: string | null | undefined): Promise<string | null> {
  if (!text) return null;
  const { results } = await db.prepare("SELECT word FROM banned_words").all<{ word: string }>();
  if (!results.length) return null;
  const plain = foldName(text);
  const tight = squash(text);
  for (const { word } of results) {
    const w = foldName(word);
    if (w && (plain.includes(w) || tight.includes(squash(w)))) return word;
  }
  return null;
}
