/** Pure helpers for workspace scoping (no app imports, so they are easy to test). */

export interface ScopedPage {
  id: string;
  parentId: string | null;
  createdAt: number;
}

/**
 * The workspace a page belongs to (null: Personal). `pageWs` comes from the
 * database; pages created after it was read follow their parent, and new
 * top-level pages went to the active workspace (the database trigger does the same).
 */
export function workspaceOf(
  pages: Record<string, ScopedPage>,
  pageWs: Record<string, string>,
  fetchedAt: number,
  active: string | null,
  id: string,
): string | null {
  let cur: ScopedPage | undefined = pages[id];
  let guard = 0;
  while (cur && guard++ < 64) {
    const known = pageWs[cur.id];
    if (known) return known;
    if (!cur.parentId) return cur.createdAt > fetchedAt && active ? active : null;
    cur = pages[cur.parentId];
  }
  return null;
}

/** Only the pages of the active workspace (Personal when none is active). */
export function scopePages<T extends ScopedPage>(
  pages: Record<string, T>,
  pageWs: Record<string, string>,
  fetchedAt: number,
  active: string | null,
): Record<string, T> {
  if (!active && Object.keys(pageWs).length === 0) return pages;
  const out: Record<string, T> = {};
  for (const [id, p] of Object.entries(pages)) {
    if (workspaceOf(pages, pageWs, fetchedAt, active, id) === active) out[id] = p;
  }
  return out;
}

const ORDER = ["none", "view", "comment", "edit", "full"] as const;
export type LevelName = (typeof ORDER)[number];

export function atLeast(have: LevelName, need: LevelName): boolean {
  return ORDER.indexOf(have) >= ORDER.indexOf(need);
}

/** The token at the end of an invite link, or null when it is not one. */
export function inviteToken(link: string): string | null {
  const t = link.trim().replace(/\/+$/, "");
  const last = (t.split("/").pop() ?? "").split(/[?#]/)[0];
  return /^wi_[A-Za-z0-9_-]{8,}$/.test(last) ? last : null;
}
